// Pacote armazenamento implementa a persistência das solicitações.
//
// A implementação em arquivo JSON é deliberada, não provisória: o volume
// desta aplicação é de uma tabela com algumas centenas de linhas para uma
// equipe conhecida. Um banco a mais no servidor da empresa seria custo de
// operação sem benefício. A interface autorizacao.Repositorio continua
// sendo o ponto de troca se o volume mudar.
package armazenamento

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"verificacao/api/internal/autorizacao"
)

// Arquivo guarda as solicitações num JSON e mantém tudo em memória.
//
// Os painéis não moram aqui: vêm da configuração do servidor, porque o
// e-mail de um responsável é decisão de operação e não pode ser alterado
// por nenhuma rota da API.
type Arquivo struct {
	caminho string
	paineis []autorizacao.Painel

	mu           sync.RWMutex
	solicitacoes map[string]autorizacao.Solicitacao
}

type conteudo struct {
	Versao       int                       `json:"versao"`
	Solicitacoes []autorizacao.Solicitacao `json:"solicitacoes"`
}

// Abrir carrega o arquivo, criando-o vazio se ainda não existir.
func Abrir(caminho string, paineis []autorizacao.Painel) (*Arquivo, error) {
	a := &Arquivo{
		caminho:      caminho,
		paineis:      paineis,
		solicitacoes: map[string]autorizacao.Solicitacao{},
	}

	bytes, err := os.ReadFile(caminho)
	if os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(caminho), 0o750); err != nil {
			return nil, fmt.Errorf("criar diretório de dados: %w", err)
		}
		return a, a.gravar()
	}
	if err != nil {
		return nil, fmt.Errorf("ler %s: %w", caminho, err)
	}

	var lido conteudo
	if err := json.Unmarshal(bytes, &lido); err != nil {
		return nil, fmt.Errorf("conteúdo de %s ilegível: %w", caminho, err)
	}
	for _, s := range lido.Solicitacoes {
		a.solicitacoes[s.ID] = s
	}
	return a, nil
}

func (a *Arquivo) Paineis() ([]autorizacao.Painel, error) {
	return append([]autorizacao.Painel(nil), a.paineis...), nil
}

func (a *Arquivo) Painel(id string) (autorizacao.Painel, error) {
	for _, p := range a.paineis {
		if p.ID == id {
			return p, nil
		}
	}
	return autorizacao.Painel{}, autorizacao.ErrPainelDesconhecido
}

func (a *Arquivo) Salvar(s autorizacao.Solicitacao) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.solicitacoes[s.ID] = s
	return a.gravar()
}

func (a *Arquivo) Solicitacao(id string) (autorizacao.Solicitacao, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	s, ok := a.solicitacoes[id]
	if !ok {
		return autorizacao.Solicitacao{}, autorizacao.ErrNaoEncontrada
	}
	return s, nil
}

func (a *Arquivo) PorPainel(painelID string) ([]autorizacao.Solicitacao, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	var achadas []autorizacao.Solicitacao
	for _, s := range a.solicitacoes {
		if s.PainelID == painelID {
			achadas = append(achadas, s)
		}
	}
	sort.Slice(achadas, func(i, j int) bool {
		return achadas[i].CriadoEm.After(achadas[j].CriadoEm)
	})
	return achadas, nil
}

func (a *Arquivo) Ativa(email, painelID, deviceID string) (autorizacao.Solicitacao, bool, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	for _, s := range a.solicitacoes {
		if s.Email == email && s.PainelID == painelID && s.DeviceID == deviceID && s.Ativa() {
			return s, true, nil
		}
	}
	return autorizacao.Solicitacao{}, false, nil
}

func (a *Arquivo) ContarDesde(deviceID string, desde time.Time) (int, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	quantas := 0
	for _, s := range a.solicitacoes {
		if s.DeviceID == deviceID && s.CriadoEm.After(desde) {
			quantas++
		}
	}
	return quantas, nil
}

// gravar escreve num temporário e renomeia: uma queda no meio da escrita
// deixa o arquivo anterior intacto em vez de um JSON truncado.
//
// Chamadores precisam segurar a.mu para escrita, exceto em Abrir, onde
// nada mais enxerga o valor ainda.
func (a *Arquivo) gravar() error {
	lista := make([]autorizacao.Solicitacao, 0, len(a.solicitacoes))
	for _, s := range a.solicitacoes {
		lista = append(lista, s)
	}
	sort.Slice(lista, func(i, j int) bool {
		return lista[i].CriadoEm.Before(lista[j].CriadoEm)
	})

	bytes, err := json.MarshalIndent(conteudo{Versao: 1, Solicitacoes: lista}, "", "  ")
	if err != nil {
		return err
	}

	temporario := a.caminho + ".tmp"
	if err := os.WriteFile(temporario, bytes, 0o640); err != nil {
		return fmt.Errorf("gravar %s: %w", temporario, err)
	}
	if err := os.Rename(temporario, a.caminho); err != nil {
		return fmt.Errorf("substituir %s: %w", a.caminho, err)
	}
	return nil
}
