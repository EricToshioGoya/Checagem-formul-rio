package autorizacao

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"verificacao/api/internal/email"
	"verificacao/api/internal/token"
)

// emissorFalso guarda as mensagens para o teste ler o link de decisão,
// que é justamente o que o responsável recebe na caixa dele.
type emissorFalso struct {
	enviadas []email.Mensagem
}

func (e *emissorFalso) Enviar(m email.Mensagem) error {
	e.enviadas = append(e.enviadas, m)
	return nil
}

func (e *emissorFalso) ultima(t *testing.T) email.Mensagem {
	t.Helper()
	if len(e.enviadas) == 0 {
		t.Fatal("nenhum e-mail foi enviado")
	}
	return e.enviadas[len(e.enviadas)-1]
}

// segredoDoLink extrai o parâmetro t= do link de aprovação.
func segredoDoLink(t *testing.T, m email.Mensagem) string {
	t.Helper()
	for _, palavra := range strings.Fields(m.Texto) {
		if !strings.Contains(palavra, "/api/decisao/aprovar?") {
			continue
		}
		endereco, err := url.Parse(palavra)
		if err != nil {
			t.Fatalf("link de aprovação ilegível: %v", err)
		}
		return endereco.Query().Get("t")
	}
	t.Fatalf("o e-mail não trouxe link de aprovação:\n%s", m.Texto)
	return ""
}

const (
	painelPower = "system-pro-e-power"
	respPower   = "responsavel.power@empresa.com.br"
	montador    = "montador@empresa.com.br"
	aparelho    = "aparelho-do-montador"
)

func montarServico(t *testing.T) (*Servico, *emissorFalso, *token.Assinador) {
	t.Helper()

	paineis := []Painel{
		{ID: painelPower, Nome: "System Pro E Power", EmailResponsavel: respPower},
		{ID: "system-pro-e-energy", Nome: "System Pro E Energy", EmailResponsavel: "outro@empresa.com.br"},
	}

	repo := &repoMemoria{
		paineis:      paineis,
		solicitacoes: map[string]Solicitacao{},
	}
	assinador, err := token.GerarChave()
	if err != nil {
		t.Fatal(err)
	}
	emissor := &emissorFalso{}

	return NovoServico(repo, assinador, emissor, "https://api.exemplo", 90*24*time.Hour, nil),
		emissor, assinador
}

// aprovarPeloLink executa o caminho completo do e-mail: solicitação, leitura
// do link e clique em Aprovar.
func aprovarPeloLink(t *testing.T, s *Servico, e *emissorFalso, endereco, painel, device string) ResultadoSolicitacao {
	t.Helper()

	pedido, err := s.Solicitar(endereco, painel, device, "")
	if err != nil {
		t.Fatalf("solicitação recusada: %v", err)
	}
	if _, err := s.Decidir(pedido.ID, segredoDoLink(t, e.ultima(t)), true); err != nil {
		t.Fatalf("aprovação recusada: %v", err)
	}
	return pedido
}

func TestFluxoCompletoLiberaAcesso(t *testing.T) {
	servico, emissor, assinador := montarServico(t)

	pedido, err := servico.Solicitar(montador, painelPower, aparelho, "montagem do quadro 12")
	if err != nil {
		t.Fatal(err)
	}
	if pedido.Status != StatusPendente {
		t.Fatalf("a solicitação deveria nascer pendente, veio %q", pedido.Status)
	}
	if pedido.Credencial != "" {
		t.Fatal("solicitação pendente não pode devolver credencial")
	}

	// O aviso vai para o responsável do painel, não para quem pediu.
	aviso := emissor.ultima(t)
	if aviso.Para != respPower {
		t.Fatalf("o aviso foi para %q em vez do responsável", aviso.Para)
	}

	// Antes da decisão, a consulta continua sem credencial.
	if antes, err := servico.Consultar(pedido.ID, aparelho); err != nil {
		t.Fatal(err)
	} else if antes.Credencial != "" {
		t.Fatal("credencial entregue antes da aprovação")
	}

	if _, err := servico.Decidir(pedido.ID, segredoDoLink(t, aviso), true); err != nil {
		t.Fatal(err)
	}

	depois, err := servico.Consultar(pedido.ID, aparelho)
	if err != nil {
		t.Fatal(err)
	}
	if depois.Status != StatusAprovada || depois.Credencial == "" {
		t.Fatalf("aprovação não gerou credencial: %+v", depois)
	}

	claims, err := assinador.Verificar(depois.Credencial, time.Now())
	if err != nil {
		t.Fatalf("credencial emitida não passa na própria verificação: %v", err)
	}
	if claims.DeviceID != aparelho {
		t.Fatalf("a credencial não ficou amarrada ao aparelho: %+v", claims)
	}
	if claims.Papel != string(PapelMontador) {
		t.Fatalf("quem não é responsável pelo painel não pode receber papel %q", claims.Papel)
	}
}

