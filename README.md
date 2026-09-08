# Sistema de Verificação de Montagem de Painéis

Aplicação para o montador do parceiro de painel certificado registrar, durante a
montagem, as verificações exigidas pelos protocolos ABB.

O acesso tem três passos: o montador entra com o e-mail, escolhe o painel e
espera a aprovação do responsável por aquele painel. Só então o fluxo abre —
ver [Acesso: e-mail, painel e aprovação](#acesso-e-mail-painel-e-aprovação).

Escolhido o painel, é ele que decide o fluxo:

| Painel | Fluxo | Resultado |
|---|---|---|
| SEN Plus | Verificação | Dossiê em PDF que o montador envia por e-mail ao inspetor. O julgamento de conformidade é feito **fora do sistema**. |
| System pro E Energy, System pro E Power, SAFR | Certificação | Solicitação → validação ABB → **certificado de produto numerado**, gerado pelo próprio sistema. |

Implementa a especificação técnica v1.0 (02/09/2026) e a extensão de
certificação (04/09/2026).

- **Sem backend.** A saída do build é um diretório estático.
- **Acesso mediante aprovação** do responsável pelo painel, sem servidor.
- **Offline integral** após o primeiro carregamento (PWA com service worker).
- **Dados só no aparelho** (IndexedDB via Dexie). Ver [Limitação conhecida](#limitação-conhecida--sem-sincronização).

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
| `npm run build` | Valida os arquivos de dados → `tsc -b` → `vite build` |
| `npm run typecheck` | Somente a checagem de tipos |
| `npm run validar-formularios` | Valida formulários, painéis e templates de certificado contra os schemas Zod |
| `npm run fumaca` | Teste de fumaça dos dois fluxos em navegador real |
| `npm run build-demo` | Gera a demonstração de página única (`demo/verificacao-paineis.html`) |
| `scripts/build-portatil.sh` | Gera o binário portátil (modalidade B) |

A demonstração de página única embute os dados nos próprios arquivos e dispensa
servidor: serve para mostrar o aplicativo a quem não vai instalar nada. Sem
backend, ela não envia e-mail nem baixa PDF — o pedido de aprovação cai no
caminho manual.

O teste de fumaça exige Playwright, que **não** é dependência do projeto:

```bash
npm run build && npx vite preview --port 8099 &
npm i -D playwright && npx playwright install chromium
BASE_URL=http://localhost:8099 npm run fumaca
```

Ele percorre os dois fluxos: no SEN Plus, criação de projeto, preenchimento com
salvamento automático, persistência após recarregar, modal de apoio, geração dos
PDFs nas duas opções de foto, exportação do projeto, grade de ensaios e aba de
administração; na certificação, solicitação com campos obrigatórios, checklist
com etapa condicional e evidência fotográfica, envio, devolução com apontamentos,
reenvio, aprovação com numeração e geração do certificado.

Em ambientes com o Chromium já instalado, aponte o executável em vez de baixá-lo:

```bash
CHROMIUM=/caminho/para/chrome npm run fumaca
```

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
  paineis/
    index.json            catálogo dos tipos de painel: fluxo, checklists,
                          template de certificado, responsável ABB e campos
  forms/                  definições JSON dos formulários — editáveis sem build
    index.json            catálogo dos formulários disponíveis
    sen-plus-montagem.json
    rotina-bt.json
    ensaios-rotina-61439.json
  certificados/           templates de certificado, um por tipo de painel
    spee.json  spep.json  safr.json
  docs/                   PDF de instruções exibido abaixo do cabeçalho
  media/                  conteúdo de apoio — editável sem build
    sen-plus/             (ver LEIA-ME.md: lista das imagens esperadas)
src/
  app/                    rotas, layout, shell da PWA
  core/
    access/               código de aprovação de acesso ao painel
    auth/                 e-mail em sessão, administradores e responsáveis
    db/                   Dexie: schema e repositórios
    forms/                motor: schema Zod, catálogo, progresso
    paineis/              catálogo dos tipos de painel
    certificacao/         solicitação, validação ABB e numeração (interfaces)
    certificado/          template como dado e geração do PDF do certificado
    media/                compressão e normalização de imagem
    export/               ExportTarget, dossiê, PDF, backup .zip
  features/
    paineis/              tela inicial de seleção de painel
    projects/             listagem, criação, TAGs
    solicitacoes/         solicitação de certificação
    fill/                 preenchimento e registro de tipos de campo
    pdf/                  diálogo de geração
    admin/                administração e validação ABB
  shared/                 componentes de UI, ícones, hooks, utilidades
cmd/servidor/             servidor portátil em Go (modalidade B)
scripts/                  validação dos arquivos de dados, build portátil, fumaça
```

**Princípio central:** o núcleo não conhece nenhum painel, formulário ou
certificado específico. Tipos de painel, checklists e templates de certificado
são JSON carregados em tempo de execução a partir de `public/`. Acrescentar um
painel é acrescentar arquivos de dados — sem alteração de código.

Uma diferença em relação ao desenho da especificação: a montagem do documento
PDF vive em `core/export/pdf/`, e não em `features/pdf/`. Assim `core` não
importa `features`, e `features/pdf` fica só com a interface de usuário do
diálogo de geração.

### Pontos de extensão

| Extensão | O que fazer |
|---|---|
| Novo tipo de painel | Acrescentar a entrada em `public/paineis/index.json` (fluxo, checklists, responsável) e, no fluxo de certificação, o template em `public/certificados`. Nenhuma alteração de código. |
| Novo formulário ou linha de produto | Acrescentar o JSON em `public/forms`, registrá-lo em `index.json` e citá-lo no painel. Nenhuma alteração de código. |
| Novos campos da solicitação | Editar `camposPadrao` em `public/paineis/index.json`, ou dar ao painel a sua própria lista `campos`. |
| Novo tipo de campo | Implementar o componente e registrá-lo em `src/features/fill/campos/registro.tsx`. |
| Novo destino de exportação | Implementar `ExportTarget` (`src/core/export/ExportTarget.ts`). `PdfExport` é a implementação da v1. |
| Trocar a persistência | Todo acesso ao Dexie passa pelos repositórios e, na certificação, por `SolicitacaoStore`. Nenhuma tela importa Dexie. |
| Responsável ou administrador de um painel | Editar `public/paineis/index.json`. Nenhuma alteração de código. |
| Servidor no lugar do local | Trocar o que `src/core/certificacao/index.ts` aponta em `solicitacaoStore` e `servicoValidacao`. Nenhuma tela muda. |
| Conteúdo de apoio | Trocar o arquivo em `public/media`. O caminho fica no JSON. |

### Modelo de dados

```
projetos:          ++id, tipoPainel, empresa, nomeProjeto, operador, criadoEm, atualizadoEm
tags:              ++id, projetoId, nome, ordem, [projetoId+ordem]
preenchimentos:    ++id, tagId, solicitacaoId, formId, atualizadoEm, [tagId+formId]
midias:            ++id, preenchimentoId, etapaId, [preenchimentoId+etapaId]
formulariosCustom: id, atualizadoEm
solicitacoes:      ++id, tipoPainel, estado, numeroCertificado, criadoEm, atualizadoEm
certificados:      ++id, &numero, solicitacaoId, tipoPainel, emitidoEm
contadores:        id
acessos:           ++id, email, painelId, [email+painelId]
```

`acessos` guarda a permissão de montagem: um registro por par *e-mail +
painel*, com `aprovadoEm` nulo enquanto o responsável não aprova. O e-mail em
sessão e o painel ativo ficam no `localStorage` (`core/auth/sessao`), não no
Dexie: são escolha de tela, não dado de trabalho.

Fotos são gravadas como **Blob**, nunca base64. `respostas` é um mapa
`etapaId → { valor, observacao }`. Excluir um projeto, uma TAG ou uma
solicitação remove em cascata os preenchimentos e as mídias.

Um preenchimento pertence a uma TAG (fluxo de verificação) **ou** a uma
solicitação (fluxo de certificação) — nunca aos dois. Assim o motor de
preenchimento, as fotos e o cálculo de progresso servem aos dois fluxos sem
duplicação. Projetos gravados antes desta versão não têm `tipoPainel` e contam
como SEN Plus; o esquema do Dexie subiu para a versão 2 sem migração de dados.

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

| Arquivo | Painel | Conteúdo |
|---|---|---|
| `sen-plus-montagem.json` | SEN Plus | 38 etapas em 5 seções (estrutura, barramentos, placas, separações, vedações) |
| `rotina-bt.json` | SEN Plus | 62 etapas em 10 seções (R1 a R10), fusão do *Routine Verification Checklist* com o *Low Voltage Switchboard Checklist* |
| `ensaios-rotina-61439.json` | SPEE, SPEP e SAFR | Ensaios de rotina 11.2 a 11.10 da NBR IEC 61439, conteúdo idêntico nos três painéis |

Não há checklist de montagem para SPEE, SPEP e SAFR: o fluxo de certificação
usa somente o checklist de ensaios de rotina.

Qualquer alteração — em formulários, no catálogo de painéis ou nos templates de
certificado — é validada por `npm run validar-formularios`, que roda
automaticamente antes do build.

### Etapa condicional e evidência obrigatória

Duas capacidades do motor entraram com o fluxo de certificação. Ambas são
declaradas no JSON e não mudam nada em quem não as usa:

- `exibirSe: { etapaId, igualA: [...] }` — a etapa só aparece (e só entra no
  progresso) quando a etapa apontada foi respondida com um dos valores listados.
  É o que faz a justificativa e a autorização de componente de outro fabricante
  surgirem apenas quando o montador indica substituição (11.5.1 → 11.5.2 e
  11.5.3). O validador confere que a etapa apontada existe e oferece os valores
  esperados.
- `fotoObrigatoria: true` — a etapa só conta como respondida com pelo menos um
  arquivo anexado. É o que torna as evidências fotográficas exigidas pelo Anexo 2
  bloqueantes para o envio.

## Acesso: e-mail, painel e aprovação

```
login por e-mail  →  escolha do painel  →  aprovação do responsável  →  fluxo do painel
```

Nenhuma tela de trabalho é montada antes dos três passos — inclusive o
preenchimento aberto por URL direta. `/aprovar` é a única exceção: é a tela que
o responsável abre a partir do e-mail, e ela não concede acesso a nada.

1. **Login** — o montador informa o e-mail. Não é autenticação (não há
   servidor): é a identificação que o pedido leva ao responsável.
2. **Escolha do painel** — os painéis do catálogo aparecem marcados como
   **Liberado** ou **Requer aprovação**. Escolher um painel ainda não liberado
   leva ao pedido.
3. **Pedido** — com envio configurado, o servidor manda a mensagem ao
   responsável do painel (`responsavelMontagem` no catálogo) e a tela confirma
   o destinatário. Sem envio configurado, o aplicativo abre o cliente de
   e-mail com a mensagem pronta e deixa o link à vista para envio manual.
4. **Aprovação** — o responsável abre o link do e-mail
   (`#/aprovar?email=…&painel=…`), escolhe o **prazo** (30, 60, 90 ou 180
   dias), vê o **código de aprovação** correspondente e o repassa ao montador;
   um botão já monta o e-mail de resposta.
5. **Liberação** — o montador digita o código. A liberação vale para o par
   *e-mail + painel*, naquele aparelho, **até o fim do prazo**; vencida, a tela
   do painel volta a pedir aprovação.

A liberação é por painel: quem foi aprovado no SEN Plus continua precisando de
aprovação para o System pro E Power. Outro e-mail no mesmo aparelho também
começa do zero.

### Por que um código, e não um link que aprova sozinho

Não há servidor: o aparelho do montador não tem como saber, por conta própria,
que o responsável aprovou — nem que ele mudou de ideia. O código resolve as
duas coisas sem rede. Ele tem nove caracteres (`XXX-XXX-XXX`): três carregam o
**dia de vencimento** e seis são a assinatura de
`e-mail + painel + vencimento + segredo do build` (SHA-256). O aparelho do
responsável, rodando o mesmo build, gera; o do montador confere e aprende até
quando aquilo vale. O e-mail enviado pelo montador leva **apenas o link**; o
código nunca passa por ele.

É o prazo que torna a permissão revogável sem servidor: **para tirar o acesso
de alguém, basta não repassar código novo** — no vencimento o aplicativo
fecha o painel sozinho, inclusive offline. A permissão é reconferida a cada
entrada no fluxo, então o vencimento também alcança quem deixou o aplicativo
aberto.

Consequências assumidas nesta versão:

- Revogar não é imediato: o acesso cai no vencimento do código em curso.
  Prazo curto encurta essa janela.
- Aprovar não fica registrado no aparelho do responsável — a tela `/aprovar`
  só exibe o código, não grava nada. Não há lista central de quem tem acesso.
- A liberação vale para o aparelho onde o código foi digitado. Outro aparelho
  exige novo pedido.
- Renovar é digitar o código novo: o prazo passa a valer a partir dele.
- Trocar `VITE_SEGREDO_APROVACAO` invalida os códigos já distribuídos.
- Registro aprovado numa versão anterior, sem prazo gravado, conta como
  vencido e pede código novo.

Não é barreira criptográfica: o segredo viaja no pacote JavaScript, e quem
inspecionar o build consegue gerar códigos para qualquer painel e qualquer
prazo. O controle organiza a autorização; barreira real, com lista central e
revogação imediata, exige servidor — por conta ABB, o caminho natural é login
pelo Entra ID com acesso por grupo, e está previsto junto com a sincronização.

### Configuração

Cada painel do catálogo (`public/paineis/index.json`) declara quem aprova o
acesso e quem administra os formulários:

```json
{
  "id": "sen-plus",
  "nome": "SEN Plus",
  "responsavelMontagem": "ericg10456@gmail.com",
  "administradores": ["ericg10456@gmail.com"]
}
```

| Campo | Sem valor no catálogo | Onde muda no build |
|---|---|---|
| `responsavelMontagem` | vale `RESPONSAVEL_MONTAGEM_PADRAO` | `VITE_RESPONSAVEL_MONTAGEM` |
| `administradores` | vale `ADMIN_PADRAO` | `VITE_ADMIN_PADRAO` |
| segredo do código | `abb-montagem-2026` | `VITE_SEGREDO_APROVACAO` |
| prazos oferecidos | 30, 60, 90 e 180 dias | `PRAZOS_APROVACAO`, em `src/core/access/codigo.ts` |

**Para teste, os quatro painéis estão com `ericg10456@gmail.com` como
responsável.** O link de aprovação usa o endereço em que o aplicativo está
aberto: na modalidade portátil ele sai como `http://localhost:8080` e não serve
ao responsável — publique a modalidade hospedada para usar a aprovação por
e-mail.

### Envio do pedido por e-mail

O aplicativo, sozinho, não envia nada: `mailto:` apenas abre um rascunho no
programa do montador, e navegador nenhum permite isso dentro de um iframe
restrito. Quem envia de verdade é a rota `POST /api/aprovacao`
(`cmd/servidor/aprovacao.go`), atendida pelo binário portátil.

O pedido informa **só** o e-mail do montador e o painel. Destinatário, assunto,
corpo e link saem do servidor — que lê o `responsavelMontagem` do catálogo e
monta o endereço pela origem da requisição. Assim a rota não vira relé de spam.
Há limite de um envio por minuto para cada par montador + painel e de 20 por
hora por máquina de origem.

Sem variável de ambiente nenhuma a rota responde `501` e o aplicativo volta ao
rascunho manual — nada quebra.

| Variável | Para que serve |
|---|---|
| `APROVACAO_TRANSPORTE` | `smtp`, `resend` ou `sendgrid` |
| `APROVACAO_REMETENTE` | endereço que aparece como remetente |
| `APROVACAO_RESPONSAVEL` | destinatário quando o painel não declara um |
| `SMTP_HOST` `SMTP_PORTA` `SMTP_USUARIO` `SMTP_SENHA` | servidor SMTP (STARTTLS na 587) |
| `SMTP_TLS=implicito` | TLS desde o primeiro byte (porta 465) |
| `EMAIL_API_CHAVE` | chave do Resend ou do SendGrid |

```bash
APROVACAO_TRANSPORTE=smtp \
APROVACAO_REMETENTE=verificacao@empresa.com \
SMTP_HOST=smtp.office365.com SMTP_USUARIO=verificacao@empresa.com SMTP_SENHA=… \
./verificacao-montagem-windows-amd64.exe
```

Do lado do aplicativo, `VITE_URL_APROVACAO` diz para onde vai o pedido. O
padrão é a própria origem (`/api/aprovacao`), que é o binário portátil. String
vazia desliga o envio e mantém apenas o rascunho manual.

**SharePoint não roda backend** — ele hospeda arquivo estático e não executa
código de servidor. Publicando o aplicativo lá, aponte `VITE_URL_APROVACAO`
para um fluxo do Power Automate com gatilho HTTP (ou uma Azure Function): o
contrato é o mesmo, `POST {"emailMontador","painelId"}` respondendo
`{"enviado":true,"destinatario":"…"}`. O mesmo vale para qualquer função em
nuvem.

Limites do modo portátil: só envia com o binário aberto naquela máquina, e quem
chama precisa alcançá-la pela rede. Outro aparelho acessando por
`http://192.168.x.x:8080` perde o contexto seguro e **fica sem câmera** — só
`localhost` e `https` são contexto seguro.

A resposta do responsável (a tela `/aprovar`, que devolve o código) continua
saindo pelo cliente de e-mail dele: é a máquina de quem aprova, com programa de
e-mail de verdade.

---

## Fluxo de certificação

```
rascunho ──enviar──> enviada ──aprovar──> aprovada ──gerar──> emitida
                        │
                        └──devolver──> devolvida ──corrigir e reenviar──┘
```

- **Uma solicitação por painel/quadro.** Cada TAG gera uma solicitação dedicada e
  independente, com preenchimento e evidências próprios.
- **Envio bloqueado** enquanto houver campo obrigatório vazio ou etapa do
  checklist sem resposta. A tela lista exatamente o que falta.
- **Enviada, aprovada ou emitida**, a solicitação fica em somente leitura para o
  montador; o checklist abre travado, para conferência.
- **Devolvida**, volta a ser editável com os apontamentos no topo, preservando
  todo o preenchimento já feito.
- **O certificado só é gerado após a aprovação explícita** do responsável ABB.

### Responsáveis e numeração

| Painel | Responsável ABB | Template |
|---|---|---|
| System pro E Energy | Tainá Gioia | `certificados/spee.json` |
| System pro E Power | Carlos Eduardo Silva | `certificados/spep.json` |
| SAFR | Tainá Gioia | `certificados/safr.json` |

Na aprovação, a camada de validação atribui um número **sequencial global, único
e imutável** (`0001`, `0002`, …) resolvido em transação, com índice único em
`certificados.numero`. Junto com o número grava-se o registro da emissão — data,
tipo de painel, projeto, TAG, cliente final e montador —, visível na aba de
administração. Uma solicitação já numerada não recebe outro número.

O prefixo do número pode ser definido no build:

```bash
VITE_PREFIXO_CERTIFICADO='ABB-' npm run build
```

### Certificado

Um template por tipo de painel, em `public/certificados`. O corpo é idêntico nos
três; variam o título do produto e o bloco de assinatura. O corpo traz a
conformidade com a NBR IEC 61439-1/2, as verificações do item 10.1 (10.2 a
10.13), os ensaios de rotina do montador (11.2 a 11.10) e a nota de que as
medidas devem ser registradas no protocolo do montador e anexadas ao documento.

Os campos vêm da solicitação aprovada por marcadores `{{campo}}`: número do
certificado, data de emissão, projeto, cliente final, TAG, corrente nominal,
corrente de curto-circuito e nome do montador. O bloco de assinatura usa
`{{responsavel.*}}`, resolvido a partir do catálogo de painéis — o responsável
fica declarado em um só lugar, e é o mesmo que aprova a solicitação.

Nenhum texto do certificado está no código: o gerador em
`src/core/certificado/documento.ts` só sabe desenhar os tipos de bloco
(`campos`, `paragrafo`, `lista`, `nota`, `campoLargo`, `assinatura`).

---

## Aba de administração

Acesso em **Administração**, no cabeçalho. Duas abas.

**Validação ABB** — lista as solicitações enviadas com os dados informados e a
situação do checklist, e permite aprovar (atribuindo o número do certificado) ou
devolver com apontamentos. Abaixo, o registro de todas as emissões. Quando o
preenchimento tiver pendências, elas são exibidas antes da decisão.

**Formulários** — permite, sem programação: editar descrição e detalhes de
qualquer etapa, ativar e desativar etapas, reordenar etapas dentro de uma seção,
trocar o conteúdo de apoio, exportar o JSON e importar um JSON com validação e
mensagem de erro legível.

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
> **precisa ser trocada antes de publicar** para os parceiros. Não há
> autenticação nem controle de usuários: a senha só evita edição acidental.
> Com a validação ABB atrás da mesma senha, trocá-la passou a ser requisito de
> publicação, não recomendação.

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
| Senha da administração | Provisória (`abb-admin`). Trocar antes de publicar — agora protege também a aprovação de certificados. |
| Segredo do código de aprovação | Provisório (`abb-montagem-2026`). Trocar antes de publicar. |
| Responsáveis pela liberação de acesso | Os 4 painéis estão com `ericg10456@gmail.com` para teste. Substituir pelos responsáveis reais em `public/paineis/index.json`. |
| E-mails dos responsáveis ABB | `taina.gioia@br.abb.com` e `carlos.e.silva@br.abb.com`, reconstruídos do PDF do Anexo 2 (o OCR do arquivo suprime pontos). Conferir antes de publicar; ficam em `public/paineis/index.json`. |
| Imagens de apoio dos ensaios de rotina | O checklist da NBR IEC 61439 ainda não tem `midiaApoio`. Os textos de orientação estão em `detalhes`; as imagens entram no JSON quando existirem. |

---

## Decisões registradas

Sem julgamento de conformidade no sistema (não existem estados “OK” e “Não OK”:
a etapa é respondida ou fica em branco); sem estado “não aplicável”; PDF sempre
gerável; ordem de preenchimento livre; operador e data informados uma vez e
replicados em todas as etapas; dados exclusivamente no aparelho; sem
autenticação de usuário (o acesso é autorização por painel, não login); sem
marca d'água nas fotos; sem trilha de auditoria além da data
da última alteração.

Da extensão de certificação: o comportamento do SEN Plus não mudou — os novos
campos obrigatórios e o ciclo de validação valem apenas para SPEE, SPEP e SAFR;
o certificado sai em PDF, no mesmo padrão de saída do dossiê; a validação ABB
mora na área já protegida por senha, e não em uma rota com senha própria; o
mesmo checklist de ensaios de rotina atende os três painéis, com o catálogo de
painéis apontando para ele — se um painel divergir, basta apontar para outro
arquivo; o backup `.zip` cobre apenas o fluxo de projeto/TAG, já que a
solicitação tem ciclo próprio de envio e aprovação.
