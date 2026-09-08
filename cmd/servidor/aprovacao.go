// Envio do pedido de aprovação de acesso por e-mail.
//
// O aplicativo é offline-first e não tem como enviar e-mail sozinho: o
// `mailto:` só abre um rascunho no programa do montador, e nem isso funciona
// dentro de iframes restritos. Esta rota resolve o envio de verdade, sem
// abandonar a modalidade portátil — quem tiver o binário aberto envia.
//
// Configuração por variável de ambiente (sem nenhuma delas a rota responde
// 501 e o aplicativo volta ao rascunho manual):
//
//	APROVACAO_TRANSPORTE   smtp | resend | sendgrid
//	APROVACAO_REMETENTE    endereço que aparece como remetente
//	APROVACAO_RESPONSAVEL  destinatário quando o painel não declara um
//
//	SMTP_HOST SMTP_PORTA SMTP_USUARIO SMTP_SENHA   (STARTTLS na 587)
//	SMTP_TLS=implicito                             (TLS direto, porta 465)
//	EMAIL_API_CHAVE                                (Resend ou SendGrid)
package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/smtp"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// rotaAprovacao é o caminho que o aplicativo chama para pedir o envio.
const rotaAprovacao = "/api/aprovacao"

const (
	corpoMaximo      = 4 << 10
	intervaloPorPar  = time.Minute
	limitePorOrigem  = 20
	janelaPorOrigem  = time.Hour
	tempoLimiteEnvio = 20 * time.Second
)

var (
	padraoEmail  = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)
	padraoPainel = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)
)

type pedidoAprovacao struct {
	EmailMontador string `json:"emailMontador"`
	PainelID      string `json:"painelId"`
}

type catalogoPaineis struct {
	Paineis []struct {
		ID                  string `json:"id"`
		Nome                string `json:"nome"`
		ResponsavelMontagem string `json:"responsavelMontagem"`
	} `json:"paineis"`
}

// mensagem é montada inteiramente no servidor: o pedido só informa quem é o
// montador e qual painel. Sem isso a rota viraria relé de spam.
type mensagem struct {
	Para      string
	Assunto   string
	Corpo     string
	Remetente string
}

// limitador guarda, em memória, o último envio de cada par montador/painel e
// a contagem por endereço de origem. O binário portátil atende um punhado de
// pessoas: não precisa de mais do que isso.
type limitador struct {
	mu      sync.Mutex
	ultimo  map[string]time.Time
	origens map[string][]time.Time
}

func novoLimitador() *limitador {
	return &limitador{ultimo: map[string]time.Time{}, origens: map[string][]time.Time{}}
}

func (l *limitador) permite(par, origem string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	agora := time.Now()

	if visto, ok := l.ultimo[par]; ok && agora.Sub(visto) < intervaloPorPar {
		return fmt.Errorf("aguarde %d s para reenviar o pedido",
			int((intervaloPorPar-agora.Sub(visto)).Seconds())+1)
	}

	recentes := l.origens[origem][:0]
	for _, quando := range l.origens[origem] {
		if agora.Sub(quando) < janelaPorOrigem {
			recentes = append(recentes, quando)
		}
	}
	if len(recentes) >= limitePorOrigem {
		l.origens[origem] = recentes
		return errors.New("limite de envios desta máquina atingido; tente mais tarde")
	}

	l.ultimo[par] = agora
	l.origens[origem] = append(recentes, agora)
	return nil
}

