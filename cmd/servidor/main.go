// Servidor portátil da modalidade B: serve a aplicação em http://localhost:8080
// e abre o navegador. Não exige instalador nem privilégio de administrador,
// e roda direto de um pendrive.
//
// http://localhost é contexto seguro, portanto service worker, câmera e
// IndexedDB funcionam — o que não acontece com o protocolo file://.
package main

import (
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// O conteúdo de dist/ é copiado para web/ antes da compilação
// (veja scripts/build-portatil.sh).
//
//go:embed all:web
var embutido embed.FS

const (
	portaPadrao     = 8080
	tentativasPorta = 20
	senhaAdminPadr  = "ABB"
	hostPadrao      = "127.0.0.1"
)

func main() {
	porta := flag.Int("porta", portaPadrao, "porta HTTP local")
	semNavegador := flag.Bool("sem-navegador", false, "não abrir o navegador automaticamente")
	pasta := flag.String("pasta", "", "servir uma pasta do disco em vez do conteúdo embutido")
	host := flag.String("host", hostPadrao, "endereço de escuta; 0.0.0.0 atende a rede e libera o acesso de fora")
	arquivoFila := flag.String("dados", "", "arquivo JSON da fila de liberação (padrão: dados/acessos.json ao lado do executável)")
	senhaAdmin := flag.String("senha-admin", "", "senha da administração (padrão: variável ADMIN_SENHA)")
	origensCORS := flag.String("origem", "", "origens liberadas para chamar a API, separadas por vírgula (ex.: https://app.exemplo.com)")
	flag.Parse()

	arquivos, origem, err := resolverConteudo(*pasta)
	if err != nil {
		log.Fatalf("Não foi possível localizar os arquivos da aplicação: %v", err)
	}

	senha := primeiroNaoVazio(*senhaAdmin, os.Getenv("ADMIN_SENHA"), senhaAdminPadr)
	fila, err := AbrirFila(caminhoDados(*arquivoFila), senha)
	if err != nil {
		log.Fatalf("Não foi possível abrir a fila de liberação: %v", err)
	}

	// Escutar fora de 127.0.0.1 é decisão explícita de quem sobe o servidor:
	// é o que permite o administrador liberar montadores de outro aparelho.
	naRede := !enderecoLocal(*host)

	ouvinte, portaUsada, err := ouvir(*host, *porta)
	if err != nil {
		log.Fatalf("Não foi possível abrir a porta: %v", err)
	}

	endereco := fmt.Sprintf("http://localhost:%d/", portaUsada)
	fmt.Printf("Verificação de Montagem de Painéis\n")
	fmt.Printf("Conteúdo: %s\n", origem)
	fmt.Printf("Endereço: %s\n", endereco)
	fmt.Printf("Fila de liberação: %s\n", fila.caminho)
	if naRede {
		fmt.Printf("Escutando em %s: o servidor atende outros aparelhos da rede.\n", *host)
	}
	if senha == senhaAdminPadr {
		fmt.Printf("ATENÇÃO: a senha da administração é a padrão. Defina ADMIN_SENHA antes de publicar.\n")
	}
	fmt.Printf("Para encerrar, feche esta janela ou pressione Ctrl+C.\n\n")

	if !*semNavegador {
		go func() {
			time.Sleep(300 * time.Millisecond)
			if err := abrirNavegador(endereco); err != nil {
				fmt.Printf("Abra o endereço manualmente no navegador: %s\n", endereco)
			}
		}()
	}

	servidor := &http.Server{
		Handler:           comCORS(listaOrigens(*origensCORS), manipulador(arquivos, fila, naRede)),
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := servidor.Serve(ouvinte); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("Servidor encerrado: %v", err)
	}
}

// resolverConteudo prefere uma pasta no disco (atualizável sem recompilar) e
// recorre ao conteúdo embutido no binário.
func resolverConteudo(pastaInformada string) (fs.FS, string, error) {
	candidatas := []string{}
	if pastaInformada != "" {
		candidatas = append(candidatas, pastaInformada)
	}
	if executavel, err := os.Executable(); err == nil {
		base := filepath.Dir(executavel)
		candidatas = append(candidatas, filepath.Join(base, "web"), filepath.Join(base, "dist"))
	}
	candidatas = append(candidatas, "web", "dist")

	for _, candidata := range candidatas {
		if info, err := os.Stat(filepath.Join(candidata, "index.html")); err == nil && !info.IsDir() {
			caminho, _ := filepath.Abs(candidata)
			return os.DirFS(candidata), caminho, nil
		}
	}

	sub, err := fs.Sub(embutido, "web")
	if err != nil {
		return nil, "", err
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, "", errors.New(
			"nenhuma pasta web/ ou dist/ encontrada e o binário não tem conteúdo embutido; " +
				"gere o binário com scripts/build-portatil.sh",
		)
	}
	return sub, "embutido no binário", nil
}

// caminhoDados resolve onde a fila de liberação é gravada.
func caminhoDados(informado string) string {
	if informado != "" {
		return informado
	}
	if executavel, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(executavel), "dados", "acessos.json")
	}
	return filepath.Join("dados", "acessos.json")
}

