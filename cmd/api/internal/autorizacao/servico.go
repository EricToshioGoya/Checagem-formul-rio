package autorizacao

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"html"
	"log"
	"net/url"
	"sort"
	"time"

	"verificacao/api/internal/email"
	"verificacao/api/internal/token"
)

// Limites de tempo e de volume do fluxo.
const (
	// ValidadeLinkDecisao é quanto tempo o link do e-mail continua válido.
	ValidadeLinkDecisao = 48 * time.Hour
	// JanelaLimite e MaxSolicitacoesJanela impedem que um aparelho vire uma
	// máquina de encher a caixa do responsável.
	JanelaLimite          = time.Hour
	MaxSolicitacoesJanela = 5
)

// Servico reúne as regras de solicitação, decisão e revogação.
type Servico struct {
	repo      Repositorio
	assinador *token.Assinador
	emissor   email.Emissor
	// urlBase é o endereço público da API, usado para montar os links que
	// o responsável clica no e-mail.
	urlBase string
	// validade é quanto tempo a credencial vale offline no aparelho.
	validade time.Duration
	agora    func() time.Time
}

// NovoServico monta o serviço. `agora` pode ser nil, e então usa time.Now —
// o parâmetro existe para tornar os testes determinísticos.
func NovoServico(
	repo Repositorio,
	assinador *token.Assinador,
	emissor email.Emissor,
	urlBase string,
	validade time.Duration,
	agora func() time.Time,
) *Servico {
	if agora == nil {
		agora = time.Now
	}
	return &Servico{
		repo:      repo,
		assinador: assinador,
		emissor:   emissor,
		urlBase:   urlBase,
		validade:  validade,
		agora:     agora,
	}
}

// ResultadoSolicitacao é o que o aplicativo recebe ao pedir acesso.
type ResultadoSolicitacao struct {
	ID     string `json:"id"`
	Status Status `json:"status"`
	// Credencial vem preenchida quando o acesso já estava concedido — o
	// caso de quem reinstala o aplicativo no mesmo aparelho.
	Credencial string `json:"credencial,omitempty"`
	// EmailResponsavel é mostrado ao solicitante para ele saber de quem
	// cobrar a aprovação. É o único ponto em que o endereço sai do servidor,
	// e só para quem de fato abriu uma solicitação naquele painel.
	EmailResponsavel string `json:"emailResponsavel"`
}

// Paineis lista os painéis sem expor os endereços dos responsáveis.
func (s *Servico) Paineis() ([]PainelPublico, error) {
	paineis, err := s.repo.Paineis()
	if err != nil {
		return nil, err
	}
	publicos := make([]PainelPublico, 0, len(paineis))
	for _, p := range paineis {
		publicos = append(publicos, p.Publico())
	}
	return publicos, nil
}

// Solicitar registra o pedido e avisa o responsável pelo painel.
//
// Quando o próprio responsável pede acesso, o e-mail de decisão vai para
// ele mesmo: clicar no link prova que a caixa é dele, e é assim que ele
// entra sem o sistema ter senha nenhuma.
func (s *Servico) Solicitar(emailBruto, painelID, deviceID, descricao string) (ResultadoSolicitacao, error) {
	var vazio ResultadoSolicitacao

	endereco := normalizarEmail(emailBruto)
	if !emailValido(endereco) {
		return vazio, ErrEmailInvalido
	}
	if deviceID == "" {
		return vazio, ErrDispositivoVazio
	}

	painel, err := s.repo.Painel(painelID)
	if err != nil {
		return vazio, err
	}

	// Acesso já concedido para este aparelho: devolve a credencial em vez de
	// incomodar o responsável de novo.
	if ativa, achou, err := s.repo.Ativa(endereco, painelID, deviceID); err != nil {
		return vazio, err
	} else if achou {
		credencial, err := s.emitir(ativa, painel)
		if err != nil {
			return vazio, err
		}
		return ResultadoSolicitacao{
			ID:               ativa.ID,
			Status:           ativa.Status,
			Credencial:       credencial,
			EmailResponsavel: painel.EmailResponsavel,
		}, nil
	}

	agora := s.agora()
	if quantas, err := s.repo.ContarDesde(deviceID, agora.Add(-JanelaLimite)); err != nil {
		return vazio, err
	} else if quantas >= MaxSolicitacoesJanela {
		return vazio, ErrMuitasSolicitacoes
	}

	papel := PapelMontador
	if endereco == normalizarEmail(painel.EmailResponsavel) {
		papel = PapelResponsavel
	}

	segredo, err := aleatorio()
	if err != nil {
		return vazio, err
	}

	solicitacao := Solicitacao{
		ID:              mustAleatorio(),
		Email:           endereco,
		PainelID:        painel.ID,
		DeviceID:        deviceID,
		Papel:           papel,
		Status:          StatusPendente,
		CriadoEm:        agora,
		ResumoDecisao:   resumir(segredo),
		ExpiraDecisaoEm: agora.Add(ValidadeLinkDecisao),
		Descricao:       descricao,
	}
	if err := s.repo.Salvar(solicitacao); err != nil {
		return vazio, err
	}

	if err := s.emissor.Enviar(s.montarAviso(solicitacao, painel, segredo)); err != nil {
		// O pedido já está registrado e aparece na tela do responsável, então
		// a falha de envio não invalida o fluxo — mas precisa ficar no log
		// para o TI investigar o transporte.
		log.Printf("falha ao enviar aviso da solicitação %s: %v", solicitacao.ID, err)
	}

	return ResultadoSolicitacao{
		ID:               solicitacao.ID,
		Status:           solicitacao.Status,
		EmailResponsavel: painel.EmailResponsavel,
	}, nil
}

