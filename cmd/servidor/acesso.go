// Fila de liberação de acesso.
//
// O montador informa e-mail e painel e fica travado até um administrador
// liberar. Como a decisão é tomada em outro aparelho, ela não pode viver no
// IndexedDB do navegador: é este servidor que guarda a fila, em um único
// arquivo JSON no disco, sem banco nem dependência externa.
package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	StatusPendente = "pendente"
	StatusLiberado = "liberado"
	StatusNegado   = "negado"

	limiteSolicitacoes = 5000
	validadeSessao     = 12 * time.Hour
	corpoMaximo        = 16 << 10
)

var formatoEmail = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

// Solicitacao é um pedido de acesso de um montador a um painel.
type Solicitacao struct {
	ID          string     `json:"id"`
	Email       string     `json:"email"`
	PainelID    string     `json:"painelId"`
	PainelNome  string     `json:"painelNome"`
	Status      string     `json:"status"`
	Observacao  string     `json:"observacao,omitempty"`
	CriadoEm    time.Time  `json:"criadoEm"`
	DecididoEm  *time.Time `json:"decididoEm,omitempty"`
	DecididoPor string     `json:"decididoPor,omitempty"`
	// Token identifica o montador no aparelho dele. Nunca sai em listagem.
	Token string `json:"token"`
}

// visao é o que a API devolve: tudo menos o token.
type visao struct {
	ID          string     `json:"id"`
	Email       string     `json:"email"`
	PainelID    string     `json:"painelId"`
	PainelNome  string     `json:"painelNome"`
	Status      string     `json:"status"`
	Observacao  string     `json:"observacao,omitempty"`
	CriadoEm    time.Time  `json:"criadoEm"`
	DecididoEm  *time.Time `json:"decididoEm,omitempty"`
	DecididoPor string     `json:"decididoPor,omitempty"`
}

func (s Solicitacao) visao() visao {
	return visao{
		ID: s.ID, Email: s.Email, PainelID: s.PainelID, PainelNome: s.PainelNome,
		Status: s.Status, Observacao: s.Observacao, CriadoEm: s.CriadoEm,
		DecididoEm: s.DecididoEm, DecididoPor: s.DecididoPor,
	}
}

type arquivoDados struct {
	Solicitacoes []Solicitacao `json:"solicitacoes"`
}

// Fila guarda as solicitações em memória e espelha no disco a cada alteração.
type Fila struct {
	mutex        sync.Mutex
	caminho      string
	solicitacoes []Solicitacao
	senhaAdmin   string
	sessoes      map[string]time.Time
}

func AbrirFila(caminho, senhaAdmin string) (*Fila, error) {
	f := &Fila{caminho: caminho, senhaAdmin: senhaAdmin, sessoes: map[string]time.Time{}}
	conteudo, err := os.ReadFile(caminho)
	if errors.Is(err, os.ErrNotExist) {
		return f, nil
	}
	if err != nil {
		return nil, err
	}
	var dados arquivoDados
	if err := json.Unmarshal(conteudo, &dados); err != nil {
		return nil, fmt.Errorf("arquivo de acessos inválido (%s): %w", caminho, err)
	}
	f.solicitacoes = dados.Solicitacoes
	return f, nil
}

// gravar espelha a fila no disco. Escreve em arquivo temporário e renomeia,
// para que uma queda de energia não deixe um JSON pela metade.
func (f *Fila) gravar() error {
	if err := os.MkdirAll(filepath.Dir(f.caminho), 0o755); err != nil {
		return err
	}
	conteudo, err := json.MarshalIndent(arquivoDados{Solicitacoes: f.solicitacoes}, "", "  ")
	if err != nil {
		return err
	}
	temporario := f.caminho + ".tmp"
	if err := os.WriteFile(temporario, conteudo, 0o600); err != nil {
		return err
	}
	return os.Rename(temporario, f.caminho)
}

func chaveAleatoria() string {
	bruto := make([]byte, 24)
	if _, err := rand.Read(bruto); err != nil {
		// crypto/rand só falha em sistema sem fonte de entropia: não há
		// caminho seguro de continuar.
		panic(err)
	}
	return hex.EncodeToString(bruto)
}

// Solicitar cria o pedido — ou devolve o que já existe para o mesmo e-mail e
// painel, de modo que reabrir o aplicativo não gere uma fila de duplicatas.
func (f *Fila) Solicitar(email, painelID, painelNome string) (Solicitacao, error) {
	f.mutex.Lock()
	defer f.mutex.Unlock()

	for i := range f.solicitacoes {
		s := &f.solicitacoes[i]
		if strings.EqualFold(s.Email, email) && s.PainelID == painelID && s.Status != StatusNegado {
			return *s, nil
		}
	}
	if len(f.solicitacoes) >= limiteSolicitacoes {
		return Solicitacao{}, errors.New("a fila de solicitações está cheia; limpe as antigas na administração")
	}

	nova := Solicitacao{
		ID:         chaveAleatoria()[:12],
		Email:      email,
		PainelID:   painelID,
		PainelNome: painelNome,
		Status:     StatusPendente,
		CriadoEm:   time.Now().UTC(),
		Token:      chaveAleatoria(),
	}
	f.solicitacoes = append(f.solicitacoes, nova)
	if err := f.gravar(); err != nil {
		f.solicitacoes = f.solicitacoes[:len(f.solicitacoes)-1]
		return Solicitacao{}, err
	}
	return nova, nil
}

