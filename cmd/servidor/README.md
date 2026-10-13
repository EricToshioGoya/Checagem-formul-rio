# Servidor portátil (modalidade B)

Binário único em Go que serve a aplicação em `http://localhost:8080` e abre o
navegador. Sem instalador, sem privilégio de administrador — roda de pendrive.

`http://localhost` é contexto seguro: service worker, câmera e IndexedDB
funcionam, o que não acontece com o protocolo `file://`.

## Gerar

Sempre pela raiz do repositório, para que o `dist/` atual seja embutido:

```bash
scripts/build-portatil.sh windows/amd64          # padrão
scripts/build-portatil.sh linux/amd64 darwin/arm64
```

Os binários saem em `portatil/`. O script gera a aplicação, copia `dist/` para
`cmd/servidor/web/` e compila com `-trimpath -ldflags="-s -w"`.

## Opções

| Opção | Efeito |
|---|---|
| `-porta 9000` | Porta HTTP local (padrão 8080). Se estiver ocupada, tenta as 20 seguintes. |
| `-sem-navegador` | Não abre o navegador automaticamente. |
| `-pasta ./dist` | Serve uma pasta do disco em vez do conteúdo embutido. |
| `-host 0.0.0.0` | Atende a rede local. Sem ela, só `localhost` — e requisições com outro `Host` são recusadas (proteção contra DNS rebinding). |
| `-api http://192.168.0.10:3001` | Encaminha `/api` ao servidor de acesso (`npm run servidor`). Sem ela, o login não funciona. Também aceita a variável `API_ALVO`. |

Uma pasta `web/` ou `dist/` ao lado do executável também tem precedência sobre o
conteúdo embutido — é assim que a aplicação no pendrive é atualizada sem
recompilar o binário.

## Detalhes

- `index.html` e o service worker são servidos com `Cache-Control: no-cache`,
  para que uma versão nova no pendrive chegue ao usuário.
- `sw.js` recebe `Service-Worker-Allowed: /`.
- Rotas desconhecidas caem no `index.html` (navegação da aplicação).
- Toda resposta leva `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy` e a mesma CSP do `index.html`, com `frame-ancestors 'none'`.
- Contas, painéis e aprovações não moram aqui: `/api` é repassado ao servidor
  de acesso, mantendo a API na mesma origem da aplicação.
- O diretório `web/` versionado contém apenas `.gitkeep`: ele existe para que a
  diretiva `//go:embed all:web` compile em um repositório recém-clonado.
