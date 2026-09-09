package autorizacao

import (
	"sort"
	"time"
)

// repoMemoria é a persistência dos testes. Mantém o mesmo contrato do
// armazenamento em arquivo sem tocar no disco.
type repoMemoria struct {
	paineis      []Painel
	solicitacoes map[string]Solicitacao
}

func (r *repoMemoria) Paineis() ([]Painel, error) {
	return append([]Painel(nil), r.paineis...), nil
}

func (r *repoMemoria) Painel(id string) (Painel, error) {
	for _, p := range r.paineis {
		if p.ID == id {
			return p, nil
		}
	}
	return Painel{}, ErrPainelDesconhecido
}

func (r *repoMemoria) Salvar(s Solicitacao) error {
	r.solicitacoes[s.ID] = s
	return nil
}

func (r *repoMemoria) Solicitacao(id string) (Solicitacao, error) {
	s, ok := r.solicitacoes[id]
	if !ok {
		return Solicitacao{}, ErrNaoEncontrada
	}
	return s, nil
}

func (r *repoMemoria) PorPainel(painelID string) ([]Solicitacao, error) {
	var achadas []Solicitacao
	for _, s := range r.solicitacoes {
		if s.PainelID == painelID {
			achadas = append(achadas, s)
		}
	}
	sort.Slice(achadas, func(i, j int) bool {
		return achadas[i].CriadoEm.After(achadas[j].CriadoEm)
	})
	return achadas, nil
}

func (r *repoMemoria) Ativa(email, painelID, deviceID string) (Solicitacao, bool, error) {
	for _, s := range r.solicitacoes {
		if s.Email == email && s.PainelID == painelID && s.DeviceID == deviceID && s.Ativa() {
			return s, true, nil
		}
	}
	return Solicitacao{}, false, nil
}

func (r *repoMemoria) ContarDesde(deviceID string, desde time.Time) (int, error) {
	quantas := 0
	for _, s := range r.solicitacoes {
		if s.DeviceID == deviceID && s.CriadoEm.After(desde) {
			quantas++
		}
	}
	return quantas, nil
}
