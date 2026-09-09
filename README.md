# Sistema de Verificação de Montagem de Painéis

Aplicação para o montador do parceiro registrar, durante a montagem do painel,
as verificações exigidas pelos protocolos ABB. Ao final, gera um PDF em leiaute
ABB que o montador baixa e envia por e-mail ao inspetor — o julgamento de
conformidade é feito **fora do sistema**.

Implementa a especificação técnica v1.0 (02/09/2026).

- **Aplicativo estático.** A saída do build é um diretório de arquivos.
- **Offline integral** após o primeiro carregamento (PWA com service worker).
- **Dados só no aparelho** (IndexedDB via Dexie). Ver [Limitação conhecida](#limitação-conhecida--sem-sincronização).
- **Acesso controlado** por autorização do responsável pelo painel. Exige uma
  API de apoio (`cmd/api`), que não recebe dado de formulário nenhum. Ver
  [Controle de acesso](#controle-de-acesso).

---

## Começando

```bash
npm install
npm run dev          # servidor de desenvolvimento
npm run build        # valida os formulários, checa tipos e gera dist/
npm run preview      # serve o dist/ gerado
```

Requer Node 20 ou superior.

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Vite em modo desenvolvimento |
| `npm run build` | Valida JSON dos formulários → `tsc -b` → `vite build` |
| `npm run typecheck` | Somente a checagem de tipos |
| `npm run validar-formularios` | Valida `public/forms/*.json` contra o schema Zod |
| `npm run fumaca` | Teste de fumaça do fluxo completo em navegador real |
| `npm run fumaca-autorizacao` | Teste de fumaça do controle de acesso, com a API real |
| `scripts/build-portatil.sh` | Gera o binário portátil (modalidade B) |

O teste de fumaça exige Playwright, que **não** é dependência do projeto:

```bash
VITE_SEM_AUTORIZACAO=1 npm run build && npx vite preview --port 8099 &
npm i -D playwright && npx playwright install chromium
BASE_URL=http://localhost:8099 npm run fumaca
```

`VITE_SEM_AUTORIZACAO=1` desliga a tela de acesso, que não é o objeto deste
teste. O controle de acesso tem o seu próprio, que sobe a API e percorre o
fluxo inteiro no navegador:

```bash
npm run fumaca-autorizacao      # exige Go, além do Playwright
```

Ele percorre criação de projeto, preenchimento com salvamento automático,
persistência após recarregar, modal de apoio, geração dos PDFs nas duas opções
de foto, exportação do projeto, grade de ensaios e aba de administração.

---

## Modalidades de entrega

O mesmo `dist/` atende às duas formas de distribuição.

### A — hospedada (obrigatória para celular)

Publique `dist/` em um servidor HTTPS. O montador acessa a URL, instala como PWA
e passa a operar offline. Android e iOS não permitem abrir um HTML local com
câmera e armazenamento persistente, por isso esta modalidade é obrigatória no
celular.

Para publicar em subdiretório, informe a base no build:

```bash
VITE_BASE=/verificacao/ npm run build
```

O build também precisa saber onde está a API de autorização:

```bash
VITE_API_URL=https://autorizacao.empresa.com.br \
VITE_AUTH_CHAVE_PUBLICA='{"kty":"EC","crv":"P-256","x":"…","y":"…"}' \
npm run build
```

> **iPhone e iPad:** o Safari descarta o IndexedDB de sites não instalados após
> 7 dias sem uso. A tela inicial exibe o aviso pedindo que o usuário adicione o
> aplicativo à Tela de Início — PWAs instaladas ficam isentas do descarte.

### B — portátil no desktop

```bash
scripts/build-portatil.sh windows/amd64 linux/amd64 darwin/arm64
```

Gera em `portatil/` um binário único (~6,5 MB, sem instalador) que serve a
aplicação em `http://localhost:8080` e abre o navegador. Roda de pendrive, sem
privilégio de administrador. `http://localhost` é contexto seguro, portanto
service worker, câmera e IndexedDB funcionam.

```
verificacao-montagem-windows-amd64.exe            # porta 8080, abre o navegador
verificacao-montagem-windows-amd64.exe -porta 9000
verificacao-montagem-windows-amd64.exe -sem-navegador
verificacao-montagem-windows-amd64.exe -pasta ./dist   # serve do disco
```

Se a porta estiver ocupada, o servidor tenta as 20 seguintes. Uma pasta `web/`
ou `dist/` ao lado do executável tem precedência sobre o conteúdo embutido — é
assim que se atualiza a aplicação no pendrive sem recompilar.

> **Não use o protocolo `file://`.** O Chrome bloqueia IndexedDB nesse
> protocolo, o que inviabiliza a persistência exigida.

---

## Arquitetura

```
public/
  forms/                  definições JSON dos formulários — editáveis sem build
    index.json            catálogo dos formulários disponíveis
    sen-plus-montagem.json
    rotina-bt.json
  media/                  conteúdo de apoio — editável sem build
    sen-plus/             (ver LEIA-ME.md: lista das imagens esperadas)
src/
  app/                    rotas, layout, shell da PWA
  core/
    db/                   Dexie: schema e repositórios
    forms/                motor: schema Zod, catálogo, progresso
    media/                compressão e normalização de imagem
    export/               ExportTarget, dossiê, PDF, backup .zip
    auth/                 credencial de acesso, cliente da API, estado da sessão
  features/
    projects/             listagem, criação, TAGs
    fill/                 preenchimento e registro de tipos de campo
    pdf/                  diálogo de geração
    admin/                aba de administração
    auth/                 tela de bloqueio e tela de autorizações
  shared/                 componentes de UI, ícones, hooks, utilidades
cmd/api/                  API de autorização em Go (ver cmd/api/README.md)
cmd/servidor/             servidor portátil em Go (modalidade B)
scripts/                  validação de formulários, build portátil, fumaça
```

**Princípio central:** o motor de formulários não conhece nenhum formulário
específico. Todo formulário é um JSON carregado em tempo de execução a partir de
`public/forms`. Acrescentar a linha System Pro E Energy é acrescentar um arquivo
JSON e suas mídias — sem alteração de código.

Uma diferença em relação ao desenho da especificação: a montagem do documento
PDF vive em `core/export/pdf/`, e não em `features/pdf/`. Assim `core` não
importa `features`, e `features/pdf` fica só com a interface de usuário do
diálogo de geração.

### Pontos de extensão

| Extensão | O que fazer |
|---|---|
| Novo formulário ou linha de produto | Acrescentar o JSON em `public/forms` e registrá-lo em `index.json`. Nenhuma alteração de código. |
| Novo tipo de campo | Implementar o componente e registrá-lo em `src/features/fill/campos/registro.tsx`. |
| Novo destino de exportação | Implementar `ExportTarget` (`src/core/export/ExportTarget.ts`). `PdfExport` é a implementação da v1. |
| Trocar a persistência | Todo acesso ao Dexie passa por `ProjetoRepository`, `PreenchimentoRepository`, `MidiaRepository` e `FormularioRepository`. Nenhuma tela importa Dexie. |
| Conteúdo de apoio | Trocar o arquivo em `public/media`. O caminho fica no JSON. |

### Modelo de dados

```
projetos:          ++id, empresa, nomeProjeto, operador, criadoEm, atualizadoEm
tags:              ++id, projetoId, nome, ordem, [projetoId+ordem]
preenchimentos:    ++id, tagId, formId, atualizadoEm, [tagId+formId]
midias:            ++id, preenchimentoId, etapaId, [preenchimentoId+etapaId]
formulariosCustom: id, atualizadoEm
sessao:            chave        (identificador do aparelho e credencial de acesso)
```

Fotos são gravadas como **Blob**, nunca base64. `respostas` é um mapa
`etapaId → { valor, observacao }`. Excluir um projeto ou uma TAG remove em
cascata os preenchimentos e as mídias.

### Tipos de resposta

| `tipoResposta` | Componente | Registro |
|---|---|---|
| `check` | confirmação única | booleano |
| `check_com_foto` | confirmação + área de fotos | booleano + blobs |
| `foto` | somente área de fotos | blobs |
| `numero` | campo numérico com unidade | número |
| `texto` | campo de texto livre | string |
| `selecao` | lista de opções | string |
| `anexo_pdf` | anexo de arquivo PDF | blob |
| `grade_numerica` | tabela de valores | linha → coluna → número |

`grade_numerica` é uma extensão da tabela da especificação, registrada pelo
mecanismo previsto no ponto de extensão 2. Atende os ensaios da rotina BT: o
torque por parafuso (R3.10) e os 10 pares de isolamento (R5.1), que de outro
modo virariam dezenas de etapas numéricas soltas. Como todo campo numérico da
rotina, **apenas registra o valor** — não há validação de faixa nem alerta.

---

## Formulários

| Arquivo | Conteúdo |
|---|---|
| `sen-plus-montagem.json` | 38 etapas em 5 seções (estrutura, barramentos, placas, separações, vedações) |
| `rotina-bt.json` | 62 etapas em 10 seções (R1 a R10), fusão do *Routine Verification Checklist* com o *Low Voltage Switchboard Checklist* |

Qualquer alteração é validada por `npm run validar-formularios`, que roda
automaticamente antes do build.

---

## Controle de acesso

O aplicativo não abre sem autorização. Na primeira execução o montador informa
o e-mail e o painel que vai verificar; o responsável por aquele painel recebe a
solicitação por e-mail e decide. Aprovado, o aparelho guarda uma credencial
assinada e **passa a abrir offline** — a rede só é necessária para pedir o
acesso e, depois, para renovar e receber revogações.

A autorização vale para **aquele aparelho**. Digitar um e-mail já aprovado em
outro aparelho gera uma solicitação nova, e o responsável recebe outro aviso.

Quem tem o próprio endereço cadastrado como responsável de um painel recebe o
link de confirmação na própria caixa e ganha a aba **Autorizações**, onde
decide vários pedidos de uma vez e revoga acessos.

O servidor que sustenta isso é o `cmd/api`, um binário Go que guarda as
solicitações e envia os e-mails. **Ele não recebe dado de formulário nenhum:**
os preenchimentos continuam exclusivamente no aparelho. Instalação,
configuração e rotas estão em [`cmd/api/README.md`](cmd/api/README.md).

Para o build do aplicativo:

| Variável | Efeito |
|---|---|
| `VITE_API_URL` | Endereço da API de autorização |
| `VITE_AUTH_CHAVE_PUBLICA` | Chave pública (JWK) que confere a credencial offline. Sai de `go run . -gerar-chave` |
| `VITE_SEM_AUTORIZACAO=1` | Desliga o controle de acesso. Só para desenvolvimento — o aplicativo exibe uma faixa amarela permanente |

> **O que isto protege.** A credencial protege o acesso à tela. Os
> preenchimentos e as fotos continuam no IndexedDB do aparelho, alcançáveis
> pelas ferramentas do navegador por quem estiver com o aparelho na mão.
> Fechar isso exige mover os dados para o servidor, o que está fora do escopo
> desta versão.

---

## Aba de administração

Acesso em **Administração**, no cabeçalho. Permite, sem programação: editar
descrição e detalhes de qualquer etapa, ativar e desativar etapas, reordenar
etapas dentro de uma seção, trocar o conteúdo de apoio, exportar o JSON e
importar um JSON com validação e mensagem de erro legível.

As edições ficam no IndexedDB do aparelho e têm precedência sobre o arquivo
publicado. Para distribuir uma alteração a todos, exporte o JSON e substitua o
arquivo em `public/forms` na próxima publicação. O botão **Restaurar original**
descarta as edições locais.

A senha fica em `src/core/config.ts` (constante `SENHA_ADMIN`) e pode ser
trocada no build com a variável `VITE_SENHA_ADMIN`:

```bash
VITE_SENHA_ADMIN='senha-do-cliente' npm run build
```

> **Pendência da especificação (seção 15):** a senha inicial é `abb-admin` e
> **precisa ser trocada antes de publicar** para os parceiros. A senha só evita
> edição acidental do conteúdo dos formulários; quem controla o acesso ao
> sistema é a autorização por painel, descrita acima.

---

## Geração do PDF

- Sempre disponível, independentemente de pendências.
- Etapas sem resposta são impressas como **“Não verificado”**.
- Primeira página: capa com dados do projeto e resumo de pendências por TAG.
- Um PDF por tipo de verificação, com todas as TAGs, separadas por seção.
- Colunas `Etapa | Descrição | Aferido | Status | Data | Operador`, cabeçalhos de
  seção destacados e numeração de páginas no rodapé.
- Registro da revisão do formulário utilizada.
- Escolha entre fotos incorporadas ao PDF ou PDF sem fotos acompanhado de um ZIP
  com as imagens nomeadas `TAG_ETAPA_N.jpg`.
- Nome do arquivo: `EMPRESA_PROJETO_TIPO-VERIFICACAO_AAAA-MM-DD.pdf`.

O envio por e-mail é feito manualmente pelo montador.

---

## Limitação conhecida — sem sincronização

Cada aparelho mantém a sua própria base. Um preenchimento iniciado no celular
**não aparece** no notebook, e vice-versa.

Mitigação da v1: **Exportar projeto** (na tela do projeto) grava um `.zip` com o
JSON dos dados e as fotos; **Importar projeto** (na tela inicial) lê esse arquivo
e recria o projeto no outro aparelho, com o sufixo “(importado)” no nome. A
transferência é manual.

Solução definitiva: servidor central, previsto para versão futura. A camada de
persistência já está atrás dos repositórios para que a troca não afete as telas.

---

## Pendências de conteúdo

| Item | Situação |
|---|---|
| Descrição da etapa **S2.6** | Ilegível no OCR. Está no JSON com o texto marcado como `TRANSCREVER` e `pendenteTranscricao: true`; a etapa aparece com aviso na tela. |
| Imagens de referência das 38 etapas | Ainda não recortadas. Os caminhos já estão no JSON; a lista completa está em `public/media/sen-plus/LEIA-ME.md`. Enquanto o arquivo não existir, o modal de ajuda mostra um aviso com o caminho esperado, sem quebrar a tela. |
| Redação exata das etapas | Conferir contra o documento original. S1.1, S1.3, S2.2 e S2.6 estão marcadas com `pendenteTranscricao`. |
| Senha da administração | Provisória (`abb-admin`). Trocar antes de publicar. |
| Painéis e responsáveis | `cmd/api/paineis.exemplo.json` traz dois painéis nomeados e dois marcados como `A DEFINIR`, todos com e-mail `TROCAR@empresa.com.br`. Preencher antes de publicar. |
| Servidor de e-mail | Sem `SMTP_HOST` a API sobe com o emissor de log e **nenhum e-mail sai**. Definir o SMTP com o TI. |

---

## Decisões registradas

Sem julgamento de conformidade no sistema (não existem estados “OK” e “Não OK”:
a etapa é respondida ou fica em branco); sem estado “não aplicável”; PDF sempre
gerável; ordem de preenchimento livre; operador e data informados uma vez e
replicados em todas as etapas; dados exclusivamente no aparelho; sem marca
d'água nas fotos; sem trilha de auditoria de preenchimento além da data da
última alteração.

Sobre o acesso: sem senha — a identidade é o reconhecimento do responsável,
que sabe quem está na obra, somado à posse do aparelho; autorização amarrada
ao aparelho, não ao endereço digitado; credencial válida offline, aceitando
que uma revogação só alcança o aparelho quando ele reencontrar a rede; e
trilha de auditoria completa dos acessos (quem pediu, de qual aparelho, quem
decidiu e quando).
