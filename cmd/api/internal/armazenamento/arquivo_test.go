package armazenamento

import (
	"path/filepath"
	"testing"
	"time"

	"verificacao/api/internal/autorizacao"
)

var paineisDeTeste = []autorizacao.Painel{
	{ID: "power", Nome: "System Pro E Power", EmailResponsavel: "resp@empresa.com.br"},
}

func solicitacao(id, email, device string, status autorizacao.Status, criadoEm time.Time) autorizacao.Solicitacao {
	return autorizacao.Solicitacao{
		ID: id, Email: email, PainelID: "power", DeviceID: device,
		Papel: autorizacao.PapelMontador, Status: status, CriadoEm: criadoEm,
	}
}

func TestSobreviveAoReinicioDoServidor(t *testing.T) {
	caminho := filepath.Join(t.TempDir(), "dados", "autorizacoes.json")

	repo, err := Abrir(caminho, paineisDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.Salvar(solicitacao("s1", "a@empresa.com.br", "d1", autorizacao.StatusAprovada, time.Now())); err != nil {
		t.Fatal(err)
	}

	// Reabrir é o que acontece quando o serviço reinicia: quem tinha acesso
	// não pode precisar pedir de novo.
	reaberto, err := Abrir(caminho, paineisDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	lida, err := reaberto.Solicitacao("s1")
	if err != nil {
		t.Fatalf("a solicitação não sobreviveu ao reinício: %v", err)
	}
	if lida.Email != "a@empresa.com.br" || lida.Status != autorizacao.StatusAprovada {
		t.Fatalf("solicitação voltou diferente: %+v", lida)
	}

	if _, achou, err := reaberto.Ativa("a@empresa.com.br", "power", "d1"); err != nil {
		t.Fatal(err)
	} else if !achou {
		t.Fatal("a autorização vigente não foi reencontrada após o reinício")
	}
}

func TestAtivaIgnoraRevogadaEPendente(t *testing.T) {
	repo, err := Abrir(filepath.Join(t.TempDir(), "autorizacoes.json"), paineisDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	agora := time.Now()

	revogada := solicitacao("s1", "a@empresa.com.br", "d1", autorizacao.StatusAprovada, agora)
	revogada.RevogadoEm = &agora
	if err := repo.Salvar(revogada); err != nil {
		t.Fatal(err)
	}
	if err := repo.Salvar(solicitacao("s2", "b@empresa.com.br", "d2", autorizacao.StatusPendente, agora)); err != nil {
		t.Fatal(err)
	}

	for _, caso := range []struct{ email, device string }{
		{"a@empresa.com.br", "d1"},
		{"b@empresa.com.br", "d2"},
	} {
		if _, achou, err := repo.Ativa(caso.email, "power", caso.device); err != nil {
			t.Fatal(err)
		} else if achou {
			t.Fatalf("%s foi tratado como acesso vigente", caso.email)
		}
	}
}

func TestContarDesdeRespeitaAJanela(t *testing.T) {
	repo, err := Abrir(filepath.Join(t.TempDir(), "autorizacoes.json"), paineisDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	agora := time.Now()

	if err := repo.Salvar(solicitacao("velha", "a@empresa.com.br", "d1", autorizacao.StatusNegada, agora.Add(-2*time.Hour))); err != nil {
		t.Fatal(err)
	}
	if err := repo.Salvar(solicitacao("nova", "b@empresa.com.br", "d1", autorizacao.StatusPendente, agora)); err != nil {
		t.Fatal(err)
	}

	quantas, err := repo.ContarDesde("d1", agora.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if quantas != 1 {
		t.Fatalf("esperado 1 solicitação na janela, veio %d", quantas)
	}
}

func TestPainelDesconhecido(t *testing.T) {
	repo, err := Abrir(filepath.Join(t.TempDir(), "autorizacoes.json"), paineisDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Painel("nao-existe"); err == nil {
		t.Fatal("painel inexistente foi encontrado")
	}
}
