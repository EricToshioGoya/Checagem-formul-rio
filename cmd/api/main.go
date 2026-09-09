// API de autorização do Sistema de Verificação de Montagem de Painéis.
//
// Guarda quem pediu acesso a qual painel, avisa o responsável por e-mail e,
// uma vez aprovado, emite a credencial assinada que o aplicativo passa a
// apresentar — inclusive offline, que é a condição real de uso em campo.
//
// Os preenchimentos continuam no aparelho: este servidor não recebe dado
// de formulário nenhum.
package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"verificacao/api/internal/armazenamento"
	"verificacao/api/internal/autorizacao"
	"verificacao/api/internal/token"
)

func main() {
	gerarChave := flag.Bool("gerar-chave", false,
		"gera o par de chaves de sessão, grava a privada e imprime a pública (JWK)")
	flag.Parse()

	config, err := lerConfig()
	if err != nil {
		log.Fatalf("Configuração inválida: %v", err)
	}

	if *gerarChave {
		if err := gerarParDeChaves(config.ChavePrivada); err != nil {
			log.Fatalf("Não foi possível gerar as chaves: %v", err)
		}
		return
	}

	if err := executar(config); err != nil {
		log.Fatalf("Servidor encerrado: %v", err)
	}
}

func executar(config Config) error {
	paineis, err := lerPaineis(config.Paineis)
	if err != nil {
		return err
	}

	assinador, err := carregarOuCriarChave(config.ChavePrivada)
	if err != nil {
		return err
	}

	repo, err := armazenamento.Abrir(config.Dados, paineis)
	if err != nil {
		return err
	}

	emissor, descricaoEmissor, err := montarEmissor()
	if err != nil {
		return err
	}

	servico := autorizacao.NovoServico(
		repo, assinador, emissor, config.URLBase, config.Validade, nil)

	jwk, err := assinador.JWK()
	if err != nil {
		return err
	}

	log.Printf("API de autorização em http://0.0.0.0:%d", config.Porta)
	log.Printf("URL pública (links do e-mail): %s", config.URLBase)
	log.Printf("Painéis: %d | Validade da credencial: %d dias",
		len(paineis), int(config.Validade.Hours()/24))
	log.Printf("Envio de e-mail: %s", descricaoEmissor)
	if len(config.Origens) == 0 {
		log.Printf("ATENÇÃO: ORIGENS vazio — qualquer origem pode chamar a API. " +
			"Defina ORIGENS com o endereço do aplicativo antes de publicar.")
	}

	servidor := &http.Server{
		Addr:              fmt.Sprintf(":%d", config.Porta),
		Handler:           comCORS(config.Origens, rotas(servico, jwk)),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
	}
	if err := servidor.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// carregarOuCriarChave lê a chave de sessão do disco e, na primeira
// execução, cria uma. Trocar a chave invalida todas as credenciais em
// circulação — todo mundo precisa pedir acesso de novo.
func carregarOuCriarChave(caminho string) (*token.Assinador, error) {
	bytes, err := os.ReadFile(caminho)
	if err == nil {
		return token.CarregarChave(bytes)
	}
	if !os.IsNotExist(err) {
		return nil, fmt.Errorf("ler %s: %w", caminho, err)
	}

	log.Printf("Chave de sessão ausente em %s — gerando uma nova.", caminho)
	if err := gerarParDeChaves(caminho); err != nil {
		return nil, err
	}
	bytes, err = os.ReadFile(caminho)
	if err != nil {
		return nil, err
	}
	return token.CarregarChave(bytes)
}

// gerarParDeChaves grava a privada com permissão restrita e imprime a
// pública no formato que o build do aplicativo consome.
func gerarParDeChaves(caminho string) error {
	assinador, err := token.GerarChave()
	if err != nil {
		return err
	}

	privada, err := assinador.PEM()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(caminho), 0o750); err != nil {
		return err
	}
	if err := os.WriteFile(caminho, privada, 0o600); err != nil {
		return fmt.Errorf("gravar %s: %w", caminho, err)
	}

	jwk, err := assinador.JWK()
	if err != nil {
		return err
	}

	fmt.Printf("Chave privada gravada em %s (não versione este arquivo).\n\n", caminho)
	fmt.Printf("Use no build do aplicativo:\n\nVITE_AUTH_CHAVE_PUBLICA='%s'\n", jwk)
	return nil
}
