package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"net/http"
	"slices"
	"strings"

	"verificacao/api/internal/autorizacao"
	"verificacao/api/internal/token"
)

// limiteCorpo protege contra requisição gigante: nenhum corpo desta API
// passa de alguns kilobytes.
const limiteCorpo = 16 << 10

func rotas(servico *autorizacao.Servico, jwk []byte) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/saude", func(w http.ResponseWriter, _ *http.Request) {
		responderJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// A chave pública também é servida aqui: quem faz o build do aplicativo
	// não precisa de acesso ao servidor para obtê-la.
	mux.HandleFunc("GET /api/chave-publica", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(jwk)
	})

	mux.HandleFunc("GET /api/paineis", func(w http.ResponseWriter, _ *http.Request) {
		paineis, err := servico.Paineis()
		if err != nil {
			responderErro(w, err)
			return
		}
		responderJSON(w, http.StatusOK, paineis)
	})

	mux.HandleFunc("POST /api/solicitacoes", func(w http.ResponseWriter, r *http.Request) {
		var corpo struct {
			Email     string `json:"email"`
			PainelID  string `json:"painelId"`
			DeviceID  string `json:"deviceId"`
			Descricao string `json:"descricao"`
		}
		if !lerCorpo(w, r, &corpo) {
			return
		}

		resultado, err := servico.Solicitar(corpo.Email, corpo.PainelID, corpo.DeviceID, corpo.Descricao)
		if err != nil {
			responderErro(w, err)
			return
		}
		responderJSON(w, http.StatusCreated, resultado)
	})

	// Consulta do estado, chamada em intervalos pela tela de espera.
	mux.HandleFunc("GET /api/solicitacoes/{id}", func(w http.ResponseWriter, r *http.Request) {
		resultado, err := servico.Consultar(r.PathValue("id"), r.URL.Query().Get("device"))
		if err != nil && !errors.Is(err, autorizacao.ErrRevogada) {
			responderErro(w, err)
			return
		}
		if errors.Is(err, autorizacao.ErrRevogada) {
			responderJSON(w, http.StatusOK, map[string]any{
				"id": resultado.ID, "status": resultado.Status, "revogada": true,
			})
			return
		}
		responderJSON(w, http.StatusOK, resultado)
	})

	// Os dois links do e-mail. Respondem HTML porque quem abre é uma pessoa
	// no navegador do celular, não o aplicativo.
	mux.HandleFunc("GET /api/decisao/aprovar", func(w http.ResponseWriter, r *http.Request) {
		decidirPeloLink(w, r, servico, true)
	})
	mux.HandleFunc("GET /api/decisao/negar", func(w http.ResponseWriter, r *http.Request) {
		decidirPeloLink(w, r, servico, false)
	})

	// Revalidação: o aplicativo chama sempre que tem rede, e é por aqui que
	// uma revogação chega ao aparelho.
	mux.HandleFunc("POST /api/sessao/revalidar", func(w http.ResponseWriter, r *http.Request) {
		claims, ok := autenticar(w, r, servico)
		if !ok {
			return
		}
		credencial, err := servico.Revalidar(claims)
		if err != nil {
			responderErro(w, err)
			return
		}
		responderJSON(w, http.StatusOK, map[string]string{"credencial": credencial})
	})

	// Tela de autorizações do responsável.
	mux.HandleFunc("GET /api/paineis/{id}/solicitacoes", func(w http.ResponseWriter, r *http.Request) {
		claims, ok := autenticar(w, r, servico)
		if !ok {
			return
		}
		solicitacoes, err := servico.Listar(r.PathValue("id"), claims)
		if err != nil {
			responderErro(w, err)
			return
		}
		responderJSON(w, http.StatusOK, solicitacoes)
	})

	mux.HandleFunc("POST /api/solicitacoes/{id}/decidir", func(w http.ResponseWriter, r *http.Request) {
		claims, ok := autenticar(w, r, servico)
		if !ok {
			return
		}
		var corpo struct {
			Aprovar bool `json:"aprovar"`
		}
		if !lerCorpo(w, r, &corpo) {
			return
		}
		solicitacao, err := servico.DecidirPelaTela(r.PathValue("id"), corpo.Aprovar, claims)
		if err != nil {
			responderErro(w, err)
			return
		}
		responderJSON(w, http.StatusOK, solicitacao)
	})

	mux.HandleFunc("POST /api/solicitacoes/{id}/revogar", func(w http.ResponseWriter, r *http.Request) {
		claims, ok := autenticar(w, r, servico)
		if !ok {
			return
		}
		solicitacao, err := servico.Revogar(r.PathValue("id"), claims)
		if err != nil {
			responderErro(w, err)
			return
		}
		responderJSON(w, http.StatusOK, solicitacao)
	})

	return mux
}

func decidirPeloLink(w http.ResponseWriter, r *http.Request, servico *autorizacao.Servico, aprovar bool) {
	id := r.URL.Query().Get("id")
	segredo := r.URL.Query().Get("t")

	solicitacao, err := servico.Decidir(id, segredo, aprovar)
	if err != nil {
		responderPagina(w, statusDoErro(err), "Não foi possível concluir", mensagemDoErro(err))
		return
	}

	if solicitacao.Status == autorizacao.StatusAprovada {
		responderPagina(w, http.StatusOK, "Acesso aprovado", fmt.Sprintf(
			"%s já pode usar o sistema no aparelho de onde fez a solicitação. "+
				"Se o aplicativo estiver aberto, o acesso é liberado em alguns segundos.",
			solicitacao.Email))
		return
	}
	responderPagina(w, http.StatusOK, "Acesso negado", fmt.Sprintf(
		"O pedido de %s foi recusado e o aplicativo continua bloqueado naquele aparelho.",
		solicitacao.Email))
}