// Consultar devolve o estado do pedido e, quando aprovado, a credencial.
// O aplicativo chama em intervalos enquanto a tela de espera está aberta.
//
// O deviceID é conferido: sem isso, quem descobrisse o identificador de uma
// solicitação alheia colheria a credencial dela.
func (s *Servico) Consultar(id, deviceID string) (ResultadoSolicitacao, error) {
	var vazio ResultadoSolicitacao

	solicitacao, err := s.repo.Solicitacao(id)
	if err != nil {
		return vazio, err
	}
	if subtle.ConstantTimeCompare([]byte(solicitacao.DeviceID), []byte(deviceID)) != 1 {
		return vazio, ErrNaoEncontrada
	}

	painel, err := s.repo.Painel(solicitacao.PainelID)
	if err != nil {
		return vazio, err
	}

	resultado := ResultadoSolicitacao{
		ID:               solicitacao.ID,
		Status:           solicitacao.Status,
		EmailResponsavel: painel.EmailResponsavel,
	}
	if solicitacao.RevogadoEm != nil {
		return resultado, ErrRevogada
	}
	if solicitacao.Status == StatusAprovada {
		credencial, err := s.emitir(solicitacao, painel)
		if err != nil {
			return vazio, err
		}
		resultado.Credencial = credencial
	}
	return resultado, nil
}

// Decidir aplica a escolha do responsável a partir do link do e-mail.
// O segredo do link é de uso único: é apagado aqui.
func (s *Servico) Decidir(id, segredo string, aprovar bool) (Solicitacao, error) {
	var vazio Solicitacao

	solicitacao, err := s.repo.Solicitacao(id)
	if err != nil {
		return vazio, err
	}
	if solicitacao.ResumoDecisao == "" {
		return vazio, ErrJaDecidida
	}
	if subtle.ConstantTimeCompare([]byte(solicitacao.ResumoDecisao), []byte(resumir(segredo))) != 1 {
		return vazio, ErrNaoEncontrada
	}

	agora := s.agora()
	if agora.After(solicitacao.ExpiraDecisaoEm) {
		return vazio, ErrLinkExpirado
	}

	painel, err := s.repo.Painel(solicitacao.PainelID)
	if err != nil {
		return vazio, err
	}

	solicitacao.Status = StatusNegada
	if aprovar {
		solicitacao.Status = StatusAprovada
	}
	solicitacao.DecididoEm = &agora
	solicitacao.DecididoPor = painel.EmailResponsavel
	solicitacao.ResumoDecisao = ""

	if err := s.repo.Salvar(solicitacao); err != nil {
		return vazio, err
	}
	return solicitacao, nil
}

// Listar devolve as solicitações do painel para a tela de autorizações.
// Só o responsável daquele painel enxerga a lista.
func (s *Servico) Listar(painelID string, quem token.Claims) ([]Solicitacao, error) {
	painel, err := s.repo.Painel(painelID)
	if err != nil {
		return nil, err
	}
	if err := s.autorizarResponsavel(painel, quem); err != nil {
		return nil, err
	}

	solicitacoes, err := s.repo.PorPainel(painelID)
	if err != nil {
		return nil, err
	}
	// Pendentes primeiro, e dentro de cada grupo as mais recentes no topo:
	// é a ordem em que o responsável precisa agir.
	sort.SliceStable(solicitacoes, func(i, j int) bool {
		pi := solicitacoes[i].Status == StatusPendente
		pj := solicitacoes[j].Status == StatusPendente
		if pi != pj {
			return pi
		}
		return solicitacoes[i].CriadoEm.After(solicitacoes[j].CriadoEm)
	})

	// O resumo do link nunca sai do servidor, nem para o responsável.
	for i := range solicitacoes {
		solicitacoes[i].ResumoDecisao = ""
	}
	return solicitacoes, nil
}