// manipuladorAprovacao devolve a rota /api/aprovacao. `arquivos` é o mesmo
// conteúdo servido ao navegador: o catálogo de painéis sai dali, e não do
// pedido, para o cliente nunca escolher o destinatário.
func manipuladorAprovacao(arquivos fs.FS) http.Handler {
	limites := novoLimitador()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			responderErro(w, http.StatusMethodNotAllowed, "use POST")
			return
		}

		transporte := strings.ToLower(strings.TrimSpace(os.Getenv("APROVACAO_TRANSPORTE")))
		if transporte == "" {
			responderErro(w, http.StatusNotImplemented, "envio de e-mail não configurado neste servidor")
			return
		}

		var pedido pedidoAprovacao
		if err := json.NewDecoder(io.LimitReader(r.Body, corpoMaximo)).Decode(&pedido); err != nil {
			responderErro(w, http.StatusBadRequest, "pedido ilegível")
			return
		}
		pedido.EmailMontador = strings.ToLower(strings.TrimSpace(pedido.EmailMontador))
		pedido.PainelID = strings.TrimSpace(pedido.PainelID)

		if !padraoEmail.MatchString(pedido.EmailMontador) {
			responderErro(w, http.StatusBadRequest, "e-mail do montador inválido")
			return
		}
		if !padraoPainel.MatchString(pedido.PainelID) {
			responderErro(w, http.StatusBadRequest, "painel inválido")
			return
		}

		nome, destinatario, err := responsavelDoPainel(arquivos, pedido.PainelID)
		if err != nil {
			responderErro(w, http.StatusNotFound, err.Error())
			return
		}

		origem, _, _ := net.SplitHostPort(r.RemoteAddr)
		if origem == "" {
			origem = r.RemoteAddr
		}
		if err := limites.permite(pedido.EmailMontador+"|"+pedido.PainelID, origem); err != nil {
			responderErro(w, http.StatusTooManyRequests, err.Error())
			return
		}

		msg := montarMensagem(pedido, nome, destinatario, enderecoBase(r))
		if err := enviar(transporte, msg); err != nil {
			responderErro(w, http.StatusBadGateway, "não foi possível enviar: "+err.Error())
			return
		}

		responder(w, http.StatusOK, map[string]any{
			"enviado":      true,
			"destinatario": destinatario,
		})
	})
}

func responsavelDoPainel(arquivos fs.FS, painelID string) (nome, email string, err error) {
	conteudo, err := fs.ReadFile(arquivos, "paineis/index.json")
	if err != nil {
		return "", "", errors.New("catálogo de painéis não encontrado")
	}
	var catalogo catalogoPaineis
	if err := json.Unmarshal(conteudo, &catalogo); err != nil {
		return "", "", errors.New("catálogo de painéis ilegível")
	}

	padrao := strings.ToLower(strings.TrimSpace(os.Getenv("APROVACAO_RESPONSAVEL")))
	for _, painel := range catalogo.Paineis {
		if painel.ID != painelID {
			continue
		}
		email = strings.ToLower(strings.TrimSpace(painel.ResponsavelMontagem))
		if email == "" {
			email = padrao
		}
		if !padraoEmail.MatchString(email) {
			return "", "", errors.New("painel sem responsável de montagem configurado")
		}
		return painel.Nome, email, nil
	}
	return "", "", errors.New("painel desconhecido")
}

// enderecoBase reconstrói a origem pela qual o montador chegou, para o link de
// aprovação abrir no mesmo servidor. O pedido não escolhe esse endereço.
func enderecoBase(r *http.Request) string {
	esquema := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		esquema = "https"
	}
	return esquema + "://" + r.Host
}

func montarMensagem(pedido pedidoAprovacao, nomePainel, destinatario, base string) mensagem {
	parametros := url.Values{}
	parametros.Set("email", pedido.EmailMontador)
	parametros.Set("painel", pedido.PainelID)
	link := base + "/#/aprovar?" + parametros.Encode()

	corpo := strings.Join([]string{
		"Prezado(a),",
		"",
		fmt.Sprintf("Solicito autorização para trabalhar no painel %s.", nomePainel),
		"",
		"Montador: " + pedido.EmailMontador,
		"Painel: " + nomePainel,
		"Data do pedido: " + time.Now().Format("02/01/2006 15:04"),
		"",
		"Para autorizar, abra o link abaixo e envie o código de aprovação exibido:",
		link,
		"",
		"Sem o código o acesso ao painel permanece bloqueado.",
	}, "\r\n")

	remetente := strings.TrimSpace(os.Getenv("APROVACAO_REMETENTE"))
	if remetente == "" {
		remetente = pedido.EmailMontador
	}

	return mensagem{
		Para:      destinatario,
		Assunto:   "Autorização de montagem — " + nomePainel,
		Corpo:     corpo,
		Remetente: remetente,
	}
}

