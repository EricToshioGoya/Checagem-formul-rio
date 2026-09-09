// Pacote autorizacao concentra as regras de quem pode abrir o aplicativo.
//
// O desenho parte de uma restrição de campo: o montador nem sempre tem
// internet. Por isso a autorização não é consultada a cada abertura — ela é
// concedida uma vez, vira uma credencial assinada guardada no aparelho e
// passa a valer offline até expirar ou ser revogada.
package autorizacao

import (
	"errors"
	"strings"
	"time"
)

// Erros que o servidor traduz em resposta HTTP.
var (
	ErrPainelDesconhecido = errors.New("painel desconhecido")
	ErrEmailInvalido      = errors.New("e-mail inválido")
	ErrDispositivoVazio   = errors.New("identificador do aparelho ausente")
	ErrNaoEncontrada      = errors.New("solicitação não encontrada")
	ErrJaDecidida         = errors.New("esta solicitação já foi decidida")
	ErrLinkExpirado       = errors.New("o link de decisão expirou")
	ErrNaoAprovada        = errors.New("solicitação ainda não aprovada")
	ErrRevogada           = errors.New("acesso revogado")
	ErrMuitasSolicitacoes = errors.New("muitas solicitações em pouco tempo")
	ErrSemPermissao       = errors.New("sem permissão")
)

// Papel distingue quem preenche formulários de quem aprova acessos.
type Papel string

const (
	PapelMontador    Papel = "montador"
	PapelResponsavel Papel = "responsavel"
)

// Status é o ciclo de vida de uma solicitação.
type Status string

const (
	StatusPendente Status = "pendente"
	StatusAprovada Status = "aprovada"
	StatusNegada   Status = "negada"
)

// Painel é uma linha de produto com um responsável que aprova os acessos.
// A lista mora no servidor, e não em public/forms: o e-mail do responsável
// não pode ser servido a quem ainda não entrou.
type Painel struct {
	ID               string `json:"id"`
	Nome             string `json:"nome"`
	EmailResponsavel string `json:"emailResponsavel"`
}

// PainelPublico é o que o aplicativo recebe antes de qualquer autorização:
// só o suficiente para montar a lista de escolha, sem expor endereços.
type PainelPublico struct {
	ID   string `json:"id"`
	Nome string `json:"nome"`
}

// Publico remove o e-mail do responsável.
func (p Painel) Publico() PainelPublico {
	return PainelPublico{ID: p.ID, Nome: p.Nome}
}

// Solicitacao é o registro completo de um pedido de acesso, e também a
// trilha de auditoria: quem pediu, de qual aparelho, quem decidiu e quando.
type Solicitacao struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	PainelID string `json:"painelId"`
	// DeviceID amarra a autorização ao aparelho. É o que impede que alguém
	// entre apenas digitando um e-mail já aprovado por outra pessoa: outro
	// aparelho gera outra solicitação, e o responsável recebe novo aviso.
	DeviceID string `json:"deviceId"`
	Papel    Papel  `json:"papel"`
	Status   Status `json:"status"`

	CriadoEm    time.Time  `json:"criadoEm"`
	DecididoEm  *time.Time `json:"decididoEm,omitempty"`
	DecididoPor string     `json:"decididoPor,omitempty"`
	RevogadoEm  *time.Time `json:"revogadoEm,omitempty"`
	RevogadoPor string     `json:"revogadoPor,omitempty"`

	// ResumoDecisao é o SHA-256 do segredo que vai no link do e-mail. O
	// segredo em si nunca é gravado: vazamento do banco não permite aprovar
	// nada. É apagado no primeiro uso, o que torna o link de uso único.
	ResumoDecisao   string    `json:"resumoDecisao,omitempty"`
	ExpiraDecisaoEm time.Time `json:"expiraDecisaoEm,omitempty"`

	// Descricao é o texto livre que o solicitante manda ao responsável.
	Descricao string `json:"descricao,omitempty"`
}

// Ativa informa se a solicitação ainda concede acesso.
func (s Solicitacao) Ativa() bool {
	return s.Status == StatusAprovada && s.RevogadoEm == nil
}

// normalizarEmail deixa o endereço comparável: é a chave que liga a
// solicitação ao responsável, e diferença de caixa não pode separá-los.
func normalizarEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// emailValido faz a checagem mínima que faz sentido no servidor. A prova
// real de posse do endereço é o responsável reconhecer quem está pedindo.
func emailValido(email string) bool {
	arroba := strings.IndexByte(email, '@')
	if arroba <= 0 || arroba == len(email)-1 {
		return false
	}
	dominio := email[arroba+1:]
	return strings.Contains(dominio, ".") &&
		!strings.HasPrefix(dominio, ".") &&
		!strings.HasSuffix(dominio, ".") &&
		!strings.ContainsAny(email, " \t\r\n")
}

// Repositorio é a persistência que o serviço exige. A implementação de
// arquivo atende o volume desta aplicação; trocar por Postgres é escrever
// outra implementação desta interface, sem tocar nas regras.
type Repositorio interface {
	Paineis() ([]Painel, error)
	Painel(id string) (Painel, error)

	Salvar(Solicitacao) error
	Solicitacao(id string) (Solicitacao, error)
	// PorPainel devolve as solicitações de um painel, mais recentes primeiro.
	PorPainel(painelID string) ([]Solicitacao, error)
	// Ativa procura autorização vigente para a tripla e-mail + painel +
	// aparelho, que é o que evita pedir de novo o que já foi concedido.
	Ativa(email, painelID, deviceID string) (Solicitacao, bool, error)
	// ContarDesde conta solicitações do mesmo aparelho na janela, para o
	// limite que impede transformar o servidor em disparador de spam.
	ContarDesde(deviceID string, desde time.Time) (int, error)
}
