# Bateria de verificação manual assistida

Percorre a aplicação num Chromium real, como um montador faria, e confere cada
resultado **na tela e no IndexedDB**. Complementa `scripts/fumaca.mjs`: a fumaça
responde “o caminho feliz funciona?”; esta bateria responde “o que acontece
quando algo sai do previsto?”.

## Como rodar

```bash
npm run build
npx vite preview --port 8099 &

# dependências só do teste — não entram no projeto
npm i -D playwright pdfjs-dist && npx playwright install chromium

BASE_URL=http://127.0.0.1:8099 npm run testes
```

Com o Chromium já instalado no sistema, aponte o executável:

```bash
CHROMIUM=/caminho/para/chromium BASE_URL=http://127.0.0.1:8099 npm run testes
```

Um bloco isolado:

```bash
node scripts/testes/02-persistencia.mjs
npm run testes -- 03 05          # só os blocos 03 e 05
```

Os arquivos gerados (PDFs, ZIPs, JSONs) ficam em `saida-testes/`, que não entra
no controle de versão. Cada bloco cria os próprios projetos e não depende dos
demais.

## O que cada bloco cobre

| Bloco | Cobertura |
|---|---|
| `01-cadastro-e-campos` | Validações do cadastro, TAGs, cabeçalho e os oito tipos de campo, limite de fotos, filtros, modal de apoio |
| `02-persistencia` | Salvamento automático, saída da tela, duas telas abertas, ordenação de TAGs |
| `03-exportacao` | PDF nas duas opções de foto, geometria do texto no PDF, ZIP de fotos, exportar/importar/excluir projeto |
| `04-importacao-hostil` | Backup adulterado: validação, isolamento e recuperação da aplicação |
| `05-administracao` | Acesso, edição, reordenação, importação de JSON, conteúdo de apoio externo, restauração |
| `06-offline` | Service worker, abertura, preenchimento e geração de PDF sem rede |
| `07-entrada-hostil` | Rotas inválidas, texto hostil nos campos, nome de arquivo, anexo grande |
| `08-servidor-portatil` | Modalidade B: compilação, rotas, travessia de caminho, cabeçalhos (exige Go) |
| `09-rastreabilidade` | Resposta registrada em etapa depois desativada pela administração |

## Como ler o resultado

Cada verificação sai como `PASS` ou `FAIL` com o valor observado ao lado — o
`FAIL` traz o dado real (o que foi gravado, quantos arquivos saíram, qual
requisição partiu), de modo que serve de evidência sem precisar reproduzir à
mão. `docs/auditoria-2026-09.md` explica cada falha conhecida, o efeito em
campo e a correção sugerida.

Uma verificação que falha **não significa que o teste está errado**: significa
que o comportamento observado difere do esperado para um sistema de registro de
qualidade. Ao corrigir o código, a verificação correspondente passa a `PASS`
sem alteração no teste.

## Utilitário

`inspecionar-pdf.mjs` lê um PDF gerado e informa onde cada trecho de texto foi
desenhado — usado para detectar texto que invade o rodapé ou sai da página:

```bash
node scripts/testes/inspecionar-pdf.mjs saida-testes/ACME_OBRA_MONTAGEM_2026-09-09.pdf
node scripts/testes/inspecionar-pdf.mjs arquivo.pdf --texto   # despeja o texto
```