// autenticar lê a credencial do cabeçalho Authorization e a valida.
func autenticar(w http.ResponseWriter, r *http.Request, servico *autorizacao.Servico) (token.Claims, bool) {
	cabecalho := r.Header.Get("Authorization")
	bruto, achou := strings.CutPrefix(cabecalho, "Bearer ")
	if !achou || bruto == "" {
		responderJSON(w, http.StatusUnauthorized, map[string]string{"erro": "credencial ausente"})
		return token.Claims{}, false
	}

	claims, err := servico.VerificarCredencial(strings.TrimSpace(bruto))
	if err != nil {
		responderJSON(w, http.StatusUnauthorized, map[string]string{"erro": "credencial inválida ou expirada"})
		return token.Claims{}, false
	}
	return claims, true
}

func lerCorpo(w http.ResponseWriter, r *http.Request, destino any) bool {
	decodificador := json.NewDecoder(http.MaxBytesReader(w, r.Body, limiteCorpo))
	decodificador.DisallowUnknownFields()
	if err := decodificador.Decode(destino); err != nil {
		responderJSON(w, http.StatusBadRequest, map[string]string{"erro": "corpo da requisição inválido"})
		return false
	}
	return true
}

// comCORS libera as origens configuradas. Uma lista vazia libera todas, o
// que o servidor avisa no log ao subir.
func comCORS(origens []string, proximo http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origem := strings.TrimRight(r.Header.Get("Origin"), "/")
		if origem != "" && (len(origens) == 0 || slices.Contains(origens, origem)) {
			w.Header().Set("Access-Control-Allow-Origin", origem)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Max-Age", "86400")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		proximo.ServeHTTP(w, r)
	})
}

func responderJSON(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(corpo); err != nil {
		log.Printf("falha ao escrever resposta: %v", err)
	}
}

func responderErro(w http.ResponseWriter, err error) {
	status := statusDoErro(err)
	if status == http.StatusInternalServerError {
		// A mensagem interna fica no log; o cliente recebe algo genérico.
		log.Printf("erro interno: %v", err)
		responderJSON(w, status, map[string]string{"erro": "erro interno do servidor"})
		return
	}
	responderJSON(w, status, map[string]string{"erro": mensagemDoErro(err)})
}

func statusDoErro(err error) int {
	switch {
	case errors.Is(err, autorizacao.ErrNaoEncontrada),
		errors.Is(err, autorizacao.ErrPainelDesconhecido):
		return http.StatusNotFound
	case errors.Is(err, autorizacao.ErrEmailInvalido),
		errors.Is(err, autorizacao.ErrDispositivoVazio),
		errors.Is(err, autorizacao.ErrJaDecidida),
		errors.Is(err, autorizacao.ErrLinkExpirado):
		return http.StatusBadRequest
	case errors.Is(err, autorizacao.ErrSemPermissao),
		errors.Is(err, autorizacao.ErrRevogada),
		errors.Is(err, autorizacao.ErrNaoAprovada):
		return http.StatusForbidden
	case errors.Is(err, autorizacao.ErrMuitasSolicitacoes):
		return http.StatusTooManyRequests
	default:
		return http.StatusInternalServerError
	}
}

func mensagemDoErro(err error) string {
	switch {
	case errors.Is(err, autorizacao.ErrEmailInvalido):
		return "Informe um e-mail válido."
	case errors.Is(err, autorizacao.ErrPainelDesconhecido):
		return "Painel não encontrado."
	case errors.Is(err, autorizacao.ErrNaoEncontrada):
		return "Solicitação não encontrada."
	case errors.Is(err, autorizacao.ErrJaDecidida):
		return "Esta solicitação já foi decidida."
	case errors.Is(err, autorizacao.ErrLinkExpirado):
		return "O link expirou. Peça ao solicitante que envie a solicitação de novo."
	case errors.Is(err, autorizacao.ErrRevogada):
		return "O acesso foi revogado pelo responsável."
	case errors.Is(err, autorizacao.ErrNaoAprovada):
		return "A solicitação ainda não foi aprovada."
	case errors.Is(err, autorizacao.ErrSemPermissao):
		return "Sem permissão para esta operação."
	case errors.Is(err, autorizacao.ErrMuitasSolicitacoes):
		return "Muitas solicitações deste aparelho. Aguarde uma hora e tente de novo."
	case errors.Is(err, autorizacao.ErrDispositivoVazio):
		return "Não foi possível identificar o aparelho."
	default:
		return "Erro interno do servidor."
	}
}

// responderPagina desenha a confirmação que o responsável vê ao clicar no
// link do e-mail, no celular dele.
func responderPagina(w http.ResponseWriter, status int, titulo, mensagem string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)

	_, _ = fmt.Fprintf(w, `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s</title></head>
<body style="margin:0;padding:32px 24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f1f1f;background:#fafafa">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:32px 24px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
<div style="font-weight:900;font-size:20px;color:#ff000f;letter-spacing:-.02em">ABB</div>
<h1 style="margin:16px 0 12px;font-size:22px;line-height:1.3">%s</h1>
<p style="margin:0;font-size:16px;line-height:1.6;color:#4a4a4a">%s</p>
<p style="margin:28px 0 0;font-size:14px;color:#8a8a8a">Você já pode fechar esta página.</p>
</div>
</body></html>`, html.EscapeString(titulo), html.EscapeString(titulo), html.EscapeString(mensagem))
}
