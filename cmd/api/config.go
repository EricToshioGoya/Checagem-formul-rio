package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"verificacao/api/internal/autorizacao"
	"verificacao/api/internal/email"
)

// Config é lida inteiramente do ambiente. Nada de segredo em código, e o
// mesmo binário serve desenvolvimento, homologação e produção.
type Config struct {
	Porta        int
	URLBase      string
	Origens      []string
	Dados        string
	ChavePrivada string
	Paineis      string
	Validade     time.Duration
}

func lerConfig() (Config, error) {
	porta, err := inteiroAmbiente("PORTA", 8090)
	if err != nil {
		return Config{}, err
	}
	dias, err := inteiroAmbiente("VALIDADE_DIAS", 90)
	if err != nil {
		return Config{}, err
	}
	if dias < 1 {
		return Config{}, errors.New("VALIDADE_DIAS precisa ser pelo menos 1")
	}

	c := Config{
		Porta: porta,
		// URL_BASE é o endereço pelo qual o responsável alcança a API a
		// partir do e-mail. Em produção é o domínio publicado, não localhost.
		URLBase:      textoAmbiente("URL_BASE", fmt.Sprintf("http://localhost:%d", porta)),
		Dados:        textoAmbiente("DADOS", "dados/autorizacoes.json"),
		ChavePrivada: textoAmbiente("CHAVE_PRIVADA", "dados/chave-sessao.pem"),
		Paineis:      textoAmbiente("PAINEIS", "paineis.json"),
		Validade:     time.Duration(dias) * 24 * time.Hour,
	}
	c.URLBase = strings.TrimRight(c.URLBase, "/")

	// ORIGENS lista os endereços do aplicativo autorizados a chamar a API.
	// Vazio libera qualquer origem, o que só serve em desenvolvimento.
	for _, origem := range strings.Split(textoAmbiente("ORIGENS", ""), ",") {
		if limpa := strings.TrimSpace(origem); limpa != "" {
			c.Origens = append(c.Origens, strings.TrimRight(limpa, "/"))
		}
	}
	return c, nil
}

// lerPaineis carrega a lista de painéis e seus responsáveis.
func lerPaineis(caminho string) ([]autorizacao.Painel, error) {
	bytes, err := os.ReadFile(caminho)
	if err != nil {
		return nil, fmt.Errorf("ler %s: %w", caminho, err)
	}

	var paineis []autorizacao.Painel
	if err := json.Unmarshal(bytes, &paineis); err != nil {
		return nil, fmt.Errorf("conteúdo de %s ilegível: %w", caminho, err)
	}
	if len(paineis) == 0 {
		return nil, fmt.Errorf("%s não lista nenhum painel", caminho)
	}

	vistos := map[string]bool{}
	for _, p := range paineis {
		switch {
		case p.ID == "":
			return nil, errors.New("há painel sem id")
		case p.Nome == "":
			return nil, fmt.Errorf("o painel %s está sem nome", p.ID)
		case !strings.Contains(p.EmailResponsavel, "@"):
			return nil, fmt.Errorf("o painel %s está sem e-mail de responsável válido", p.ID)
		case vistos[p.ID]:
			return nil, fmt.Errorf("o id de painel %s aparece duas vezes", p.ID)
		}
		vistos[p.ID] = true
	}
	return paineis, nil
}

// montarEmissor escolhe o transporte pelo ambiente. Sem SMTP_HOST, o
// servidor sobe com o emissor de log — é o que permite exercitar o fluxo
// inteiro enquanto o TI não define o servidor de e-mail.
func montarEmissor() (email.Emissor, string, error) {
	host := textoAmbiente("SMTP_HOST", "")
	if host == "" {
		return email.EmissorLog{}, "log (nenhum e-mail é enviado de verdade)", nil
	}

	porta, err := inteiroAmbiente("SMTP_PORTA", 587)
	if err != nil {
		return nil, "", err
	}
	de := textoAmbiente("SMTP_DE", "")
	if de == "" {
		return nil, "", errors.New("SMTP_HOST definido exige SMTP_DE (endereço remetente)")
	}

	return email.EmissorSMTP{
		Host:    host,
		Porta:   porta,
		Usuario: textoAmbiente("SMTP_USUARIO", ""),
		Senha:   textoAmbiente("SMTP_SENHA", ""),
		De:      de,
		DeNome:  textoAmbiente("SMTP_DE_NOME", "Verificação de Montagem de Painéis"),
		SemTLS:  textoAmbiente("SMTP_SEM_TLS", "") == "1",
	}, fmt.Sprintf("SMTP %s:%d", host, porta), nil
}

func textoAmbiente(chave, padrao string) string {
	if valor := os.Getenv(chave); valor != "" {
		return valor
	}
	return padrao
}

func inteiroAmbiente(chave string, padrao int) (int, error) {
	bruto := os.Getenv(chave)
	if bruto == "" {
		return padrao, nil
	}
	valor, err := strconv.Atoi(bruto)
	if err != nil {
		return 0, fmt.Errorf("%s precisa ser um número inteiro: %q", chave, bruto)
	}
	return valor, nil
}
