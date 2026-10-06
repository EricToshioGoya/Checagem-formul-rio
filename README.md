# Sistema de Verificação de Montagem de Painéis

Aplicação para o montador do parceiro registrar, durante a montagem do painel,
as verificações exigidas pelos protocolos ABB. O painel decide o que vem
depois:

| Painel | Fluxo | Resultado |
|---|---|---|
| SEN Plus (e todo painel cadastrado na administração) | Verificação | Dossiê em PDF que o montador envia por e-mail ao inspetor. O julgamento de conformidade é feito **fora do sistema**. |
| System Pro E Energy, System Pro E Power, SAFR | Certificação | Solicitação → validação ABB → **certificado de produto numerado**, gerado pelo próprio sistema. Ver [Fluxo de certificação](#fluxo-de-certificação). |

Implementa a especificação técnica v1.0 (02/09/2026), a extensão de
certificação (04/09/2026) e o controle de acesso por painel descrito em
[Login e aprovação](#login-e-aprovação).

- **Cliente estático + servidor de acesso.** O PWA é um diretório estático; um
  servidor pequeno cuida de contas, painéis e aprovação.
- **Offline no preenchimento.** Entrar exige rede uma vez; depois de aprovado,
  registrar as checagens funciona sem conexão.
- **As checagens não trafegam.** Respostas e fotos ficam no aparelho (IndexedDB
  via Dexie); o servidor guarda só quem pode preencher o quê. Ver
  [Limitação conhecida](#limitação-conhecida--sem-sincronização).

---

## Começando

```bash
npm install
npm run servidor     # API de acesso em http://localhost:3001
npm run dev          # aplicação em http://localhost:5173
npm run build        # valida os formulários, checa tipos e gera dist/
npm run preview      # serve o dist/ gerado
```

São dois processos: o `dev` faz proxy de `/api` para o `servidor`. Sem o
servidor no ar, a tela de login avisa que está sem conexão.

Requer Node 22.5 ou superior — o servidor usa `node:sqlite`, embutido a partir
dessa versão.

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Vite em modo desenvolvimento |
| `npm run servidor` | API de acesso (contas, painéis, aprovação) |
| `npm run build` | Valida JSON dos formulários → `tsc -b` → `vite build` |
| `npm run typecheck` | Somente a checagem de tipos |
| `npm run validar-formularios` | Valida `public/forms/*.json` contra o schema Zod |
| `npm run admin -- listar` | Lista os administradores (socorro, na máquina do servidor) |
| `npm run admin -- promover <e-mail>` | Dá o papel de administrador a uma conta existente |
| `npm run icones` | Regera os ícones PNG do aplicativo a partir do vetor do logotipo |
| `npm run fumaca` | Teste de fumaça do fluxo completo em navegador real |
| `npm run testes` | Bateria de verificação de contorno (ver `scripts/testes/README.md`) |
| `scripts/build-portatil.sh` | Gera o binário portátil (modalidade B) |

O teste de fumaça exige Playwright, que **não** é dependência do projeto:

```bash
npm run build
BANCO=/tmp/fumaca.db npm run servidor &      # banco vazio; serve também o dist/
npm i -D playwright && npx playwright install chromium
BASE_URL=http://localhost:3001 npm run fumaca
```

Ele cria a conta do administrador inicial e percorre os dois fluxos: no SEN
Plus, abertura do painel, marcação de etapa e persistência após recarregar; na
certificação, solicitação com campos obrigatórios, envio bloqueado, etapa
condicional, validação ABB com numeração e geração do certificado.

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
verificacao-montagem-windows-amd64.exe -api http://192.168.0.10:3001  # servidor de acesso
verificacao-montagem-windows-amd64.exe -host 0.0.0.0   # atende a rede local
```

O binário não guarda contas: `/api` é repassado ao servidor de acesso indicado
em `-api` (ou `API_ALVO`), mantendo a API na mesma origem da aplicação. De
pendrive, ele só atende `localhost` — requisições com outro `Host` são
recusadas, o que fecha o caminho de DNS rebinding até o IndexedDB; `-host`
abre isso de propósito, para quem publica na rede.

Se a porta estiver ocupada, o servidor tenta as 20 seguintes. Uma pasta `web/`
ou `dist/` ao lado do executável tem precedência sobre o conteúdo embutido — é
assim que se atualiza a aplicação no pendrive sem recompilar.

> **Não use o protocolo `file://`.** O Chrome bloqueia IndexedDB nesse
> protocolo, o que inviabiliza a persistência exigida.

---

## Login e aprovação

Na tela de login o montador informa e-mail e senha **e escolhe o painel que vai
montar**. Ao entrar, o pedido de acesso àquele painel segue sozinho para o
responsável, que aprova em **Aprovações** — só então as checagens abrem.

```
entrar / criar conta + escolher o painel
        ↓
pedido enviado ao responsável do painel  →  aguardando
        ↓                                       ↓
  acesso aprovado  ←──────────  responsável aprova em /aprovacoes
        ↓
 abrir checagens → projetos do painel → novo projeto (daqui em diante, offline)
```

**A aprovação vale para um painel só.** Quem foi aprovado em SEN Plus não abre
MNS: precisa pedir de novo, e o responsável daquela linha decide. O responsável
preenche os painéis dele sem pedir nada.

A decisão é do servidor — `podePreencher` vem dele, painel por painel, e a API
não entrega nada sem token de sessão válido. Não existe criação avulsa de
projeto: um projeto local só nasce ao abrir um painel aprovado.

A tela de login entra como **montador** por padrão. No fim dela, discreto, fica
**Entrar como administrador** — ver [Quem é administrador](#quem-é-administrador).

### Os painéis e seus responsáveis

Os painéis são cadastrados na **aba de administração** → *Painéis*, e o que
estiver lá é exatamente o que a tela de login oferece. Cada painel recebe
**um ou mais e-mails de responsável**, e qualquer um deles aprova os pedidos
daquele painel.

O vínculo é **por e-mail**, e não por id de usuário, de propósito — o
responsável pode ainda não ter criado a conta. Quando criar, os pedidos
acumulados aparecem para ele.

Na primeira subida, com o banco vazio, o servidor cria cinco painéis iniciais a
partir de [`servidor/src/paineis.ts`](servidor/src/paineis.ts):

| Painel inicial | Fluxo | Checklist |
|---|---|---|
| SEN Plus | verificação | montagem (38 etapas) + rotina BT (62) |
| System Pro E Power | certificação | ensaios de rotina NBR IEC 61439 |
| System Pro E Energy | certificação | ensaios de rotina NBR IEC 61439 |
| SAFR | certificação | ensaios de rotina NBR IEC 61439 |
| MNS | verificação | — ainda não cadastrado |

Os checklists também são semente: o servidor importa `public/forms` só com a
tabela vazia. Um arquivo citado por vários painéis vira uma cópia por painel —
os ensaios 61439 entram como `ensaios-rotina-61439`,
`ensaios-rotina-61439-system-pro-e-power` e `ensaios-rotina-61439-safr` —,
porque no banco cada checklist pertence a um painel e é editado ali.

Todos nascem com `RESPONSAVEL_PADRAO`, hoje `ericg10456@gmail.com`. **Isso é
semente, não configuração corrente:** com painéis no banco, o arquivo deixa de
ser lido, para que uma reinicialização não desfaça o que o administrador
cadastrou nem devolva responsáveis que ele removeu. Depois da primeira subida,
mexer em painel é pela aba de administração.

O `slug` é gerado a partir do nome no cadastro e **não muda ao renomear** — é
ele que amarra o painel aos formulários do catálogo e aos projetos já gravados
nos aparelhos.

> **Linha sem checklist abre vazia.** O painel abre, mas sem
> formulário nenhum e com um aviso na tela. Não se reaproveita o checklist do
> SEN Plus: as etapas de uma linha não valem para outra. Para cadastrar uma
> delas, acrescente o JSON em `public/forms` e cite o `slug` do painel no campo
> `paineis` do catálogo — sem alteração de código.

### Controle de acesso

Na aba de administração → **Acessos**, a administração vê todos os acessos de
todos os painéis e decide sem esperar o responsável:

| Ação | O que faz |
|---|---|
| **Liberar acesso** | Escolhe a conta, um ou mais painéis e o prazo — sem pedido do montador |
| **Aprovar** / **Recusar** | Decide um pedido pendente, já com prazo |
| **Prazo** | Troca o prazo de um acesso ativo, ou estende a partir do prazo atual (+1, +2, +7 dias) |
| **Retirar** | Encerra o acesso na hora; o painel deixa de abrir no aparelho |
| **Reativar** | Devolve um acesso expirado, retirado ou recusado, com prazo novo |

O prazo pode ser 1, 2, 7 ou 30 dias, um número de horas ou dias, uma data e
hora exatas, ou **sem prazo**. Vencer não depende de tarefa agendada: o
servidor compara `expiraEm` com o relógio a cada pedido e para de entregar o
painel na hora. A tela mostra a contagem regressiva, destaca o que vence em 48
horas e relê a lista a cada 30 segundos.

Só aparecem contas já criadas: o acesso é amarrado à conta, e quem ainda não
tem uma cria na tela de login. A aprovação feita pelo responsável, em
**Aprovações**, continua sem prazo.

**No aparelho**, abrir um projeto confere o acesso com o servidor; sem resposta
em 4 segundos, decide pela última situação guardada. Acesso retirado ou vencido
mostra uma tela de bloqueio — os dados ficam, e voltam a abrir quando o acesso
for liberado de novo.

### Sem conexão

O aparelho guarda a última conta confirmada pelo servidor. Ao abrir o
aplicativo sem rede, com o servidor fora do ar ou lento demais (6 segundos), o
montador entra com essa conta e a tela de painéis leva aos projetos já abertos
no aparelho. A sessão só é descartada quando o servidor a recusa (401) — e,
quando isso acontece no meio do uso, o aplicativo volta sozinho para o login.

A tela **Projetos neste aparelho** (link na tela de painéis) lista os projetos
locais e é onde se importa um projeto exportado de outro aparelho.

### O que fica em cada lado

| No servidor | No aparelho |
|---|---|
| Contas (e-mail, nome, hash da senha) | Respostas das etapas |
| Painéis e seus donos | Fotos e anexos |
| Solicitações e decisões | Formulários customizados |
| Sessões | Token da sessão |

Ao abrir um painel aprovado pela primeira vez, o aparelho cria um projeto local
amarrado àquele painel **e àquele usuário**. A **empresa** do projeto — que vai
para a capa e para o nome do PDF — é informada pelo montador na tela do
projeto; até lá, a tela pede. Reabrir cai no mesmo projeto; outra
pessoa no mesmo aparelho recebe o seu próprio, porque o IndexedDB é por origem e
não por pessoa.

### Limites desta versão

- **A senha é o que identifica.** Não há verificação de e-mail: quem digita um
  e-mail novo cria a conta na hora. Para o responsável, isso significa conferir
  o e-mail que aparece no pedido antes de aprovar — e o mesmo vale para quem
  aprova um novo administrador.
- **Retirar o acesso não apaga o que está no aparelho.** O painel deixa de
  abrir, mas as respostas e fotos já gravadas continuam lá. Sem rede, o aparelho
  só sabe de uma retirada que tenha visto na última conexão — o prazo, esse,
  vence na hora certa mesmo offline. Ver [Controle de acesso](#controle-de-acesso).
- **Não há redefinição de senha.** Sem servidor de e-mail, não há para onde
  mandar o link. Se nenhum administrador conseguir entrar, o socorro é
  `npm run admin -- promover <e-mail>` na máquina do servidor.
- **Importar projeto ignora a aprovação.** Um `.zip` exportado de outro aparelho
  é recriado localmente sem passar pelos painéis. É o preço da mitigação manual
  de sincronização; fechar isso exige amarrar o pacote ao painel de origem.
- **Todo administrador pode tudo.** Não há níveis dentro da administração:
  quem tem o papel libera acessos, cadastra painéis, edita checklists e aprova
  outros administradores. O que fica registrado é quem decidiu cada acesso e
  cada pedido de administrador — as edições de painel e checklist não.
- **Sem segundo fator.** O administrador entra só com e-mail e senha; o freio de
  tentativas torna o chute lento, mas uma senha vazada basta.
- **A modalidade portátil não guarda contas.** O binário Go entrega os
  arquivos estáticos e repassa `/api` ao servidor de acesso indicado em
  `-api`; sem alcançar esse servidor pela rede, ninguém entra.
- **Solicitações de certificação ficam no aparelho.** A validação ABB vê só as
  do aparelho em que a administração é aberta — ver
  [Fluxo de certificação](#fluxo-de-certificação).

### Configuração

| Variável | Onde | Padrão |
|---|---|---|
| `PORTA` | servidor | `3001` |
| `BANCO` | servidor | `servidor/dados/acesso.db` |
| `ADMIN_INICIAL` | servidor | `ericg10456@gmail.com` (só enquanto não há administrador) |
| `RESPONSAVEL_PADRAO` | servidor | `ericg10456@gmail.com` (só na semeadura) |
| `RESPONSAVEL_SEN_PLUS` e as três irmãs | servidor | `RESPONSAVEL_PADRAO` (só na semeadura) |
| `API_ALVO` | `vite dev` | `http://localhost:3001` |

Em produção, publique a API sob `/api` na mesma origem do PWA — é o que o
cliente assume, e o que evita CORS e cookie de terceiro.

---

## Arquitetura

```
servidor/src/            API de acesso (Node + node:sqlite, sem framework)
  banco.ts               esquema, migrações e semeadura inicial
  auth.ts                hash scrypt da senha, sessões por token e perfil
  admin.ts               papel de administrador e administrador inicial
  limite.ts              freio de tentativas de senha
  cli-admin.ts           socorro: `npm run admin -- listar | promover <e-mail>`
  paineis.ts             painéis iniciais — lidos só no banco vazio
  esquemas.ts            validação Zod de tudo que chega
  rotas.ts               contas, painéis, solicitações, administração
  index.ts               roteador HTTP
public/
  forms/                  sementes dos checklists — importadas pelo servidor
    index.json            catálogo das sementes e dos painéis de cada uma
    sen-plus-montagem.json
    rotina-bt.json
    ensaios-rotina-61439.json
  paineis/
    index.json            fluxo por slug de painel: certificação, template
                          do certificado, responsável ABB e campos
  certificados/           templates de certificado, um por painel
    spee.json  spep.json  safr.json
  docs/                   PDF de instruções exibido nas telas de certificação
  media/                  conteúdo de apoio — editável sem build
    sen-plus/             (ver LEIA-ME.md: lista das imagens esperadas)
src/
  app/                    rotas, layout, shell da PWA, portão de sessão
  core/
    api/                  cliente da API e contexto de sessão
    db/                   Dexie: schema e repositórios
    forms/                motor: catálogo, progresso, campos obrigatórios
    paineis/              catálogo de fluxos por painel
    certificacao/         solicitação, validação ABB e numeração (interfaces)
    certificado/          template como dado e geração do PDF do certificado
    media/                compressão e normalização de imagem
    export/               ExportTarget, dossiê, PDF, backup .zip
  features/
    auth/                 tela de entrar e criar conta
    paineis/              escolha do painel e caixa de aprovações
    projects/             listagem, criação, TAGs
    solicitacoes/         solicitação de certificação
    fill/                 preenchimento e registro de tipos de campo
    pdf/                  diálogo de geração
    admin/                aba de administração e validação ABB
  shared/                 componentes de UI, ícones, hooks, utilidades
    marca/logoAbb.ts      vetor do logotipo ABB (tela, PDF e ícones)
compartilhado/            contrato do formulário e regra de andamento, iguais
                          no cliente e no servidor
cmd/servidor/             servidor portátil em Go (modalidade B)
scripts/                  validação dos dados, ícones, build portátil, fumaça,
                          bateria de testes
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
| Novo formulário para uma linha | Acrescentar o JSON em `public/forms`, registrá-lo em `index.json` e citar no campo `paineis` o `slug` das linhas que o usam. Nenhuma alteração de código. |
| Novo painel, ou trocar quem aprova | Aba de administração → Painéis. Sem programação e sem reiniciar nada. |
| Novo tipo de campo | Implementar o componente e registrá-lo em `src/features/fill/campos/registro.tsx`. |
| Novo destino de exportação | Implementar `ExportTarget` (`src/core/export/ExportTarget.ts`). `PdfExport` é a implementação da v1. |
| Trocar a persistência | Todo acesso ao Dexie passa por `ProjetoRepository`, `PreenchimentoRepository`, `MidiaRepository` e `FormularioRepository`. Nenhuma tela importa Dexie. |
| Conteúdo de apoio | Imagem: enviar pela administração, na etapa. Vídeo e PDF: arquivo em `public/media`, com o caminho no JSON. |
| Painel de certificação | Acrescentar a entrada em `public/paineis/index.json` com o `slug` do painel, `fluxo: "certificacao"`, o template em `public/certificados` e o responsável ABB. Nenhuma alteração de código. |
| Novos campos da solicitação | Editar `camposPadrao` em `public/paineis/index.json`, ou dar ao painel a sua própria lista `campos`. |
| Solicitações no servidor | Trocar o que `src/core/certificacao/index.ts` aponta em `solicitacaoStore` e `servicoValidacao`. Nenhuma tela muda. |

### Modelo de dados

No aparelho (Dexie, versão 6 do schema):

```
projetos:          ++id, empresa, nomeProjeto, operador, criadoEm, atualizadoEm,
                   painelId, usuarioId, [usuarioId+painelId]
tags:              ++id, projetoId, nome, ordem, [projetoId+ordem], uid
preenchimentos:    ++id, tagId, solicitacaoId, formId, atualizadoEm, [tagId+formId]
midias:            ++id, preenchimentoId, etapaId, [preenchimentoId+etapaId], uid
formularios:       id, painelSlug, atualizadoEm
solicitacoes:      ++id, tipoPainel, usuarioId, estado, numeroCertificado,
                   criadoEm, atualizadoEm
certificados:      ++id, &numero, solicitacaoId, tipoPainel, emitidoEm
contadores:        id
```

Um preenchimento pertence a uma TAG (verificação) **ou** a uma solicitação
(certificação) — nunca aos dois. Assim o motor de preenchimento, as fotos e o
cálculo de andamento servem aos dois fluxos sem duplicação; a sincronização
trata só os de TAG.

No servidor (SQLite):

```
usuarios      id, email (único), nome, senha (scrypt), criadoEm, papel
paineis             id, slug (único), nome, descricao, ordem, criadoEm
painel_responsaveis painelId, email                    chave (painelId, email)
solicitacoes  id, painelId, usuarioId, status, mensagem, criadoEm,
              decididoEm, decididoPor, expiraEm  único (painelId, usuarioId)
pedidos_admin id, usuarioId (único), status, criadoEm, decididoEm, decididoPor
sessoes       token, usuarioId, criadoEm, expiraEm, perfil
```

`status` é `pendente`, `aprovada`, `recusada` ou `revogada`; uma aprovação com
`expiraEm` no passado é lida como **expirada**, sem que a linha mude.
`decididoPor` aponta o administrador que decidiu; nulo numa linha decidida é
da antiga administração por senha compartilhada. Bancos anteriores são migrados
na subida, e as aprovações existentes ficam sem prazo.

`usuarios.papel` é `montador` ou `admin`; `sessoes.perfil` diz por qual porta a
sessão foi aberta. `pedidos_admin.status` é `pendente`, `aprovado`, `recusado`
ou `removido` (administrador tirado do papel).

Fotos são gravadas como **Blob**, nunca base64. `respostas` é um mapa
`etapaId → { valor, observacao }`. Excluir um projeto, uma TAG ou uma
solicitação remove em cascata os preenchimentos e as mídias.

O painel (SEN Plus, MNS…) é o tipo, não uma TAG. **Abrir checagens** leva à
lista de projetos do montador naquele painel, onde ele cria quantos projetos
quiser. O cadastro pede, tudo obrigatório: nome do projeto, empresa,
**fabricante do conjunto** e **cliente final** (valem para o projeto inteiro e
aparecem assim que algum checklist marcado os tiver), quantidade de TAGs e,
para cada TAG, o nome, os checklists que ela vai preencher (`tags.formIds`) e
o restante dos **dados do painel** — a união dos campos de cabeçalho desses
checklists. Os dados são gravados no cabeçalho de cada checklist escolhido, e
alterar um campo num checklist altera o mesmo campo nos outros da TAG; no caso
de fabricante e cliente final (`CAMPOS_DO_PROJETO` em
`src/core/forms/dadosTag.ts`), em todas as TAGs do projeto. TAG adicionada
depois herda esses dois do projeto. Os checklists podem ser trocados depois em **Checklists**; desmarcar não
apaga respostas. TAG sem `formIds` — anterior a esta regra — segue com todos.

Cada projeto tem `uid`, que o identifica no servidor (`sync_projetos` e
`sync_midias` usam `projetoUid`; rotas `/api/sync/projetos/:uid`). O projeto
que existia antes, um por conta e painel, recebe nos dois lados o mesmo `uid`
legado derivado do id do painel (`compartilhado/projeto.ts`), e a migração não
duplica nada.

Projetos gravados antes de existir login ficam sem `usuarioId` e continuam
visíveis para quem estiver logado — não há a quem atribuí-los.

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
| `ensaios-rotina-61439.json` | Ensaios de rotina 11.2 a 11.10 da NBR IEC 61439, conteúdo idêntico em SPEE, SPEP e SAFR |

Qualquer alteração — nas sementes, no catálogo de fluxos ou nos templates de
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
  bloqueantes para o envio. Cada checklist decide, etapa a etapa: no construtor
  da administração, as etapas "Conferir e fotografar" têm a opção **Foto
  obrigatória**. Desmarcada, basta marcar "verificado".

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
- **O certificado só é gerado após a aprovação explícita** do responsável ABB,
  na aba **Validação ABB** da administração.
- **As solicitações ficam no aparelho.** Diferente das checagens de projeto,
  elas não sincronizam: a validação ABB enxerga as solicitações gravadas no
  aparelho em que é aberta. Levá-las ao servidor é trocar a implementação em
  `src/core/certificacao/index.ts` — as telas não mudam.

### Responsáveis e numeração

| Painel (`slug`) | Responsável ABB | Template |
|---|---|---|
| System Pro E Energy (`system-pro-e-energy`) | Tainá Gioia | `certificados/spee.json` |
| System Pro E Power (`system-pro-e-power`) | Carlos Eduardo Silva | `certificados/spep.json` |
| SAFR (`safr`) | Tainá Gioia | `certificados/safr.json` |

O fluxo de cada painel vem de `public/paineis/index.json`, pelo `slug` do painel
no servidor. Painel sem entrada ali — todo painel novo da administração — segue
a verificação. Quem pode abrir as solicitações de um painel é a mesma regra dos
projetos: acesso aprovado pelo responsável ou liberado pela administração,
reconferido a cada entrada.

O responsável ABB (quem assina o certificado) e o responsável do painel (quem
aprova o acesso do montador) são coisas diferentes: o primeiro mora no
catálogo de fluxos, o segundo no cadastro de painéis do servidor.

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

---

## Aba de administração

Acesso em **Administração**, no cabeçalho, para quem entrou como
administrador. As seções principais:

- **Acessos** — quem pode preencher cada painel, e até quando (ver
  [Controle de acesso](#controle-de-acesso)).
- **Validação ABB** — as solicitações de certificação enviadas, com os dados
  informados e a situação do checklist: aprovar atribui o número do
  certificado; devolver reabre para o montador com os apontamentos. Abaixo, o
  registro de todas as emissões.
- **Painéis e checklists** — cadastro dos painéis, de quem aprova e do
  conteúdo das etapas. Os checklists são gravados no servidor, e todo montador
  aprovado naquele painel recebe a mesma versão. Em cada etapa a
  administração escolhe a **resposta exigida do montador** (só conferir,
  conferir e fotografar, só foto, valor, texto, opções, PDF, grade) — a tela
  diz o que cada opção exige — e pode enviar uma **imagem de apoio**
  (opcional). A imagem é comprimida no aparelho, gravada no servidor
  (`apoio_midias`, mesma pasta e mesmo backup das fotos) e referenciada no
  checklist como `/api/apoio/<uid>`; o aparelho do montador a baixa junto com o
  checklist e a mostra dentro da etapa, também sem rede.
- **Administradores** — quem administra, e quem pediu para administrar.

### Quem é administrador

Não há senha de administração. Administrador é um **papel da conta**: a pessoa
entra com o próprio e-mail e senha, pelo link discreto **Entrar como
administrador** no fim da tela de login. Só essa sessão chega à administração —
quem tem o papel mas entrou como montador vê o aplicativo de montador.

```
criar conta de administrador ──→ pedido em Administração → Administradores
                                          ↓
                        outro administrador aprova ou recusa
                                          ↓
                       entrar como administrador ──→ /admin
```

- **Primeiro administrador:** `ADMIN_INICIAL` (hoje `ericg10456@gmail.com`).
  É semente: vale só enquanto não houver administrador nenhum. Se a conta já
  existe, é promovida na subida; se não, vira administradora ao ser criada —
  por isso, num banco novo, crie essa conta logo.
- **Novos administradores** criam a conta em *Criar conta de administrador*, ou
  pedem o papel com uma conta que já existe, pelo botão que aparece ao tentar
  entrar como administrador. A conta vale para montagem desde já; a
  administração só abre depois da aprovação.
- **Remover** tira o papel e derruba a sessão de administrador na hora.
  Ninguém remove a si mesmo, então sempre resta ao menos um.
- **Cada decisão tem nome:** liberações, prazos, retiradas e aprovações de
  administrador registram quem fez.
- **Freio de tentativas:** 5 senhas erradas para o mesmo e-mail, do mesmo
  endereço, bloqueiam novas tentativas por 15 minutos. Vale para todo login.
- **Sessão de administrador dura 12 horas**; a de montador, 30 dias.

Sem nenhum administrador capaz de entrar — senha esquecida, remoção por engano
—, o socorro é na máquina do servidor:

```bash
npm run admin -- listar
npm run admin -- promover pessoa@empresa.com
```

---

## Geração do PDF

Onde gerar:

- **Tela de preenchimento** (botão **Gerar PDF** no cabeçalho): o PDF do
  checklist aberto — de uma TAG do projeto ou de uma solicitação de
  certificação. Vale para todo checklist de todo painel.
- **Tela da solicitação**: **Gerar PDF do checklist**.
- **Tela do projeto**: um PDF por tipo de verificação, com todas as TAGs que
  têm aquele checklist.

O documento:

- Sempre disponível, independentemente de pendências.
- Capa em uma página: andamento (percentual, barra e contagens), identificação
  (dados do projeto, ou os campos da solicitação que o painel pede), resumo por
  seção (um checklist) ou por TAG e checklist (o projeto), pendências e legenda.
- Para cada TAG e checklist: abertura com revisão, andamento e dados do painel;
  as seções com a tabela `Etapa | Descrição | Aferido | Status | Data | Operador`;
  grade de medições formatada abaixo da etapa; registro fotográfico em cartões.
- Status sinalizado por selo colorido: **Verificado** (verde), **Falta foto**
  (âmbar — marcada sem a foto obrigatória) e **Não verificado** (vermelho).
- Resposta longa e observação saem inteiras, sob a descrição; nada é cortado.
- PDFs anexados pelo montador vão dentro do documento (painel de anexos do
  leitor de PDF).
- Escolha entre fotos incorporadas ao PDF ou PDF sem fotos acompanhado de um ZIP
  com as imagens nomeadas `TAG_ETAPA_N.jpg`.
- Nome do arquivo: `EMPRESA_PROJETO_TIPO-VERIFICACAO_AAAA-MM-DD.pdf`; o de um
  checklist só leva a TAG: `EMPRESA_PROJETO_TAG-ROTINA_AAAA-MM-DD.pdf`.

Nada no gerador conhece um checklist ou painel específico: seções, etapas,
tipos de resposta e campos vêm da definição. Um checklist montado depois na
administração sai no mesmo padrão.

O envio por e-mail é feito manualmente pelo montador.

---

## Limitação conhecida — sem sincronização

O servidor sincroniza **o acesso**, não as checagens. Cada aparelho mantém a sua
própria base de respostas e fotos: um preenchimento iniciado no celular **não
aparece** no notebook, mesmo com a mesma conta e o mesmo painel aprovado.

Mitigação da v1: **Exportar projeto** (na tela do projeto) grava um `.zip` com o
JSON dos dados e as fotos; **Importar projeto** (na tela de projetos) lê esse
arquivo e recria o projeto no outro aparelho, com o sufixo “(importado)” no
nome. A transferência é manual.

Solução definitiva: subir também as respostas, em versão futura. A infraestrutura
para isso já existe — servidor, contas e sessões — e a camada de persistência
continua atrás dos repositórios, de modo que a troca não afete as telas. O que
falta decidir é resolução de conflito: duas pessoas aprovadas no mesmo painel
podem responder a mesma etapa em aparelhos diferentes.

---

## Pendências de conteúdo

| Item | Situação |
|---|---|
| Descrição da etapa **S2.6** | Ilegível no OCR. Está no JSON com o texto marcado como `TRANSCREVER` e `pendenteTranscricao: true`; a etapa aparece com aviso na tela. |
| Imagens de referência das 38 etapas | Ainda não recortadas. Os caminhos já estão no JSON; a lista completa está em `public/media/sen-plus/LEIA-ME.md`. Enquanto o arquivo não existir, o modal de ajuda mostra um aviso com o caminho esperado, sem quebrar a tela. |
| Redação exata das etapas | Conferir contra o documento original. S1.1, S1.3, S2.2 e S2.6 estão marcadas com `pendenteTranscricao`. |
| E-mails dos responsáveis ABB | `taina.gioia@br.abb.com` e `carlos.e.silva@br.abb.com`, reconstruídos do PDF do Anexo 2 (o OCR do arquivo suprime pontos). Conferir antes de publicar; ficam em `public/paineis/index.json`. |
| Imagens de apoio dos ensaios de rotina | O checklist da NBR IEC 61439 ainda não tem `midiaApoio`. Os textos de orientação estão em `detalhes`; as imagens entram no JSON quando existirem. |

---

## Decisões registradas

Sem julgamento de conformidade no sistema (não existem estados “OK” e “Não OK”:
a etapa é respondida ou fica em branco); sem estado “não aplicável”; PDF sempre
gerável; ordem de preenchimento livre; operador e data informados uma vez e
replicados em todas as etapas; respostas e fotos exclusivamente no aparelho; sem
marca d'água nas fotos; sem trilha de auditoria além da data da última
alteração.

Revistas ao acrescentar o controle de acesso: **passou a haver autenticação**
(e-mail e senha) e **passou a haver um servidor**, que guarda contas, painéis e
decisões de acesso — e nada das checagens. O operador do PDF deixou de ser texto
digitado e passa a vir do nome da conta.

Da extensão de certificação: o comportamento do SEN Plus não mudou — os campos
obrigatórios e o ciclo de validação valem apenas para os painéis de
certificação; o certificado sai em PDF, no mesmo padrão de saída do dossiê; a
validação ABB mora na administração, atrás do papel de administrador; o backup
`.zip` cobre apenas o fluxo de projeto/TAG, já que a solicitação tem ciclo
próprio de envio e aprovação.