func primeiroNaoVazio(valores ...string) string {
	for _, v := range valores {
		if v != "" {
			return v
		}
	}
	return ""
}

func listaOrigens(bruto string) []string {
	var origens []string
	for _, parte := range strings.Split(bruto, ",") {
		if limpa := strings.TrimSpace(parte); limpa != "" {
			origens = append(origens, limpa)
		}
	}
	return origens
}

func enderecoLocal(host string) bool {
	return host == "" || host == hostPadrao || strings.EqualFold(host, "localhost") || host == "::1"
}

func ouvir(host string, porta int) (net.Listener, int, error) {
	var ultimoErro error
	for i := 0; i < tentativasPorta; i++ {
		atual := porta + i
		ouvinte, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, atual))
		if err == nil {
			return ouvinte, atual, nil
		}
		ultimoErro = err
	}
	return nil, 0, ultimoErro
}

// hostLocal informa se a requisição diz estar falando com esta máquina.
//
// O servidor escuta só em 127.0.0.1, mas isso não basta: um site aberto no
// mesmo navegador pode fazer o próprio domínio resolver para 127.0.0.1 (DNS
// rebinding), ganhar a origem http://localhost e ler todo o IndexedDB —
// projetos, respostas e fotos de todos os clientes do pendrive. Conferir o
// Host fecha esse caminho, porque o navegador envia sempre o nome que o site
// pediu, e não o endereço em que a conexão terminou.
func hostLocal(host string) bool {
	nome := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		nome = h
	}
	nome = strings.TrimSuffix(strings.ToLower(nome), ".")
	return nome == "localhost" || nome == "127.0.0.1" || nome == "::1" || nome == "[::1]"
}

func manipulador(arquivos fs.FS, fila *Fila, naRede bool) http.Handler {
	servidorArquivos := http.FileServer(http.FS(arquivos))
	api := fila.API()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Na modalidade de pendrive o servidor só atende localhost. Quem sobe
		// com -host aberto está publicando para a rede e assume a checagem.
		if !naRede && !hostLocal(r.Host) {
			http.Error(w, "Este servidor só atende em localhost.", http.StatusMisdirectedRequest)
			return
		}

		// A aplicação não busca nada fora de si mesma, e não deve ser aberta
		// dentro de outra página.
		cabecalhos := w.Header()
		cabecalhos.Set("X-Content-Type-Options", "nosniff")
		cabecalhos.Set("X-Frame-Options", "DENY")
		cabecalhos.Set("Referrer-Policy", "no-referrer")
		cabecalhos.Set("Content-Security-Policy",
			"default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; "+
				"object-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; "+
				"connect-src 'self' blob:; worker-src 'self'; frame-ancestors 'none'; "+
				"base-uri 'none'; form-action 'none'")

		caminho := strings.TrimPrefix(r.URL.Path, "/")

		// A fila de liberação vive em /api; o resto é a aplicação estática.
		if caminho == "api" || strings.HasPrefix(caminho, "api/") {
			api.ServeHTTP(w, r)
			return
		}

		if caminho == "" {
			caminho = "index.html"
		}

		// O service worker precisa deste cabeçalho para controlar toda a raiz.
		if strings.HasSuffix(caminho, "sw.js") {
			cabecalhos.Set("Service-Worker-Allowed", "/")
		}
		// index.html e service worker nunca ficam em cache do navegador:
		// é assim que uma versão nova publicada no pendrive chega ao usuário.
		// Os demais arquivos têm o hash no nome e podem ficar.
		if caminho == "index.html" || caminho == "sw.js" || strings.HasSuffix(caminho, "/sw.js") {
			cabecalhos.Set("Cache-Control", "no-cache, no-store, must-revalidate")
		}

		if _, err := fs.Stat(arquivos, caminho); err != nil {
			// Rota desconhecida cai no index.html (navegação da SPA).
			r = r.Clone(r.Context())
			r.URL.Path = "/"
			cabecalhos.Set("Cache-Control", "no-cache")
		}
		servidorArquivos.ServeHTTP(w, r)
	})
}

func abrirNavegador(endereco string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", endereco).Start()
	case "darwin":
		return exec.Command("open", endereco).Start()
	default:
		return exec.Command("xdg-open", endereco).Start()
	}
}