// DecidirPelaTela é a aprovação feita dentro do aplicativo, sem o link do
// e-mail — o caminho para o responsável resolver vários pedidos de uma vez.
func (s *Servico) DecidirPelaTela(id string, aprovar bool, quem token.Claims) (Solicitacao, error) {
	var vazio Solicitacao

	solicitacao, err := s.repo.Solicitacao(id)
	if err != nil {
		return vazio, err
	}
	painel, err := s.repo.Painel(solicitacao.PainelID)
	if err != nil {
		return vazio, err
	}
	if err := s.autorizarResponsavel(painel, quem); err != nil {
		return vazio, err
	}
	if solicitacao.Status != StatusPendente {
		return vazio, ErrJaDecidida
	}

	agora := s.agora()
	solicitacao.Status = StatusNegada
	if aprovar {
		solicitacao.Status = StatusAprovada
	}
	solicitacao.DecididoEm = &agora
	solicitacao.DecididoPor = quem.Email
	solicitacao.ResumoDecisao = ""

	if err := s.repo.Salvar(solicitacao); err != nil {
		return vazio, err
	}
	solicitacao.ResumoDecisao = ""
	return solicitacao, nil
}

// Revogar corta o acesso já concedido. Como a credencial vale offline, o
// corte só alcança o aparelho quando ele voltar a ter rede — o preço de
// deixar o montador trabalhar sem internet.
func (s *Servico) Revogar(id string, quem token.Claims) (Solicitacao, error) {
	var vazio Solicitacao

	solicitacao, err := s.repo.Solicitacao(id)
	if err != nil {
		return vazio, err
	}
	painel, err := s.repo.Painel(solicitacao.PainelID)
	if err != nil {
		return vazio, err
	}
	if err := s.autorizarResponsavel(painel, quem); err != nil {
		return vazio, err
	}

	agora := s.agora()
	solicitacao.RevogadoEm = &agora
	solicitacao.RevogadoPor = quem.Email
	solicitacao.ResumoDecisao = ""

	if err := s.repo.Salvar(solicitacao); err != nil {
		return vazio, err
	}
	return solicitacao, nil
}

// Revalidar confirma que uma credencial continua valendo. O aplicativo
// chama sempre que tem rede; é o que faz a revogação chegar ao aparelho.
func (s *Servico) Revalidar(claims token.Claims) (string, error) {
	solicitacao, err := s.repo.Solicitacao(claims.Sub)
	if err != nil {
		return "", err
	}
	if solicitacao.DeviceID != claims.DeviceID {
		return "", ErrNaoEncontrada
	}
	if solicitacao.RevogadoEm != nil {
		return "", ErrRevogada
	}
	if solicitacao.Status != StatusAprovada {
		return "", ErrNaoAprovada
	}

	painel, err := s.repo.Painel(solicitacao.PainelID)
	if err != nil {
		return "", err
	}
	// Renova a validade: quem usa o sistema com alguma frequência nunca
	// esbarra na expiração em campo.
	return s.emitir(solicitacao, painel)
}

// VerificarCredencial expõe a verificação de assinatura para os handlers.
func (s *Servico) VerificarCredencial(bruto string) (token.Claims, error) {
	return s.assinador.Verificar(bruto, s.agora())
}

// autorizarResponsavel exige que quem chama seja o responsável do painel.
func (s *Servico) autorizarResponsavel(painel Painel, quem token.Claims) error {
	if quem.Papel != string(PapelResponsavel) {
		return ErrSemPermissao
	}
	if quem.PainelID != painel.ID {
		return ErrSemPermissao
	}
	if normalizarEmail(quem.Email) != normalizarEmail(painel.EmailResponsavel) {
		return ErrSemPermissao
	}
	return nil
}

func (s *Servico) emitir(solicitacao Solicitacao, painel Painel) (string, error) {
	agora := s.agora()
	return s.assinador.Assinar(token.Claims{
		Sub:        solicitacao.ID,
		Email:      solicitacao.Email,
		PainelID:   painel.ID,
		PainelNome: painel.Nome,
		DeviceID:   solicitacao.DeviceID,
		Papel:      string(solicitacao.Papel),
		Iat:        agora.Unix(),
		Exp:        agora.Add(s.validade).Unix(),
	})
}

