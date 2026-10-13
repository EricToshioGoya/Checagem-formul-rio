package main

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// formatoData grava instantes em UTC com largura fixa: a comparação de texto
// no SQLite passa a ser também comparação cronológica.
const formatoData = "2006-01-02T15:04:05.000Z"

// RegistroPdf é um PDF arquivado. O conteúdo fica em disco, em
// <dados>/pdfs/<idEnvio>.pdf; o banco guarda os metadados e o SHA-256,
// que comprova que o arquivo não mudou desde o recebimento.
type RegistroPdf struct {
	ID          int64  `json:"id"`
	IDEnvio     string `json:"idEnvio"`
	Empresa     string `json:"empresa"`
	Projeto     string `json:"projeto"`
	Tipo        string `json:"tipo"`
	NomeArquivo string `json:"nomeArquivo"`
	EmitidoEm   string `json:"emitidoEm"`
	RecebidoEm  string `json:"recebidoEm"`
	Tamanho     int64  `json:"tamanho"`
	Sha256      string `json:"sha256"`
}

type FiltroBusca struct {
	Nome   string
	De     *time.Time
	Ate    *time.Time
	Limite int
}

type Banco struct{ db *sql.DB }

func abrirBanco(caminho string) (*Banco, error) {
	db, err := sql.Open("sqlite", "file:"+caminho+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	// Uma conexão só: o volume é baixo e evita disputa de escrita no SQLite.
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS pdfs (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			id_envio     TEXT    NOT NULL UNIQUE,
			empresa      TEXT    NOT NULL,
			projeto      TEXT    NOT NULL,
			tipo         TEXT    NOT NULL,
			nome_arquivo TEXT    NOT NULL,
			emitido_em   TEXT    NOT NULL,
			recebido_em  TEXT    NOT NULL,
			tamanho      INTEGER NOT NULL,
			sha256       TEXT    NOT NULL,
			busca        TEXT    NOT NULL
		);
		CREATE INDEX IF NOT EXISTS pdfs_emitido_em ON pdfs (emitido_em);
	`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Banco{db: db}, nil
}

const colunas = `id, id_envio, empresa, projeto, tipo, nome_arquivo, emitido_em, recebido_em, tamanho, sha256`

func lerRegistro(linha interface{ Scan(...any) error }) (RegistroPdf, error) {
	var r RegistroPdf
	err := linha.Scan(&r.ID, &r.IDEnvio, &r.Empresa, &r.Projeto, &r.Tipo, &r.NomeArquivo,
		&r.EmitidoEm, &r.RecebidoEm, &r.Tamanho, &r.Sha256)
	return r, err
}

func (b *Banco) porIDEnvio(idEnvio string) (*RegistroPdf, error) {
	r, err := lerRegistro(b.db.QueryRow(`SELECT `+colunas+` FROM pdfs WHERE id_envio = ?`, idEnvio))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &r, err
}

func (b *Banco) porID(id int64) (*RegistroPdf, error) {
	r, err := lerRegistro(b.db.QueryRow(`SELECT `+colunas+` FROM pdfs WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &r, err
}

func (b *Banco) inserir(r *RegistroPdf) error {
	res, err := b.db.Exec(`
		INSERT INTO pdfs (id_envio, empresa, projeto, tipo, nome_arquivo, emitido_em, recebido_em, tamanho, sha256, busca)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.IDEnvio, r.Empresa, r.Projeto, r.Tipo, r.NomeArquivo, r.EmitidoEm, r.RecebidoEm,
		r.Tamanho, r.Sha256, normalizarBusca(r.Empresa+" "+r.Projeto))
	if err != nil {
		return err
	}
	r.ID, err = res.LastInsertId()
	return err
}

// buscar filtra por empresa ou projeto (sem diferenciar maiúsculas nem
// acentos) e pelo intervalo de emissão, do mais recente ao mais antigo.
func (b *Banco) buscar(f FiltroBusca) ([]RegistroPdf, error) {
	consulta := `SELECT ` + colunas + ` FROM pdfs WHERE 1 = 1`
	args := []any{}
	for _, termo := range strings.Fields(normalizarBusca(f.Nome)) {
		consulta += ` AND instr(busca, ?) > 0`
		args = append(args, termo)
	}
	if f.De != nil {
		consulta += ` AND emitido_em >= ?`
		args = append(args, f.De.UTC().Format(formatoData))
	}
	if f.Ate != nil {
		consulta += ` AND emitido_em <= ?`
		args = append(args, f.Ate.UTC().Format(formatoData))
	}
	consulta += ` ORDER BY emitido_em DESC, id DESC LIMIT ?`
	args = append(args, f.Limite)

	linhas, err := b.db.Query(consulta, args...)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()

	itens := []RegistroPdf{}
	for linhas.Next() {
		r, err := lerRegistro(linhas)
		if err != nil {
			return nil, err
		}
		itens = append(itens, r)
	}
	return itens, linhas.Err()
}

var semAcento = strings.NewReplacer(
	"á", "a", "à", "a", "â", "a", "ã", "a", "ä", "a",
	"é", "e", "è", "e", "ê", "e", "ë", "e",
	"í", "i", "ì", "i", "î", "i", "ï", "i",
	"ó", "o", "ò", "o", "ô", "o", "õ", "o", "ö", "o",
	"ú", "u", "ù", "u", "û", "u", "ü", "u",
	"ç", "c", "ñ", "n",
)

func normalizarBusca(s string) string {
	return semAcento.Replace(strings.ToLower(s))
}
