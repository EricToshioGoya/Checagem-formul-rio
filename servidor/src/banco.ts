import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PAINEIS } from './paineis';

/**
 * Base central do servidor de acesso.
 *
 * Usa `node:sqlite`, embutido no Node 22.5+: nenhuma dependência nativa para
 * compilar, nenhum serviço externo para subir. Um arquivo só, que se copia
 * para fazer backup.
 *
 * Esta base guarda apenas quem pode preencher o quê. As respostas das
 * checagens continuam no aparelho do montador (IndexedDB) — o servidor não
 * as recebe e não as armazena.
 */

const ARQUIVO = process.env.BANCO ?? 'servidor/dados/acesso.db';

/** Caminho do arquivo do banco: o backup e as mídias se organizam ao lado dele. */
export const ARQUIVO_BANCO = ARQUIVO;

function abrir(): DatabaseSync {
  mkdirSync(dirname(ARQUIVO), { recursive: true });
  const banco = new DatabaseSync(ARQUIVO);
  banco.exec('PRAGMA journal_mode = WAL');
  banco.exec('PRAGMA foreign_keys = ON');
  return banco;
}

export const banco = abrir();

/**
 * Migração do formato anterior, em que qualquer usuário cadastrava painéis e
 * virava dono (`paineis.donoId`). Agora os painéis são fixos e o responsável
 * vem por e-mail, então aquelas linhas não têm equivalente: são descartadas,
 * junto com as solicitações que apontavam para elas.
 *
 * Contas, senhas e sessões não são tocadas.
 */
function migrarPaineisComDono(): void {
  const colunas = banco.prepare('PRAGMA table_info(paineis)').all() as Array<{
    name: string;
  }>;
  if (colunas.length === 0) return; // base nova
  if (!colunas.some((c) => c.name === 'donoId')) return; // já migrada

  const quantos = banco.prepare('SELECT COUNT(*) AS n FROM paineis').get() as { n: number };
  console.warn(
    `Migrando o esquema de painéis: ${quantos.n} painel(is) do formato antigo e ` +
      'as suas solicitações serão descartados. Contas e sessões são preservadas.',
  );
  banco.exec('PRAGMA foreign_keys = OFF');
  banco.exec('DROP TABLE IF EXISTS solicitacoes');
  banco.exec('DROP TABLE IF EXISTS paineis');
  banco.exec('PRAGMA foreign_keys = ON');
}

migrarPaineisComDono();

/**
 * Uma solicitação é também o registro do acesso: aprovada, ela libera o
 * painel até `expiraEm` — ou para sempre, com `expiraEm` nulo. Vencer não muda
 * a linha: "expirada" é calculado na leitura, comparando com o relógio, e por
 * isso o acesso cai na hora certa sem tarefa agendada nenhuma.
 *
 * `revogada` é o acesso retirado pela administração, distinto de `recusada`,
 * que é o pedido negado antes de valer.
 */
function ddlSolicitacoes(tabela: string): string {
  return `
  CREATE TABLE IF NOT EXISTS ${tabela} (
    id          INTEGER PRIMARY KEY,
    painelId    INTEGER NOT NULL REFERENCES paineis(id)  ON DELETE CASCADE,
    usuarioId   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    status      TEXT    NOT NULL
                CHECK (status IN ('pendente', 'aprovada', 'recusada', 'revogada')),
    mensagem    TEXT,
    criadoEm    INTEGER NOT NULL,
    decididoEm  INTEGER,
    -- Nulo numa linha decidida é da antiga administração por senha
    -- compartilhada, que não tinha conta de usuário.
    decididoPor INTEGER REFERENCES usuarios(id),
    expiraEm    INTEGER,
    -- Um pedido por pessoa e painel: pedir de novo atualiza o que existe,
    -- em vez de encher a caixa do dono com linhas repetidas.
    UNIQUE (painelId, usuarioId)
  );`;
}

/**
 * Acrescenta prazo e revogação às solicitações. O CHECK do status não se
 * altera no SQLite sem recriar a tabela, então ela é recriada e as linhas
 * copiadas — todas as aprovações existentes continuam valendo, sem prazo.
 */
function migrarSolicitacoesComPrazo(): void {
  const atual = banco
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'solicitacoes'")
    .get() as { sql: string } | undefined;
  if (!atual || atual.sql.includes('revogada')) return;

  banco.exec('PRAGMA foreign_keys = OFF');
  banco.exec('BEGIN');
  try {
    banco.exec('DROP TABLE IF EXISTS solicitacoes_nova');
    banco.exec(ddlSolicitacoes('solicitacoes_nova'));
    banco.exec(
      `INSERT INTO solicitacoes_nova
         (id, painelId, usuarioId, status, mensagem, criadoEm, decididoEm, decididoPor)
       SELECT id, painelId, usuarioId, status, mensagem, criadoEm, decididoEm, decididoPor
         FROM solicitacoes`,
    );
    banco.exec('DROP TABLE solicitacoes');
    banco.exec('ALTER TABLE solicitacoes_nova RENAME TO solicitacoes');
    banco.exec('COMMIT');
  } catch (erro) {
    banco.exec('ROLLBACK');
    throw erro;
  } finally {
    banco.exec('PRAGMA foreign_keys = ON');
  }
  console.warn('Solicitações migradas: acesso com prazo e revogação disponíveis.');
}