func (f *Fila) PorToken(token string) (Solicitacao, bool) {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	for _, s := range f.solicitacoes {
		if s.Token != "" && subtle.ConstantTimeCompare([]byte(s.Token), []byte(token)) == 1 {
			return s, true
		}
	}
	return Solicitacao{}, false
}

func (f *Fila) Listar() []visao {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	lista := make([]visao, 0, len(f.solicitacoes))
	for _, s := range f.solicitacoes {
		lista = append(lista, s.visao())
	}
	// Pendentes primeiro, e dentro de cada grupo a mais recente no topo.
	sort.SliceStable(lista, func(i, j int) bool {
		if (lista[i].Status == StatusPendente) != (lista[j].Status == StatusPendente) {
			return lista[i].Status == StatusPendente
		}
		return lista[i].CriadoEm.After(lista[j].CriadoEm)
	})
	return lista
}

func (f *Fila) Decidir(id, acao, observacao string) (visao, error) {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	for i := range f.solicitacoes {
		s := &f.solicitacoes[i]
		if s.ID != id {
			continue
		}
		anterior := *s
		agora := time.Now().UTC()
		switch acao {
		case "liberar":
			s.Status = StatusLiberado
		case "negar":
			s.Status = StatusNegado
		case "revogar":
			// Volta para a fila: o montador cai de novo na tela de espera.
			s.Status = StatusPendente
		default:
			return visao{}, fmt.Errorf("ação desconhecida: %q", acao)
		}
		s.Observacao = observacao
		s.DecididoEm = &agora
		s.DecididoPor = "administração"
		if err := f.gravar(); err != nil {
			f.solicitacoes[i] = anterior
			return visao{}, err
		}
		return s.visao(), nil
	}
	return visao{}, errors.New("solicitação não encontrada")
}

func (f *Fila) Excluir(id string) error {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	for i := range f.solicitacoes {
		if f.solicitacoes[i].ID != id {
			continue
		}
		anterior := f.solicitacoes
		f.solicitacoes = append(append([]Solicitacao{}, f.solicitacoes[:i]...), f.solicitacoes[i+1:]...)
		if err := f.gravar(); err != nil {
			f.solicitacoes = anterior
			return err
		}
		return nil
	}
	return errors.New("solicitação não encontrada")
}

func (f *Fila) AbrirSessao(senha string) (string, bool) {
	if subtle.ConstantTimeCompare([]byte(senha), []byte(f.senhaAdmin)) != 1 {
		return "", false
	}
	token := chaveAleatoria()
	f.mutex.Lock()
	defer f.mutex.Unlock()
	for t, validade := range f.sessoes {
		if time.Now().After(validade) {
			delete(f.sessoes, t)
		}
	}
	f.sessoes[token] = time.Now().Add(validadeSessao)
	return token, true
}

func (f *Fila) SessaoValida(token string) bool {
	if token == "" {
		return false
	}
	f.mutex.Lock()
	defer f.mutex.Unlock()
	validade, existe := f.sessoes[token]
	if !existe || time.Now().After(validade) {
		delete(f.sessoes, token)
		return false
	}
	return true
}

func (f *Fila) FecharSessao(token string) {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	delete(f.sessoes, token)
}

// ---------------------------------------------------------------- HTTP

func responder(w http.ResponseWriter, codigo int, corpo any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(codigo)
	if corpo != nil {
		_ = json.NewEncoder(w).Encode(corpo)
	}
}

func responderErro(w http.ResponseWriter, codigo int, mensagem string) {
	responder(w, codigo, map[string]string{"erro": mensagem})
}

func lerCorpo(w http.ResponseWriter, r *http.Request, destino any) bool {
	decodificador := json.NewDecoder(http.MaxBytesReader(w, r.Body, corpoMaximo))
	if err := decodificador.Decode(destino); err != nil {
		responderErro(w, http.StatusBadRequest, "Corpo da requisição inválido.")
		return false
	}
	return true
}

func tokenDoCabecalho(r *http.Request) string {
	cabecalho := r.Header.Get("Authorization")
	if valor, achou := strings.CutPrefix(cabecalho, "Bearer "); achou {
		return strings.TrimSpace(valor)
	}
	return ""
}