// montarAviso escreve o e-mail que o responsável recebe.
func (s *Servico) montarAviso(solicitacao Solicitacao, painel Painel, segredo string) email.Mensagem {
	aprovar := s.link(solicitacao.ID, segredo, true)
	negar := s.link(solicitacao.ID, segredo, false)

	destino := painel.EmailResponsavel
	assunto := fmt.Sprintf("Solicitação de acesso ao painel %s", painel.Nome)
	abertura := fmt.Sprintf(
		"%s pediu acesso ao painel %s no Sistema de Verificação de Montagem.",
		solicitacao.Email, painel.Nome)

	if solicitacao.Papel == PapelResponsavel {
		// O responsável pedindo o próprio acesso: o link vai para a caixa
		// dele, e clicar nele é a prova de posse do endereço.
		destino = solicitacao.Email
		assunto = fmt.Sprintf("Confirme seu acesso ao painel %s", painel.Nome)
		abertura = fmt.Sprintf(
			"Foi pedido acesso de responsável ao painel %s com o seu endereço. "+
				"Se foi você, confirme abaixo. Se não foi, ignore esta mensagem.",
			painel.Nome)
	}

	quando := solicitacao.CriadoEm.Format("02/01/2006 às 15:04")
	observacao := ""
	if solicitacao.Descricao != "" {
		observacao = "\nObservação de quem pediu: " + solicitacao.Descricao + "\n"
	}

	texto := fmt.Sprintf(`%s

Solicitante: %s
Painel: %s
Aparelho: %s
Data: %s
%s
Para APROVAR, abra:
%s

Para NEGAR, abra:
%s

Estes links valem por 48 horas e funcionam uma única vez.
Se você não reconhece este pedido, negue.
`, abertura, solicitacao.Email, painel.Nome, resumoCurto(solicitacao.DeviceID), quando, observacao, aprovar, negar)

	observacaoHTML := ""
	if solicitacao.Descricao != "" {
		observacaoHTML = fmt.Sprintf(
			`<p style="margin:16px 0;padding:12px;background:#f5f5f5;border-left:3px solid #ccc">%s</p>`,
			html.EscapeString(solicitacao.Descricao))
	}

	corpoHTML := fmt.Sprintf(`<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f1f1f">
<div style="max-width:520px;margin:0 auto">
<p style="font-size:16px;line-height:1.5">%s</p>
<table style="margin:16px 0;font-size:15px;border-collapse:collapse">
<tr><td style="padding:4px 16px 4px 0;color:#666">Solicitante</td><td style="padding:4px 0"><b>%s</b></td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#666">Painel</td><td style="padding:4px 0"><b>%s</b></td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#666">Aparelho</td><td style="padding:4px 0"><code>%s</code></td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#666">Data</td><td style="padding:4px 0">%s</td></tr>
</table>
%s
<p style="margin:24px 0">
<a href="%s" style="display:inline-block;padding:14px 28px;background:#ff000f;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Aprovar acesso</a>
<a href="%s" style="display:inline-block;padding:14px 28px;margin-left:8px;color:#1f1f1f;text-decoration:none;border:1px solid #ccc;border-radius:6px;font-weight:600">Negar</a>
</p>
<p style="font-size:13px;color:#666;line-height:1.5">Estes links valem por 48 horas e funcionam uma única vez.<br>Se você não reconhece este pedido, negue.</p>
</div>
</body></html>`,
		html.EscapeString(abertura),
		html.EscapeString(solicitacao.Email),
		html.EscapeString(painel.Nome),
		html.EscapeString(resumoCurto(solicitacao.DeviceID)),
		quando,
		observacaoHTML,
		html.EscapeString(aprovar),
		html.EscapeString(negar),
	)

	return email.Mensagem{
		Para:      destino,
		Assunto:   assunto,
		Texto:     texto,
		HTML:      corpoHTML,
		Responder: solicitacao.Email,
	}
}

func (s *Servico) link(id, segredo string, aprovar bool) string {
	acao := "negar"
	if aprovar {
		acao = "aprovar"
	}
	parametros := url.Values{"id": {id}, "t": {segredo}}
	return fmt.Sprintf("%s/api/decisao/%s?%s", s.urlBase, acao, parametros.Encode())
}

// resumoCurto identifica o aparelho no e-mail sem despejar o UUID inteiro.
func resumoCurto(deviceID string) string {
	soma := sha256.Sum256([]byte(deviceID))
	return hex.EncodeToString(soma[:4])
}

func resumir(segredo string) string {
	soma := sha256.Sum256([]byte(segredo))
	return hex.EncodeToString(soma[:])
}

func aleatorio() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

// mustAleatorio é usado onde a falha do gerador do sistema operacional já
// teria derrubado a chamada anterior.
func mustAleatorio() string {
	valor, err := aleatorio()
	if err != nil {
		panic("gerador aleatório do sistema indisponível: " + err.Error())
	}
	return valor
}