/**
 * Cópia no servidor do trabalho de cada montador: um projeto por linha,
 * identificado pelo `uid` que ele tem no aparelho — um painel pode ter vários
 * projetos da mesma conta. O documento é o JSON do projeto; o andamento sai
 * dele na gravação, para o painel de acompanhamento não precisar abrir
 * documento nenhum.
 */
function ddlSyncProjetos(nome: string): string {
  return `CREATE TABLE IF NOT EXISTS ${nome} (
    id          INTEGER PRIMARY KEY,
    usuarioId   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    painelId    INTEGER NOT NULL REFERENCES paineis(id)  ON DELETE CASCADE,
    projetoUid  TEXT    NOT NULL,
    versao      INTEGER NOT NULL,
    documento   TEXT    NOT NULL,
    enviadoEm   INTEGER NOT NULL,
    alteradoEm  INTEGER NOT NULL,
    total       INTEGER NOT NULL DEFAULT 0,
    respondidas INTEGER NOT NULL DEFAULT 0,
    empresa     TEXT,
    qtdTags     INTEGER NOT NULL DEFAULT 0,
    nomeProjeto TEXT,
    UNIQUE (usuarioId, projetoUid)
  );`;
}

/**
 * Registro das emissões: guarda uma cópia dos dados no momento da aprovação,
 * para alterar a solicitação depois não reescrever o certificado. Não cai em
 * cascata com a solicitação: excluir a conta do montador (LGPD) leva a
 * solicitação, mas o registro do certificado emitido fica.
 */
function ddlCertificados(nome: string): string {
  return `CREATE TABLE IF NOT EXISTS ${nome} (
    numero          TEXT    PRIMARY KEY,
    certificacaoId  INTEGER REFERENCES certificacoes(id) ON DELETE SET NULL,
    painelSlug      TEXT    NOT NULL,
    nomePainel      TEXT    NOT NULL,
    projeto         TEXT    NOT NULL,
    tagPainel       TEXT    NOT NULL,
    clienteFinal    TEXT    NOT NULL,
    montador        TEXT    NOT NULL,
    correnteNominal TEXT    NOT NULL,
    correnteCurtoCircuito TEXT NOT NULL,
    responsavel     TEXT    NOT NULL,
    emitidoEm       INTEGER NOT NULL,
    -- Retrato da solicitação aprovada (dados, respostas e fotos), em JSON.
    retrato         TEXT
  );`;
}

migrarSolicitacoesComPrazo();