func enviar(transporte string, msg mensagem) error {
	switch transporte {
	case "smtp":
		return enviarSMTP(msg)
	case "resend":
		return enviarAPI(msg, "https://api.resend.com/emails", map[string]any{
			"from": msg.Remetente, "to": []string{msg.Para},
			"subject": msg.Assunto, "text": msg.Corpo,
		})
	case "sendgrid":
		return enviarAPI(msg, "https://api.sendgrid.com/v3/mail/send", map[string]any{
			"personalizations": []any{map[string]any{
				"to": []any{map[string]string{"email": msg.Para}},
			}},
			"from":    map[string]string{"email": msg.Remetente},
			"subject": msg.Assunto,
			"content": []any{map[string]string{"type": "text/plain", "value": msg.Corpo}},
		})
	default:
		return fmt.Errorf("transporte %q desconhecido (use smtp, resend ou sendgrid)", transporte)
	}
}

func enviarSMTP(msg mensagem) error {
	host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	if host == "" {
		return errors.New("SMTP_HOST não definido")
	}
	porta := strings.TrimSpace(os.Getenv("SMTP_PORTA"))
	if porta == "" {
		porta = "587"
	}
	if _, err := strconv.Atoi(porta); err != nil {
		return errors.New("SMTP_PORTA inválida")
	}
	usuario := os.Getenv("SMTP_USUARIO")
	senha := os.Getenv("SMTP_SENHA")

	var autenticacao smtp.Auth
	if usuario != "" {
		autenticacao = smtp.PlainAuth("", usuario, senha, host)
	}
	bruta := serializar(msg)
	endereco := net.JoinHostPort(host, porta)

	// Porta 465 fala TLS desde o primeiro byte; a 587 negocia STARTTLS, que o
	// smtp.SendMail já faz sozinho quando o servidor anuncia.
	if !strings.EqualFold(os.Getenv("SMTP_TLS"), "implicito") {
		return smtp.SendMail(endereco, autenticacao, msg.Remetente, []string{msg.Para}, bruta)
	}

	conexao, err := tls.Dial("tcp", endereco, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
	if err != nil {
		return err
	}
	defer conexao.Close()

	cliente, err := smtp.NewClient(conexao, host)
	if err != nil {
		return err
	}
	defer cliente.Quit()

	if autenticacao != nil {
		if err := cliente.Auth(autenticacao); err != nil {
			return err
		}
	}
	if err := cliente.Mail(msg.Remetente); err != nil {
		return err
	}
	if err := cliente.Rcpt(msg.Para); err != nil {
		return err
	}
	escritor, err := cliente.Data()
	if err != nil {
		return err
	}
	if _, err := escritor.Write(bruta); err != nil {
		return err
	}
	return escritor.Close()
}

func serializar(msg mensagem) []byte {
	cabecalhos := []string{
		"From: " + msg.Remetente,
		"To: " + msg.Para,
		"Subject: " + mime.QEncoding.Encode("UTF-8", msg.Assunto),
		"Date: " + time.Now().Format(time.RFC1123Z),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
	}
	return []byte(strings.Join(cabecalhos, "\r\n") + "\r\n\r\n" + msg.Corpo + "\r\n")
}

func enviarAPI(msg mensagem, endereco string, corpo map[string]any) error {
	chave := strings.TrimSpace(os.Getenv("EMAIL_API_CHAVE"))
	if chave == "" {
		return errors.New("EMAIL_API_CHAVE não definida")
	}
	if !padraoEmail.MatchString(msg.Remetente) {
		return errors.New("APROVACAO_REMETENTE precisa de um endereço verificado no serviço")
	}

	dados, err := json.Marshal(corpo)
	if err != nil {
		return err
	}
	requisicao, err := http.NewRequest(http.MethodPost, endereco, bytes.NewReader(dados))
	if err != nil {
		return err
	}
	requisicao.Header.Set("Content-Type", "application/json")
	requisicao.Header.Set("Authorization", "Bearer "+chave)

	cliente := &http.Client{Timeout: tempoLimiteEnvio}
	resposta, err := cliente.Do(requisicao)
	if err != nil {
		return err
	}
	defer resposta.Body.Close()

	if resposta.StatusCode >= 300 {
		detalhe, _ := io.ReadAll(io.LimitReader(resposta.Body, 512))
		return fmt.Errorf("serviço respondeu %d: %s", resposta.StatusCode, strings.TrimSpace(string(detalhe)))
	}
	return nil
}

func responder(w http.ResponseWriter, situacao int, corpo any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(situacao)
	_ = json.NewEncoder(w).Encode(corpo)
}

func responderErro(w http.ResponseWriter, situacao int, detalhe string) {
	responder(w, situacao, map[string]any{"enviado": false, "erro": detalhe})
}
