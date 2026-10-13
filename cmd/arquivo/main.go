// Servidor do arquivo central de PDFs. Recebe os checklists gerados pelos
// aparelhos e permite consultá-los por empresa, projeto e data de emissão —
// documentação usada para validar a garantia ABB em caso de falha do material.
//
// Não há rota de exclusão nem de alteração: um PDF arquivado é imutável.
package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	tamanhoMaximo = 100 << 20 // 100 MB por PDF (fotos incorporadas)
	limitePadrao  = 200
	limiteMaximo  = 1000
)

var idEnvioValido = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

type Servidor struct {
	banco      *Banco
	pastaPdfs  string
	senhaAdmin string
	origemCors string
}

func main() {
	porta := flag.Int("porta", inteiroAmbiente("PORTA", 8090), "porta HTTP")
	dados := flag.String("dados", textoAmbiente("PASTA_DADOS", "dados"), "pasta do banco e dos PDFs")
	flag.Parse()

	senha := os.Getenv("SENHA_ADMIN")
	if senha == "" {
		log.Fatal("Defina SENHA_ADMIN (a mesma senha da aba de administração do aplicativo).")
	}

	pastaPdfs := filepath.Join(*dados, "pdfs")
	if err := os.MkdirAll(pastaPdfs, 0o750); err != nil {
		log.Fatalf("Não foi possível criar %s: %v", pastaPdfs, err)
	}
	banco, err := abrirBanco(filepath.Join(*dados, "arquivo.db"))
	if err != nil {
		log.Fatalf("Não foi possível abrir o banco: %v", err)
	}

	s := &Servidor{
		banco:      banco,
		pastaPdfs:  pastaPdfs,
		senhaAdmin: senha,
		origemCors: textoAmbiente("ORIGEM_PERMITIDA", "*"),
	}

	rotas := http.NewServeMux()
	rotas.HandleFunc("GET /api/saude", func(w http.ResponseWriter, r *http.Request) {
		responderJSON(w, http.StatusOK, map[string]string{"situacao": "ok"})
	})
	rotas.HandleFunc("POST /api/pdfs", s.receber)
	rotas.HandleFunc("GET /api/pdfs", s.exigirSenha(s.listar))
	rotas.HandleFunc("GET /api/pdfs/{id}/arquivo", s.exigirSenha(s.baixar))

	servidor := &http.Server{
		Addr:              fmt.Sprintf(":%d", *porta),
		Handler:           s.cors(rotas),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("Arquivo de PDFs em http://localhost:%d (dados em %s)", *porta, *dados)
	if err := servidor.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// receber grava um PDF enviado pelo aplicativo. É idempotente pelo idEnvio:
// o aparelho pode reenviar após uma queda de conexão sem duplicar o registro.
func (s *Servidor) receber(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, tamanhoMaximo+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		responderErro(w, http.StatusBadRequest, "Envio inválido ou maior que 100 MB.")
		return
	}
	defer r.MultipartForm.RemoveAll()

	idEnvio := r.FormValue("idEnvio")
	if !idEnvioValido.MatchString(idEnvio) {
		responderErro(w, http.StatusBadRequest, "idEnvio inválido.")
		return
	}
	emitido, err := time.Parse(time.RFC3339Nano, r.FormValue("emitidoEm"))
	if err != nil {
		responderErro(w, http.StatusBadRequest, "emitidoEm deve estar no formato ISO 8601.")
		return
	}
	registro := RegistroPdf{
		IDEnvio:     idEnvio,
		Empresa:     strings.TrimSpace(r.FormValue("empresa")),
		Projeto:     strings.TrimSpace(r.FormValue("projeto")),
		Tipo:        strings.TrimSpace(r.FormValue("tipo")),
		NomeArquivo: filepath.Base(strings.TrimSpace(r.FormValue("nomeArquivo"))),
		EmitidoEm:   emitido.UTC().Format(formatoData),
	}
	if registro.Empresa == "" || registro.Projeto == "" || registro.NomeArquivo == "" {
		responderErro(w, http.StatusBadRequest, "empresa, projeto e nomeArquivo são obrigatórios.")
		return
	}

	if existente, err := s.banco.porIDEnvio(idEnvio); err != nil {
		responderErro(w, http.StatusInternalServerError, "Falha ao consultar o banco.")
		return
	} else if existente != nil {
		responderJSON(w, http.StatusOK, existente)
		return
	}

	arquivo, _, err := r.FormFile("arquivo")
	if err != nil {
		responderErro(w, http.StatusBadRequest, "Campo 'arquivo' ausente.")
		return
	}
	defer arquivo.Close()

	destino := filepath.Join(s.pastaPdfs, idEnvio+".pdf")
	temporario := destino + ".parcial"
	tamanho, hash, err := gravarPdf(arquivo, temporario)
	if err != nil {
		os.Remove(temporario)
		responderErro(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := os.Rename(temporario, destino); err != nil {
		os.Remove(temporario)
		responderErro(w, http.StatusInternalServerError, "Falha ao gravar o arquivo.")
		return
	}

	registro.Tamanho = tamanho
	registro.Sha256 = hash
	registro.RecebidoEm = time.Now().UTC().Format(formatoData)
	if err := s.banco.inserir(&registro); err != nil {
		os.Remove(destino)
		responderErro(w, http.StatusInternalServerError, "Falha ao registrar o PDF.")
		return
	}
	responderJSON(w, http.StatusCreated, registro)
}

// gravarPdf copia o envio para o disco calculando o SHA-256 e recusa o que
// não começa com a assinatura de um PDF.
func gravarPdf(origem io.Reader, caminho string) (int64, string, error) {
	cabecalho := make([]byte, 5)
	if _, err := io.ReadFull(origem, cabecalho); err != nil || !bytes.Equal(cabecalho, []byte("%PDF-")) {
		return 0, "", errors.New("O arquivo enviado não é um PDF.")
	}
	saida, err := os.OpenFile(caminho, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return 0, "", errors.New("Falha ao gravar o arquivo.")
	}
	defer saida.Close()

	hash := sha256.New()
	tamanho, err := io.Copy(io.MultiWriter(saida, hash), io.MultiReader(bytes.NewReader(cabecalho), origem))
	if err != nil {
		return 0, "", errors.New("Falha ao receber o arquivo.")
	}
	if tamanho > tamanhoMaximo {
		return 0, "", errors.New("PDF maior que 100 MB.")
	}
	if err := saida.Sync(); err != nil {
		return 0, "", errors.New("Falha ao gravar o arquivo.")
	}
	return tamanho, hex.EncodeToString(hash.Sum(nil)), nil
}

// listar aceita nome (empresa ou projeto) e o intervalo de emissão em
// ISO 8601 (de, ate). O aplicativo converte as datas locais em instantes.
func (s *Servidor) listar(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filtro := FiltroBusca{Nome: q.Get("nome"), Limite: limitePadrao}
	for campo, destino := range map[string]**time.Time{"de": &filtro.De, "ate": &filtro.Ate} {
		if v := q.Get(campo); v != "" {
			t, err := time.Parse(time.RFC3339Nano, v)
			if err != nil {
				responderErro(w, http.StatusBadRequest, fmt.Sprintf("'%s' deve estar no formato ISO 8601.", campo))
				return
			}
			*destino = &t
		}
	}
	if v, err := strconv.Atoi(q.Get("limite")); err == nil && v > 0 {
		filtro.Limite = min(v, limiteMaximo)
	}

	itens, err := s.banco.buscar(filtro)
	if err != nil {
		responderErro(w, http.StatusInternalServerError, "Falha na consulta.")
		return
	}
	responderJSON(w, http.StatusOK, map[string]any{"itens": itens, "limite": filtro.Limite})
}

func (s *Servidor) baixar(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		responderErro(w, http.StatusBadRequest, "Identificador inválido.")
		return
	}
	registro, err := s.banco.porID(id)
	if err != nil {
		responderErro(w, http.StatusInternalServerError, "Falha ao consultar o banco.")
		return
	}
	if registro == nil {
		responderErro(w, http.StatusNotFound, "PDF não encontrado.")
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": registro.NomeArquivo}))
	w.Header().Set("X-Sha256", registro.Sha256)
	http.ServeFile(w, r, filepath.Join(s.pastaPdfs, registro.IDEnvio+".pdf"))
}

// exigirSenha valida "Authorization: Bearer <senha>" em tempo constante.
func (s *Servidor) exigirSenha(proxima http.HandlerFunc) http.HandlerFunc {
	esperado := sha256.Sum256([]byte(s.senhaAdmin))
	return func(w http.ResponseWriter, r *http.Request) {
		informado := sha256.Sum256([]byte(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")))
		if subtle.ConstantTimeCompare(esperado[:], informado[:]) != 1 {
			responderErro(w, http.StatusUnauthorized, "Senha incorreta.")
			return
		}
		proxima(w, r)
	}
}

// cors libera o aplicativo publicado em outra origem (modalidade A ou o
// binário portátil em localhost) a chamar a API.
func (s *Servidor) cors(proxima http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", s.origemCors)
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition, X-Sha256")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		proxima.ServeHTTP(w, r)
	})
}

func responderJSON(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

func responderErro(w http.ResponseWriter, status int, mensagem string) {
	responderJSON(w, status, map[string]string{"erro": mensagem})
}

func textoAmbiente(nome, padrao string) string {
	if v := os.Getenv(nome); v != "" {
		return v
	}
	return padrao
}

func inteiroAmbiente(nome string, padrao int) int {
	if v, err := strconv.Atoi(os.Getenv(nome)); err == nil {
		return v
	}
	return padrao
}