banco.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id       INTEGER PRIMARY KEY,
    email    TEXT    NOT NULL UNIQUE,
    nome     TEXT    NOT NULL,
    senha    TEXT    NOT NULL,
    criadoEm INTEGER NOT NULL,
    -- Administrador é papel da conta, e não uma senha à parte: cada ação de
    -- administração fica com nome, e tirar alguém não exige trocar nada dos outros.
    papel    TEXT    NOT NULL DEFAULT 'montador' CHECK (papel IN ('montador', 'admin'))
  );

  -- Quem criou conta pedindo para ser administrador. Outro administrador
  -- aprova ou recusa; uma linha por pessoa, e pedir de novo reabre a mesma.
  -- 'removido' é o administrador que outro administrador tirou do papel.
  CREATE TABLE IF NOT EXISTS pedidos_admin (
    id          INTEGER PRIMARY KEY,
    usuarioId   INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
    status      TEXT    NOT NULL
                CHECK (status IN ('pendente', 'aprovado', 'recusado', 'removido')),
    criadoEm    INTEGER NOT NULL,
    decididoEm  INTEGER,
    decididoPor INTEGER REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS paineis (
    id        INTEGER PRIMARY KEY,
    slug      TEXT    NOT NULL UNIQUE,
    nome      TEXT    NOT NULL,
    descricao TEXT,
    ordem     INTEGER NOT NULL,
    criadoEm  INTEGER NOT NULL
  );

  -- Um painel tem vários responsáveis, e qualquer um deles aprova.
  -- O vínculo é por e-mail, não por id de usuário: o responsável pode ainda
  -- não ter criado a conta, e os pedidos o esperam até que crie.
  CREATE TABLE IF NOT EXISTS painel_responsaveis (
    painelId INTEGER NOT NULL REFERENCES paineis(id) ON DELETE CASCADE,
    email    TEXT    NOT NULL,
    PRIMARY KEY (painelId, email)
  );

  ${ddlSolicitacoes('solicitacoes')}

  -- 'admin' é a sessão aberta pelo "Entrar como administrador": só ela chega
  -- às rotas de administração, e vence antes da sessão de montador.
  CREATE TABLE IF NOT EXISTS sessoes (
    token     TEXT    PRIMARY KEY,
    usuarioId INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    criadoEm  INTEGER NOT NULL,
    expiraEm  INTEGER NOT NULL,
    perfil    TEXT    NOT NULL DEFAULT 'montador' CHECK (perfil IN ('montador', 'admin'))
  );

  -- O checklist pertence ao painel: excluir o painel leva junto os
  -- formulários dele. Só a definição é coluna própria; nome, tipo e contagem
  -- de etapas saem do próprio JSON na leitura, para não haver duas versões
  -- da mesma informação podendo divergir.
  CREATE TABLE IF NOT EXISTS formularios (
    id           TEXT    PRIMARY KEY,
    painelId     INTEGER NOT NULL REFERENCES paineis(id) ON DELETE CASCADE,
    ordem        INTEGER NOT NULL,
    ativo        INTEGER NOT NULL DEFAULT 1,
    definicao    TEXT    NOT NULL,
    atualizadoEm INTEGER NOT NULL
  );

  -- Tipos de checklist (montagem, rotina e os que a administração criar).
  -- O id fica gravado em cada checklist; o rótulo é o nome que aparece nos
  -- botões, nas telas e no PDF, e pode ser trocado sem mexer nos checklists.
  CREATE TABLE IF NOT EXISTS tipos_checklist (
    id       TEXT    PRIMARY KEY,
    rotulo   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    ordem    INTEGER NOT NULL,
    criadoEm INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_formularios_painel ON formularios (painelId, ordem);
  CREATE INDEX IF NOT EXISTS idx_resp_email          ON painel_responsaveis (email);
  CREATE INDEX IF NOT EXISTS idx_solicitacoes_painel ON solicitacoes (painelId, status);
  CREATE INDEX IF NOT EXISTS idx_solicitacoes_user   ON solicitacoes (usuarioId);
  CREATE INDEX IF NOT EXISTS idx_sessoes_usuario     ON sessoes (usuarioId);
  CREATE INDEX IF NOT EXISTS idx_pedidos_admin       ON pedidos_admin (status);

  -- Quem fez o quê na administração. O alvo e o detalhe são texto pronto para
  -- ler, e não só ids: o histórico continua legível depois que o painel ou a
  -- pessoa citada deixarem de existir.
  CREATE TABLE IF NOT EXISTS auditoria (
    id        INTEGER PRIMARY KEY,
    em        INTEGER NOT NULL,
    autorId   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    autorNome TEXT    NOT NULL,
    acao      TEXT    NOT NULL,
    alvoTipo  TEXT    NOT NULL,
    alvoId    TEXT,
    alvo      TEXT    NOT NULL,
    detalhe   TEXT
  );
  -- Solicitações de certificação. O montador trabalha no aparelho e envia a
  -- solicitação inteira (dados, respostas e a lista das fotos) ao pedir a
  -- validação; o estado e o número do certificado são decididos aqui.
  CREATE TABLE IF NOT EXISTS certificacoes (
    id           INTEGER PRIMARY KEY,
    uid          TEXT    NOT NULL,
    usuarioId    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    painelId     INTEGER NOT NULL REFERENCES paineis(id)  ON DELETE CASCADE,
    formId       TEXT    NOT NULL,
    estado       TEXT    NOT NULL CHECK (estado IN ('rascunho','enviada','devolvida','aprovada','emitida')),
    dados        TEXT    NOT NULL,
    preenchimento TEXT   NOT NULL,
    midias       TEXT    NOT NULL,
    apontamentos TEXT,
    historico    TEXT    NOT NULL,
    numero       TEXT    UNIQUE,
    aprovadoEm   INTEGER,
    aprovadoPor  TEXT,
    versao       INTEGER NOT NULL,
    criadoEm     INTEGER NOT NULL,
    atualizadoEm INTEGER NOT NULL,
    UNIQUE (usuarioId, uid)
  );
  CREATE INDEX IF NOT EXISTS idx_certificacoes_estado ON certificacoes (estado, atualizadoEm);

  ${ddlCertificados('certificados')}

  -- Contadores sequenciais. O do certificado é lido e incrementado na mesma
  -- transação que grava o certificado: dois aprovadores nunca pegam o mesmo número.
  CREATE TABLE IF NOT EXISTS contadores (
    id      TEXT    PRIMARY KEY,
    proximo INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_auditoria_em   ON auditoria (em);
  CREATE INDEX IF NOT EXISTS idx_auditoria_alvo ON auditoria (alvoTipo, alvoId);

  -- Fila de avisos por e-mail e webhook (Teams). O aviso é gravado antes de
  -- sair: um servidor de e-mail fora do ar atrasa o aviso, mas não o perde.
  CREATE TABLE IF NOT EXISTS avisos (
    id         INTEGER PRIMARY KEY,
    canal      TEXT    NOT NULL CHECK (canal IN ('email', 'webhook')),
    destino    TEXT    NOT NULL,
    assunto    TEXT    NOT NULL,
    texto      TEXT    NOT NULL,
    criadoEm   INTEGER NOT NULL,
    enviadoEm  INTEGER,
    tentativas INTEGER NOT NULL DEFAULT 0,
    proximaEm  INTEGER NOT NULL,
    erro       TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_avisos_fila ON avisos (enviadoEm, proximaEm);

  ${ddlSyncProjetos('sync_projetos')}

  -- Fotos e anexos sincronizados. O arquivo fica em disco, com o \`uid\` como
  -- nome; aqui só o registro de quem é.
  CREATE TABLE IF NOT EXISTS sync_midias (
    uid        TEXT    PRIMARY KEY,
    usuarioId  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    painelId   INTEGER NOT NULL REFERENCES paineis(id)  ON DELETE CASCADE,
    mime       TEXT    NOT NULL,
    tamanho    INTEGER NOT NULL,
    recebidoEm INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sync_midias_dono ON sync_midias (usuarioId, painelId);

  -- Imagens de apoio das etapas, enviadas pela administração ao montar o
  -- checklist. O arquivo fica na mesma pasta das fotos (e entra no mesmo
  -- espelho de backup); aqui o registro que impede a faxina de apagá-lo.
  CREATE TABLE IF NOT EXISTS apoio_midias (
    uid       TEXT    PRIMARY KEY,
    mime      TEXT    NOT NULL,
    tamanho   INTEGER NOT NULL,
    criadoEm  INTEGER NOT NULL,
    criadoPor INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
  );

  -- Arquivo dos PDFs de checklist emitidos pelos aparelhos: a documentação
  -- que valida a garantia ABB em caso de falha ou quebra do material. O
  -- arquivo fica na pasta das mídias (e no mesmo espelho de backup), com o
  -- \`uid\` como nome; nada aqui é alterado nem excluído depois de gravado.
  -- Excluir a conta ou o painel não leva o PDF: o vínculo vira nulo e os
  -- nomes ficam na própria linha.
  CREATE TABLE IF NOT EXISTS pdfs_emitidos (
    uid         TEXT    PRIMARY KEY,
    usuarioId   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    painelId    INTEGER REFERENCES paineis(id)  ON DELETE SET NULL,
    painelNome  TEXT,
    empresa     TEXT    NOT NULL,
    nomeProjeto TEXT    NOT NULL,
    titulo      TEXT    NOT NULL,
    nomeArquivo TEXT    NOT NULL,
    -- Instante de emissão impresso no PDF, pelo relógio do aparelho.
    emitidoEm   INTEGER NOT NULL,
    recebidoEm  INTEGER NOT NULL,
    tamanho     INTEGER NOT NULL,
    sha256      TEXT    NOT NULL,
    -- Empresa e projeto sem acento e em minúsculas, para a busca.
    busca       TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pdfs_emitidos_em ON pdfs_emitidos (emitidoEm);
`);

/**
 * Acrescenta a coluna se a tabela ainda não a tem — bancos de antes dos perfis.
 * Devolve `true` quando a coluna acabou de nascer.
 */
function garantirColuna(tabela: string, coluna: string, definicao: string): boolean {
  const colunas = banco.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>;
  if (colunas.some((c) => c.name === coluna)) return false;
  banco.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  console.warn(`Coluna ${tabela}.${coluna} acrescentada.`);
  return true;
}

garantirColuna(
  'usuarios',
  'papel',
  "TEXT NOT NULL DEFAULT 'montador' CHECK (papel IN ('montador', 'admin'))",
);
garantirColuna(
  'sessoes',
  'perfil',
  "TEXT NOT NULL DEFAULT 'montador' CHECK (perfil IN ('montador', 'admin'))",
);
// Conta desativada pela administração: não entra, mas os dados ficam.
garantirColuna('usuarios', 'ativo', 'INTEGER NOT NULL DEFAULT 1');
garantirColuna('usuarios', 'desativadoEm', 'INTEGER');
garantirColuna('usuarios', 'ultimoAcessoEm', 'INTEGER');
// Resumo do projeto sincronizado, para o acompanhamento não abrir o documento.
garantirColuna('sync_projetos', 'empresa', 'TEXT');
garantirColuna('sync_projetos', 'qtdTags', 'INTEGER NOT NULL DEFAULT 0');
// Foto ou anexo pertence a um projeto, não mais ao par (conta, painel).
garantirColuna('sync_midias', 'projetoUid', 'TEXT');

/**
 * Um painel passa a ter vários projetos da mesma conta. A chave deixa de ser
 * (conta, painel) e passa a ser o `uid` do projeto; a restrição UNIQUE não se
 * altera no SQLite sem recriar a tabela. Cada linha existente recebe o `uid`
 * legado do seu painel — o mesmo que o aparelho deriva para o projeto que já
 * tinha (ver `compartilhado/projeto.ts`) —, e as fotos vão junto.
 */
function migrarSyncPorProjeto(): void {
  const colunas = banco.prepare('PRAGMA table_info(sync_projetos)').all() as Array<{ name: string }>;
  if (colunas.some((c) => c.name === 'projetoUid')) return;

  const uidLegado = "printf('00000000-0000-4000-8000-%012d', painelId)";
  banco.exec('PRAGMA foreign_keys = OFF');
  banco.exec('BEGIN');
  try {
    banco.exec('DROP TABLE IF EXISTS sync_projetos_novo');
    banco.exec(ddlSyncProjetos('sync_projetos_novo'));
    banco.exec(
      `INSERT INTO sync_projetos_novo
         (id, usuarioId, painelId, projetoUid, versao, documento, enviadoEm, alteradoEm,
          total, respondidas, empresa, qtdTags, nomeProjeto)
       SELECT id, usuarioId, painelId, ${uidLegado}, versao, documento, enviadoEm, alteradoEm,
              total, respondidas, empresa, qtdTags, json_extract(documento, '$.projeto.nomeProjeto')
         FROM sync_projetos`,
    );
    banco.exec('DROP TABLE sync_projetos');
    banco.exec('ALTER TABLE sync_projetos_novo RENAME TO sync_projetos');
    banco.exec(`UPDATE sync_midias SET projetoUid = ${uidLegado} WHERE projetoUid IS NULL`);
    banco.exec('COMMIT');
  } catch (erro) {
    banco.exec('ROLLBACK');
    throw erro;
  } finally {
    banco.exec('PRAGMA foreign_keys = ON');
  }
  console.warn('Sincronização migrada: cada painel pode ter vários projetos por conta.');
}

migrarSyncPorProjeto();
banco.exec('CREATE INDEX IF NOT EXISTS idx_sync_projetos_painel ON sync_projetos (usuarioId, painelId)');
banco.exec('CREATE INDEX IF NOT EXISTS idx_sync_midias_projeto ON sync_midias (usuarioId, projetoUid)');

/**
 * Bancos anteriores criaram `certificados` em cascata com a solicitação:
 * excluir a conta do montador apagava o registro do certificado emitido. A
 * tabela é recriada sem a cascata, com as mesmas linhas.
 */
function migrarCertificadosSemCascata(): void {
  const atual = banco
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'certificados'")
    .get() as { sql: string } | undefined;
  if (!atual || !/ON DELETE CASCADE/i.test(atual.sql)) return;

  banco.exec('PRAGMA foreign_keys = OFF');
  banco.exec('BEGIN');
  try {
    banco.exec('DROP TABLE IF EXISTS certificados_novo');
    banco.exec(ddlCertificados('certificados_novo'));
    banco.exec(
      `INSERT INTO certificados_novo
         (numero, certificacaoId, painelSlug, nomePainel, projeto, tagPainel, clienteFinal, montador,
          correnteNominal, correnteCurtoCircuito, responsavel, emitidoEm)
       SELECT numero, certificacaoId, painelSlug, nomePainel, projeto, tagPainel, clienteFinal, montador,
              correnteNominal, correnteCurtoCircuito, responsavel, emitidoEm
         FROM certificados`,
    );
    banco.exec('DROP TABLE certificados');
    banco.exec('ALTER TABLE certificados_novo RENAME TO certificados');
    banco.exec('COMMIT');
  } catch (erro) {
    banco.exec('ROLLBACK');
    throw erro;
  } finally {
    banco.exec('PRAGMA foreign_keys = ON');
  }
  console.warn('Registro de certificados migrado: não é mais apagado junto com a conta do montador.');
}

migrarCertificadosSemCascata();

// ------------------------------------------------- guarda dos documentos

/**
 * O PDF preenchido e o certificado são documentos de garantia: depois de
 * confirmados, nada no sistema os apaga ou troca. As tabelas abaixo guardam o
 * fluxo de aprovação e as fotos citadas nos documentos; os gatilhos fazem a
 * regra valer no próprio banco — um defeito no código do servidor também não
 * consegue apagar um documento.
 *
 * Contas e painéis excluídos não levam nada daqui: os vínculos viram nulos e
 * os nomes ficam gravados na própria linha.
 */
banco.exec(`
  -- Envio do PDF de um projeto, de um tipo de verificação, para aprovação da
  -- administração. Guarda o retrato das respostas e das fotos daquele tipo no
  -- momento em que o PDF foi gerado: é o que o administrador analisa.
  CREATE TABLE IF NOT EXISTS verificacoes (
    id              INTEGER PRIMARY KEY,
    uid             TEXT    NOT NULL UNIQUE,
    usuarioId       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    montadorNome    TEXT    NOT NULL,
    montadorEmail   TEXT    NOT NULL,
    painelId        INTEGER REFERENCES paineis(id)  ON DELETE SET NULL,
    painelNome      TEXT    NOT NULL,
    projetoUid      TEXT    NOT NULL,
    -- Conta e projeto: o uid legado de um projeto se repete entre contas.
    projetoChave    TEXT    NOT NULL,
    empresa         TEXT    NOT NULL,
    nomeProjeto     TEXT    NOT NULL,
    tipo            TEXT    NOT NULL,
    tipoRotulo      TEXT    NOT NULL,
    -- Atribuída quando o envio fica completo (todas as fotos recebidas).
    versao          INTEGER,
    estado          TEXT    NOT NULL
                    CHECK (estado IN ('recebendo', 'aguardando', 'aprovada', 'reprovada', 'substituida')),
    pdfUid          TEXT    NOT NULL REFERENCES pdfs_emitidos(uid),
    documento       TEXT    NOT NULL,
    tags            TEXT    NOT NULL,
    geradoEm        INTEGER NOT NULL,
    criadoEm        INTEGER NOT NULL,
    enviadoEm       INTEGER,
    decididoEm      INTEGER,
    decididoPor     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    decididoPorNome TEXT,
    comentario      TEXT    NOT NULL DEFAULT '',
    -- Etapas marcadas como não conformes: [{ tagUid, tagNome, formId, etapaId, ... motivo }].
    itens           TEXT    NOT NULL DEFAULT '[]',
    busca           TEXT    NOT NULL,
    UNIQUE (projetoChave, tipo, versao)
  );
  CREATE INDEX IF NOT EXISTS idx_verificacoes_estado  ON verificacoes (estado, enviadoEm);
  CREATE INDEX IF NOT EXISTS idx_verificacoes_projeto ON verificacoes (projetoChave, tipo);
  CREATE INDEX IF NOT EXISTS idx_verificacoes_usuario ON verificacoes (usuarioId);
  CREATE INDEX IF NOT EXISTS idx_verificacoes_pdf     ON verificacoes (pdfUid);

  -- Fotos citadas num documento (envio de verificação ou certificação
  -- aprovada). Ficam protegidas da lixeira e da faxina mesmo que o montador as
  -- apague depois no aparelho; o SHA-256 é gravado quando o arquivo chega.
  CREATE TABLE IF NOT EXISTS midias_protegidas (
    origem   TEXT    NOT NULL CHECK (origem IN ('verificacao', 'certificacao')),
    origemId INTEGER NOT NULL,
    uid      TEXT    NOT NULL,
    mime     TEXT    NOT NULL,
    tagUid   TEXT,
    formId   TEXT,
    etapaId  TEXT    NOT NULL,
    ordem    INTEGER NOT NULL DEFAULT 0,
    situacao TEXT    NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'recebida', 'ausente')),
    sha256   TEXT,
    tamanho  INTEGER,
    PRIMARY KEY (origem, origemId, uid)
  );
  CREATE INDEX IF NOT EXISTS idx_midias_protegidas_uid ON midias_protegidas (uid);

  -- Certificados anexados pela administração ao aprovar uma certificação.
  CREATE TABLE IF NOT EXISTS certificados_anexos (
    uid             TEXT    PRIMARY KEY,
    certificacaoId  INTEGER REFERENCES certificacoes(id) ON DELETE SET NULL,
    certificacaoUid TEXT    NOT NULL,
    numero          TEXT    NOT NULL,
    painelId        INTEGER REFERENCES paineis(id)  ON DELETE SET NULL,
    painelNome      TEXT    NOT NULL,
    projeto         TEXT    NOT NULL,
    tagPainel       TEXT    NOT NULL,
    clienteFinal    TEXT    NOT NULL,
    empresa         TEXT    NOT NULL,
    montadorId      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    montadorNome    TEXT    NOT NULL,
    nomeArquivo     TEXT    NOT NULL,
    mime            TEXT    NOT NULL,
    tamanho         INTEGER NOT NULL,
    sha256          TEXT    NOT NULL,
    anexadoPor      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    anexadoPorNome  TEXT    NOT NULL,
    anexadoEm       INTEGER NOT NULL,
    busca           TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_certificados_anexos_cert ON certificados_anexos (certificacaoId);
  CREATE INDEX IF NOT EXISTS idx_certificados_anexos_em   ON certificados_anexos (anexadoEm);

  -- Resultado da última conferência de cada documento guardado.
  CREATE TABLE IF NOT EXISTS integridade_arquivos (
    uid          TEXT    PRIMARY KEY,
    situacao     TEXT    NOT NULL CHECK (situacao IN ('ok', 'reparado', 'corrompido', 'ausente')),
    verificadoEm INTEGER NOT NULL,
    detalhe      TEXT
  );

  -- Rodadas de backup nos destinos e de verificação de integridade.
  CREATE TABLE IF NOT EXISTS registros_armazenamento (
    id          INTEGER PRIMARY KEY,
    tipo        TEXT    NOT NULL CHECK (tipo IN ('backup', 'verificacao')),
    destino     TEXT    NOT NULL DEFAULT '',
    iniciadoEm  INTEGER NOT NULL,
    concluidoEm INTEGER NOT NULL,
    ok          INTEGER NOT NULL CHECK (ok IN (0, 1)),
    resumo      TEXT    NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_registros_armazenamento ON registros_armazenamento (tipo, destino, concluidoEm);

  CREATE TRIGGER IF NOT EXISTS pdfs_emitidos_sem_exclusao BEFORE DELETE ON pdfs_emitidos
  BEGIN SELECT RAISE(ABORT, 'Um PDF arquivado não pode ser apagado.'); END;
  CREATE TRIGGER IF NOT EXISTS pdfs_emitidos_imutavel
  BEFORE UPDATE OF uid, empresa, nomeProjeto, titulo, nomeArquivo, emitidoEm, recebidoEm, tamanho, sha256
  ON pdfs_emitidos
  BEGIN SELECT RAISE(ABORT, 'Um PDF arquivado não pode ser alterado.'); END;

  CREATE TRIGGER IF NOT EXISTS certificados_sem_exclusao BEFORE DELETE ON certificados
  BEGIN SELECT RAISE(ABORT, 'O registro de um certificado não pode ser apagado.'); END;
  -- O retrato pode ser preenchido uma vez (certificados aprovados antes de ele
  -- existir); depois disso, nada muda. A versão antiga do gatilho o travava.
  DROP TRIGGER IF EXISTS certificados_imutavel;
  CREATE TRIGGER certificados_imutavel
  BEFORE UPDATE OF numero, painelSlug, nomePainel, projeto, tagPainel, clienteFinal, montador, emitidoEm
  ON certificados
  BEGIN SELECT RAISE(ABORT, 'O registro de um certificado não pode ser alterado.'); END;
  CREATE TRIGGER IF NOT EXISTS certificados_retrato_definitivo
  BEFORE UPDATE OF retrato ON certificados
  WHEN OLD.retrato IS NOT NULL
  BEGIN SELECT RAISE(ABORT, 'O registro de um certificado não pode ser alterado.'); END;

  CREATE TRIGGER IF NOT EXISTS certificados_anexos_sem_exclusao BEFORE DELETE ON certificados_anexos
  BEGIN SELECT RAISE(ABORT, 'Um certificado anexado não pode ser apagado.'); END;
  CREATE TRIGGER IF NOT EXISTS certificados_anexos_imutavel
  BEFORE UPDATE OF uid, certificacaoUid, numero, nomeArquivo, mime, tamanho, sha256, anexadoEm
  ON certificados_anexos
  BEGIN SELECT RAISE(ABORT, 'Um certificado anexado não pode ser alterado.'); END;

  CREATE TRIGGER IF NOT EXISTS verificacoes_sem_exclusao BEFORE DELETE ON verificacoes
  BEGIN SELECT RAISE(ABORT, 'Um envio para aprovação não pode ser apagado.'); END;
  CREATE TRIGGER IF NOT EXISTS verificacoes_identidade
  BEFORE UPDATE OF uid, projetoUid, projetoChave, tipo, pdfUid, documento, geradoEm, criadoEm
  ON verificacoes
  BEGIN SELECT RAISE(ABORT, 'A identificação de um envio não pode ser alterada.'); END;
  CREATE TRIGGER IF NOT EXISTS verificacoes_decisao_definitiva
  BEFORE UPDATE OF estado, versao, enviadoEm, decididoEm, decididoPorNome, comentario, itens
  ON verificacoes
  WHEN OLD.estado NOT IN ('recebendo', 'aguardando')
  BEGIN SELECT RAISE(ABORT, 'A decisão sobre um envio é definitiva.'); END;

  CREATE TRIGGER IF NOT EXISTS midias_protegidas_sem_exclusao BEFORE DELETE ON midias_protegidas
  BEGIN SELECT RAISE(ABORT, 'Uma foto citada num documento não pode ser apagada.'); END;
  CREATE TRIGGER IF NOT EXISTS midias_protegidas_definitiva BEFORE UPDATE ON midias_protegidas
  WHEN OLD.situacao <> 'pendente'
  BEGIN SELECT RAISE(ABORT, 'Uma foto citada num documento não pode ser alterada.'); END;
`);

// Itens marcados como não conformes na devolução de uma certificação.
garantirColuna('certificacoes', 'itens', "TEXT NOT NULL DEFAULT '[]'");

export type Papel = 'montador' | 'admin';

export interface Usuario {
  id: number;
  email: string;
  nome: string;
  senha: string;
  criadoEm: number;
  papel: Papel;
  /** 1 ativa, 0 desativada pela administração. */
  ativo: number;
  desativadoEm: number | null;
  ultimoAcessoEm: number | null;
}

export interface Painel {
  id: number;
  slug: string;
  nome: string;
  descricao: string | null;
  ordem: number;
  criadoEm: number;
}

export type StatusSolicitacao = 'pendente' | 'aprovada' | 'recusada' | 'revogada';

/** O status gravado mais o que só existe na leitura: a aprovação vencida. */
export type StatusAcesso = StatusSolicitacao | 'expirada';

export interface Solicitacao {
  id: number;
  painelId: number;
  usuarioId: number;
  status: StatusSolicitacao;
  mensagem: string | null;
  criadoEm: number;
  decididoEm: number | null;
  decididoPor: number | null;
  /** Fim do acesso aprovado; nulo é acesso sem prazo. */
  expiraEm: number | null;
}

/** Situação real do acesso agora: a aprovação com prazo passado vale como expirada. */
export function statusEfetivo(
  status: StatusSolicitacao,
  expiraEm: number | null,
  agora = Date.now(),
): StatusAcesso {
  return status === 'aprovada' && expiraEm !== null && expiraEm <= agora ? 'expirada' : status;
}

/**
 * Move o responsável único (coluna `paineis.responsavelEmail`) para a tabela
 * de vários responsáveis. Roda uma vez; depois a coluna não existe mais.
 */
function migrarResponsavelUnico(): void {
  const colunas = banco.prepare('PRAGMA table_info(paineis)').all() as Array<{
    name: string;
  }>;
  if (!colunas.some((c) => c.name === 'responsavelEmail')) return;

  banco.exec(
    `INSERT OR IGNORE INTO painel_responsaveis (painelId, email)
     SELECT id, responsavelEmail FROM paineis WHERE responsavelEmail IS NOT NULL`,
  );
  banco.exec('DROP INDEX IF EXISTS idx_paineis_resp');
  banco.exec('ALTER TABLE paineis DROP COLUMN responsavelEmail');
  console.warn('Responsáveis migrados para painel_responsaveis.');
}

migrarResponsavelUnico();

// Modelo de certificado e signatário moram no painel: antes vinham de um
// arquivo de publicação, e renomear ou cadastrar um painel não os alcançava.
//
// `fluxo` é legado: o painel era ou de verificação ou de certificação. Agora
// quem emite certificado é o checklist (`emiteCertificado` na definição), e a
// coluna só marca, até a próxima subida, os painéis cujos checklists precisam
// receber a marca — ver `migrarFluxoParaChecklists`.
const fluxoNovo = garantirColuna(
  'paineis',
  'fluxo',
  "TEXT NOT NULL DEFAULT 'verificacao' CHECK (fluxo IN ('verificacao', 'certificacao'))",
);
garantirColuna('paineis', 'certificado', 'TEXT');
garantirColuna('paineis', 'signatario', 'TEXT');

// Os três modelos de certificado eram idênticos fora do título: viraram um só.
banco.exec("UPDATE paineis SET certificado = '61439' WHERE certificado IN ('spee', 'spep', 'safr')");

/**
 * Bancos criados antes dessas colunas: os painéis iniciais conhecidos recebem
 * o fluxo, o modelo e o signatário que o arquivo de publicação lhes dava. Só
 * na subida que cria a coluna: depois disso, tirar o certificado de um painel
 * é decisão da administração e não pode voltar sozinho no reinício.
 */
if (fluxoNovo) (function completarPaineisIniciais(): void {
  const completar = banco.prepare(
    `UPDATE paineis SET fluxo = ?, certificado = ?, signatario = ?
      WHERE slug = ? AND fluxo = 'verificacao' AND certificado IS NULL`,
  );
  for (const p of PAINEIS) {
    if (p.fluxo !== 'certificacao') continue;
    completar.run(p.fluxo, p.certificado ?? null, p.signatario ? JSON.stringify(p.signatario) : null, p.slug);
  }
})();

/**
 * O certificado deixou de ser do painel e passou a ser do checklist: um
 * painel pode ter verificações que só geram o dossiê e outras que terminam
 * em certificado. Os checklists dos painéis que eram "de certificação" recebem
 * `emiteCertificado`, e o painel volta ao valor neutro da coluna legada.
 *
 * Roda a cada subida, depois das sementes, e só encontra trabalho uma vez por
 * painel: a primeira subida desta versão e a que semeia uma base nova.
 */
export function migrarFluxoParaChecklists(): void {
  const paineis = banco
    .prepare("SELECT id, nome FROM paineis WHERE fluxo = 'certificacao'")
    .all() as Array<{ id: number; nome: string }>;
  if (paineis.length === 0) return;
  emTransacao(() => {
    for (const p of paineis) {
      banco
        .prepare(
          `UPDATE formularios SET definicao = json_set(definicao, '$.emiteCertificado', json('true'))
            WHERE painelId = ?`,
        )
        .run(p.id);
      banco.prepare("UPDATE paineis SET fluxo = 'verificacao' WHERE id = ?").run(p.id);
    }
  });
  console.warn(
    `Certificado passou a ser do checklist: ${paineis.map((p) => p.nome).join(', ')} migrado(s).`,
  );
}

/**
 * Cria os painéis iniciais **apenas na primeira subida**, quando a tabela está
 * vazia. Dali em diante quem manda é a aba de administração: ressemear a cada
 * reinício desfaria o painel que o administrador acabou de cadastrar e
 * devolveria responsáveis que ele removeu.
 */
export function semearPaineis(): void {
  const { n } = banco.prepare('SELECT COUNT(*) AS n FROM paineis').get() as { n: number };
  if (n > 0) return;

  const agora = Date.now();
  const inserirPainel = banco.prepare(
    `INSERT INTO paineis (slug, nome, descricao, ordem, criadoEm, fluxo, certificado, signatario)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const inserirResp = banco.prepare(
    'INSERT OR IGNORE INTO painel_responsaveis (painelId, email) VALUES (?, ?)',
  );
  for (const [i, p] of PAINEIS.entries()) {
    const info = inserirPainel.run(
      p.slug,
      p.nome,
      p.descricao,
      i,
      agora,
      p.fluxo,
      p.certificado ?? null,
      p.signatario ? JSON.stringify(p.signatario) : null,
    );
    inserirResp.run(Number(info.lastInsertRowid), p.responsavelEmail.toLowerCase());
  }
  console.log(`${PAINEIS.length} painéis iniciais cadastrados.`);
}

/**
 * Roda `corpo` dentro de uma transação. `node:sqlite` não traz o auxiliar
 * `.transaction()` do better-sqlite3, então o BEGIN/COMMIT é explícito —
 * qualquer erro desfaz tudo, e um painel nunca fica gravado sem responsável.
 */
let profundidade = 0;

export function emTransacao<T>(corpo: () => T): T {
  // Chamada dentro de outra transação (uma função que se protege sozinha,
  // usada por quem já abriu a sua): entra na que já está aberta.
  if (profundidade > 0) return corpo();
  banco.exec('BEGIN');
  profundidade++;
  try {
    const resultado = corpo();
    banco.exec('COMMIT');
    return resultado;
  } catch (erro) {
    banco.exec('ROLLBACK');
    throw erro;
  } finally {
    profundidade--;
  }
}

/** Remove as sessões vencidas. Chamado na subida e a cada hora. */
export function limparSessoesVencidas(): number {
  const r = banco.prepare('DELETE FROM sessoes WHERE expiraEm < ?').run(Date.now());
  return Number(r.changes);
}