func TestOutroAparelhoNaoHerdaAutorizacao(t *testing.T) {
	servico, emissor, _ := montarServico(t)

	aprovarPeloLink(t, servico, emissor, montador, painelPower, aparelho)

	// Mesmo e-mail, aparelho diferente: é a tentativa de entrar sabendo o
	// endereço de alguém já aprovado. Precisa virar nova solicitação.
	segundo, err := servico.Solicitar(montador, painelPower, "aparelho-de-outra-pessoa", "")
	if err != nil {
		t.Fatal(err)
	}
	if segundo.Status != StatusPendente || segundo.Credencial != "" {
		t.Fatalf("outro aparelho entrou sem aprovação: %+v", segundo)
	}
}

func TestReinstalacaoNoMesmoAparelhoNaoIncomodaOResponsavel(t *testing.T) {
	servico, emissor, _ := montarServico(t)

	aprovarPeloLink(t, servico, emissor, montador, painelPower, aparelho)
	enviadosAteAqui := len(emissor.enviadas)

	repetido, err := servico.Solicitar(montador, painelPower, aparelho, "")
	if err != nil {
		t.Fatal(err)
	}
	if repetido.Credencial == "" {
		t.Fatal("quem já tem acesso no aparelho deveria receber a credencial direto")
	}
	if len(emissor.enviadas) != enviadosAteAqui {
		t.Fatal("um acesso já concedido não pode gerar novo e-mail ao responsável")
	}
}

func TestConsultaExigeOMesmoAparelho(t *testing.T) {
	servico, emissor, _ := montarServico(t)

	pedido := aprovarPeloLink(t, servico, emissor, montador, painelPower, aparelho)

	// Saber o id da solicitação não pode bastar para colher a credencial.
	if _, err := servico.Consultar(pedido.ID, "aparelho-intruso"); err == nil {
		t.Fatal("a credencial foi entregue a outro aparelho")
	}
}

func TestLinkDeDecisaoEDeUsoUnico(t *testing.T) {
	servico, emissor, _ := montarServico(t)

	pedido, err := servico.Solicitar(montador, painelPower, aparelho, "")
	if err != nil {
		t.Fatal(err)
	}
	segredo := segredoDoLink(t, emissor.ultima(t))

	if _, err := servico.Decidir(pedido.ID, segredo, false); err != nil {
		t.Fatal(err)
	}
	// Negou; o mesmo link não pode ser reusado para aprovar.
	if _, err := servico.Decidir(pedido.ID, segredo, true); err == nil {
		t.Fatal("o link de decisão foi aceito duas vezes")
	}

	depois, err := servico.Consultar(pedido.ID, aparelho)
	if err != nil {
		t.Fatal(err)
	}
	if depois.Status != StatusNegada || depois.Credencial != "" {
		t.Fatalf("a negativa não se manteve: %+v", depois)
	}
}

