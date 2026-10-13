# Arquivo central de PDFs

Servidor que recebe os PDFs gerados pelos aparelhos e permite consultá-los por
empresa, projeto e data de emissão. Os PDFs são a documentação usada para
validar a garantia ABB em caso de falha ou quebra do material.

- Binário único em Go, banco **SQLite** (driver em Go puro, sem CGO).
- Os PDFs ficam em disco (`<dados>/pdfs/<idEnvio>.pdf`); o banco guarda os
  metadados e o **SHA-256** de cada arquivo, que comprova que ele não mudou
  desde o recebimento.
- **Imutável:** não há rota de exclusão nem de alteração.

## Executar

```bash
cd cmd/arquivo
go build -o arquivo .
SENHA_ADMIN='senha-do-cliente' ./arquivo -porta 8090 -dados /var/lib/arquivo-pdfs
```

| Variável / opção | Padrão | Efeito |
|---|---|---|
| `SENHA_ADMIN` | — (obrigatória) | Senha da consulta. Use a mesma do `VITE_SENHA_ADMIN` do aplicativo. |
| `PORTA` / `-porta` | `8090` | Porta HTTP. |
| `PASTA_DADOS` / `-dados` | `dados` | Pasta do `arquivo.db` e dos PDFs. |
| `ORIGEM_PERMITIDA` | `*` | Valor de `Access-Control-Allow-Origin` (endereço onde o aplicativo é publicado). |

Publique atrás de HTTPS (proxy reverso). O aplicativo é gerado apontando para
este servidor:

```bash
VITE_URL_ARQUIVO=https://arquivo.exemplo.com npm run build
```

**Backup:** copie a pasta de dados inteira (`arquivo.db` + `pdfs/`).

## API

| Rota | Senha | Descrição |
|---|---|---|
| `POST /api/pdfs` | não | Recebe um PDF (multipart: `idEnvio`, `empresa`, `projeto`, `tipo`, `nomeArquivo`, `emitidoEm` em ISO 8601, `arquivo`). Idempotente pelo `idEnvio`. Recusa o que não é PDF e acima de 100 MB. |
| `GET /api/pdfs?nome=&de=&ate=&limite=` | sim | Busca por trecho do nome da empresa ou do projeto (sem diferenciar maiúsculas e acentos) e pelo intervalo de emissão (`de`/`ate` em ISO 8601). Mais recentes primeiro; até 200 por padrão, 1000 no máximo. |
| `GET /api/pdfs/{id}/arquivo` | sim | Baixa o PDF. O cabeçalho `X-Sha256` traz o hash registrado. |
| `GET /api/saude` | não | Verificação de funcionamento. |

A senha vai no cabeçalho `Authorization: Bearer <senha>`.

> O envio não exige senha porque o aplicativo não tem autenticação de usuário:
> qualquer pessoa com o endereço pode enviar um PDF. A consulta e o download
> são protegidos.