// API monta as rotas de /api. O restante do tráfego continua sendo arquivo
// estático da aplicação.
func (f *Fila) API() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/saude", func(w http.ResponseWriter, r *http.Request) {
		responder(w, http.StatusOK, map[string]any{"ok": true, "servico": "liberacao-acesso"})
	})

	mux.HandleFunc("POST /api/acesso/solicitar", func(w http.ResponseWriter, r *http.Request) {
		var corpo struct {
			Email      string `json:"email"`
			PainelID   string `json:"painelId"`
			PainelNome string `json:"painelNome"`
		}
		if !lerCorpo(w, r, &corpo) {
			return
		}
		email := strings.ToLower(strings.TrimSpace(corpo.Email))
		painelID := strings.TrimSpace(corpo.PainelID)
		if !formatoEmail.MatchString(email) || len(email) > 254 {
			responderErro(w, http.StatusBadRequest, "Informe um e-mail válido.")
			return
		}
		if painelID == "" {
			responderErro(w, http.StatusBadRequest, "Escolha o painel.")
			return
		}
		solicitacao, err := f.Solicitar(email, painelID, strings.TrimSpace(corpo.PainelNome))
		if err != nil {
			responderErro(w, http.StatusInternalServerError, err.Error())
			return
		}
		responder(w, http.StatusOK, map[string]any{
			"token":       solicitacao.Token,
			"solicitacao": solicitacao.visao(),
		})
	})

	mux.HandleFunc("GET /api/acesso/situacao", func(w http.ResponseWriter, r *http.Request) {
		token := tokenDoCabecalho(r)
		if token == "" {
			token = r.URL.Query().Get("token")
		}
		solicitacao, existe := f.PorToken(token)
		if !existe {
			responderErro(w, http.StatusNotFound, "Solicitação não encontrada. Refaça o pedido de acesso.")
			return
		}
		responder(w, http.StatusOK, map[string]any{"solicitacao": solicitacao.visao()})
	})

	mux.HandleFunc("POST /api/admin/sessao", func(w http.ResponseWriter, r *http.Request) {
		var corpo struct {
			Senha string `json:"senha"`
		}
		if !lerCorpo(w, r, &corpo) {
			return
		}
		token, ok := f.AbrirSessao(corpo.Senha)
		if !ok {
			// Atraso curto para desestimular tentativa em massa.
			time.Sleep(400 * time.Millisecond)
			responderErro(w, http.StatusUnauthorized, "Senha incorreta.")
			return
		}
		responder(w, http.StatusOK, map[string]string{"token": token})
	})

	mux.HandleFunc("DELETE /api/admin/sessao", func(w http.ResponseWriter, r *http.Request) {
		f.FecharSessao(tokenDoCabecalho(r))
		responder(w, http.StatusOK, map[string]bool{"ok": true})
	})

	mux.Handle("GET /api/admin/solicitacoes", f.exigirAdmin(func(w http.ResponseWriter, r *http.Request) {
		responder(w, http.StatusOK, map[string]any{"solicitacoes": f.Listar()})
	}))

	mux.Handle("POST /api/admin/solicitacoes/{id}", f.exigirAdmin(func(w http.ResponseWriter, r *http.Request) {
		var corpo struct {
			Acao       string `json:"acao"`
			Observacao string `json:"observacao"`
		}
		if !lerCorpo(w, r, &corpo) {
			return
		}
		atualizada, err := f.Decidir(r.PathValue("id"), corpo.Acao, strings.TrimSpace(corpo.Observacao))
		if err != nil {
			responderErro(w, http.StatusBadRequest, err.Error())
			return
		}
		responder(w, http.StatusOK, map[string]any{"solicitacao": atualizada})
	}))

	mux.Handle("DELETE /api/admin/solicitacoes/{id}", f.exigirAdmin(func(w http.ResponseWriter, r *http.Request) {
		if err := f.Excluir(r.PathValue("id")); err != nil {
			responderErro(w, http.StatusBadRequest, err.Error())
			return
		}
		responder(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		responderErro(w, http.StatusNotFound, "Rota inexistente.")
	})

	return mux
}

func (f *Fila) exigirAdmin(seguinte http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !f.SessaoValida(tokenDoCabecalho(r)) {
			responderErro(w, http.StatusUnauthorized, "Sessão de administração expirada. Entre novamente.")
			return
		}
		seguinte(w, r)
	})
}

// comCORS libera as origens informadas em -origem, para a modalidade em que a
// aplicação é publicada em um endereço e o servidor de liberação em outro.
func comCORS(origens []string, seguinte http.Handler) http.Handler {
	if len(origens) == 0 {
		return seguinte
	}
	permitida := func(origem string) bool {
		for _, o := range origens {
			if o == "*" || strings.EqualFold(o, origem) {
				return true
			}
		}
		return false
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origem := r.Header.Get("Origin")
		if origem != "" && permitida(origem) {
			w.Header().Set("Access-Control-Allow-Origin", origem)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		seguinte.ServeHTTP(w, r)
	})
}