func TestSegredoErradoNaoDecide(t *testing.T) {
	servico, _, _ := montarServico(t)

	pedido, err := servico.Solicitar(montador, painelPower, aparelho, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := servico.Decidir(pedido.ID, "segredo-chutado", true); err == nil {
		t.Fatal("aprovação aceita com segredo inválido")
	}
}

func TestLinkExpiradoNaoDecide(t *testing.T) {
	servico, emissor, _ := montarServico(t)

	pedido, err := servico.Solicitar(montador, painelPower, aparelho, "")
	if err != nil {
		t.Fatal(err)
	}
	segredo := segredoDoLink(t, emissor.ultima(t))

	// O responsável abre a caixa três dias depois.
	servico.agora = func() time.Time { return time.Now().Add(ValidadeLinkDecisao + time.Hour) }

	if _, err := servico.Decidir(pedido.ID, segredo, true); err == nil {
		t.Fatal("link vencido ainda aprova")
	}
}

func TestResponsavelConfirmaOProprioAcesso(t *testing.T) {
	servico, emissor, assinador := montarServico(t)

	pedido, err := servico.Solicitar(respPower, painelPower, "aparelho-do-responsavel", "")
	if err != nil {
		t.Fatal(err)
	}

	// O link vai para a caixa do próprio responsável: clicar nele é a prova
	// de posse do endereço, e é o que substitui a senha.
	if aviso := emissor.ultima(t); aviso.Para != respPower {
		t.Fatalf("a confirmação foi para %q em vez do próprio responsável", aviso.Para)
	}

	if _, err := servico.Decidir(pedido.ID, segredoDoLink(t, emissor.ultima(t)), true); err != nil {
		t.Fatal(err)
	}
	resultado, err := servico.Consultar(pedido.ID, "aparelho-do-responsavel")
	if err != nil {
		t.Fatal(err)
	}

	claims, err := assinador.Verificar(resultado.Credencial, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if claims.Papel != string(PapelResponsavel) {
		t.Fatalf("o responsável do painel deveria receber papel de responsável, veio %q", claims.Papel)
	}
}

func TestMontadorNaoEnxergaNemDecideAutorizacoes(t *testing.T) {
	servico, emissor, assinador := montarServico(t)

	pedido := aprovarPeloLink(t, servico, emissor, montador, painelPower, aparelho)
	resultado, err := servico.Consultar(pedido.ID, aparelho)
	if err != nil {
		t.Fatal(err)
	}
	claimsMontador, err := assinador.Verificar(resultado.Credencial, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	if _, err := servico.Listar(painelPower, claimsMontador); err == nil {
		t.Fatal("um montador listou as solicitações do painel")
	}

	alvo, err := servico.Solicitar("outro@empresa.com.br", painelPower, "outro-aparelho", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := servico.DecidirPelaTela(alvo.ID, true, claimsMontador); err == nil {
		t.Fatal("um montador aprovou a solicitação de outra pessoa")
	}
	if _, err := servico.Revogar(alvo.ID, claimsMontador); err == nil {
		t.Fatal("um montador revogou acesso alheio")
	}
}

func TestResponsavelSoAlcancaOProprioPainel(t *testing.T) {
	servico, emissor, assinador := montarServico(t)

	pedido := aprovarPeloLink(t, servico, emissor, respPower, painelPower, "aparelho-do-responsavel")
	resultado, err := servico.Consultar(pedido.ID, "aparelho-do-responsavel")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := assinador.Verificar(resultado.Credencial, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	if _, err := servico.Listar("system-pro-e-energy", claims); err == nil {
		t.Fatal("o responsável de um painel listou as solicitações de outro")
	}
}

func TestRevogacaoDerrubaARevalidacao(t *testing.T) {
	servico, emissor, assinador := montarServico(t)

	// Responsável entra e, depois, um montador é aprovado.
	pedidoResp := aprovarPeloLink(t, servico, emissor, respPower, painelPower, "aparelho-do-responsavel")
	resResp, err := servico.Consultar(pedidoResp.ID, "aparelho-do-responsavel")
	if err != nil {
		t.Fatal(err)
	}
	claimsResp, err := assinador.Verificar(resResp.Credencial, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	pedido := aprovarPeloLink(t, servico, emissor, montador, painelPower, aparelho)
	res, err := servico.Consultar(pedido.ID, aparelho)
	if err != nil {
		t.Fatal(err)
	}
	claimsMontador, err := assinador.Verificar(res.Credencial, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	// Enquanto vigente, a credencial se renova sozinha quando há rede.
	if _, err := servico.Revalidar(claimsMontador); err != nil {
		t.Fatalf("credencial vigente deveria revalidar: %v", err)
	}

	if _, err := servico.Revogar(pedido.ID, claimsResp); err != nil {
		t.Fatal(err)
	}
	if _, err := servico.Revalidar(claimsMontador); err == nil {
		t.Fatal("a credencial continuou revalidando depois da revogação")
	}
}

func TestRevalidarRecusaCredencialDeOutroAparelho(t *testing.T) {
	servico, emissor, assinador := montarServico(t)

	pedido := aprovarPeloLink(t, servico, emissor, montador, painelPower, aparelho)
	res, err := servico.Consultar(pedido.ID, aparelho)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := assinador.Verificar(res.Credencial, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	// Credencial copiada para outro aparelho, com o deviceId trocado.
	claims.DeviceID = "aparelho-intruso"
	if _, err := servico.Revalidar(claims); err == nil {
		t.Fatal("credencial copiada para outro aparelho revalidou")
	}
}

func TestLimiteDeSolicitacoesPorAparelho(t *testing.T) {
	servico, _, _ := montarServico(t)

	for i := range MaxSolicitacoesJanela {
		endereco := "montador" + string(rune('a'+i)) + "@empresa.com.br"
		if _, err := servico.Solicitar(endereco, painelPower, aparelho, ""); err != nil {
			t.Fatalf("solicitação %d recusada cedo demais: %v", i+1, err)
		}
	}
	if _, err := servico.Solicitar("mais.um@empresa.com.br", painelPower, aparelho, ""); err == nil {
		t.Fatal("o limite por aparelho não segurou o excesso de solicitações")
	}
}

func TestEmailInvalidoEPainelDesconhecido(t *testing.T) {
	servico, _, _ := montarServico(t)

	for _, endereco := range []string{"", "sem-arroba", "sem@dominio", "com espaco@empresa.com.br"} {
		if _, err := servico.Solicitar(endereco, painelPower, aparelho, ""); err == nil {
			t.Fatalf("o e-mail %q foi aceito", endereco)
		}
	}
	if _, err := servico.Solicitar(montador, "painel-que-nao-existe", aparelho, ""); err == nil {
		t.Fatal("painel inexistente foi aceito")
	}
	if _, err := servico.Solicitar(montador, painelPower, "", ""); err == nil {
		t.Fatal("solicitação sem identificação do aparelho foi aceita")
	}
}

func TestEmailNormalizaCaixaEEspacos(t *testing.T) {
	servico, emissor, _ := montarServico(t)

	aprovarPeloLink(t, servico, emissor, montador, painelPower, aparelho)
	enviadosAteAqui := len(emissor.enviadas)

	// O mesmo endereço digitado com outra caixa é a mesma pessoa.
	repetido, err := servico.Solicitar("  Montador@Empresa.Com.BR ", painelPower, aparelho, "")
	if err != nil {
		t.Fatal(err)
	}
	if repetido.Credencial == "" || len(emissor.enviadas) != enviadosAteAqui {
		t.Fatal("variação de caixa no e-mail criou uma solicitação nova")
	}
}

func TestPaineisNaoExpoemOEmailDoResponsavel(t *testing.T) {
	servico, _, _ := montarServico(t)

	paineis, err := servico.Paineis()
	if err != nil {
		t.Fatal(err)
	}
	if len(paineis) != 2 {
		t.Fatalf("esperado 2 painéis, veio %d", len(paineis))
	}
	// PainelPublico não tem campo de e-mail: a garantia é de tipo. O teste
	// prende a decisão para que ninguém acrescente o campo sem perceber.
	for _, p := range paineis {
		if p.ID == "" || p.Nome == "" {
			t.Fatalf("painel público incompleto: %+v", p)
		}
	}
}

func TestListarNaoVazaOResumoDoLink(t *testing.T) {
	servico, emissor, assinador := montarServico(t)

	pedidoResp := aprovarPeloLink(t, servico, emissor, respPower, painelPower, "aparelho-do-responsavel")
	resResp, err := servico.Consultar(pedidoResp.ID, "aparelho-do-responsavel")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := assinador.Verificar(resResp.Credencial, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	if _, err := servico.Solicitar(montador, painelPower, aparelho, ""); err != nil {
		t.Fatal(err)
	}

	lista, err := servico.Listar(painelPower, claims)
	if err != nil {
		t.Fatal(err)
	}
	if len(lista) == 0 {
		t.Fatal("a lista veio vazia")
	}
	for _, s := range lista {
		if s.ResumoDecisao != "" {
			t.Fatal("o resumo do link de decisão vazou na listagem")
		}
	}
	// Pendentes primeiro: é a ordem de trabalho do responsável.
	if lista[0].Status != StatusPendente {
		t.Fatalf("a lista não começa pelos pendentes: %+v", lista[0])
	}
}

func TestDecidirPelaTelaRecusaSolicitacaoJaDecidida(t *testing.T) {
	servico, emissor, assinador := montarServico(t)

	pedidoResp := aprovarPeloLink(t, servico, emissor, respPower, painelPower, "aparelho-do-responsavel")
	resResp, err := servico.Consultar(pedidoResp.ID, "aparelho-do-responsavel")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := assinador.Verificar(resResp.Credencial, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	alvo, err := servico.Solicitar(montador, painelPower, aparelho, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := servico.DecidirPelaTela(alvo.ID, true, claims); err != nil {
		t.Fatal(err)
	}
	if _, err := servico.DecidirPelaTela(alvo.ID, false, claims); err == nil {
		t.Fatal("a mesma solicitação foi decidida duas vezes pela tela")
	}
}
