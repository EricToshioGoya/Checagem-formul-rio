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

  -- Cópia no servidor do trabalho de cada montador em cada painel: o mesmo
  -- par (conta, painel) que identifica o projeto no aparelho. O documento é o
  -- JSON do projeto; o andamento sai dele na gravação, para o painel de
  -- acompanhamento não precisar abrir documento nenhum.
  CREATE TABLE IF NOT EXISTS sync_projetos (
    id          INTEGER PRIMARY KEY,
    usuarioId   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    painelId    INTEGER NOT NULL REFERENCES paineis(id)  ON DELETE CASCADE,
    versao      INTEGER NOT NULL,
    documento   TEXT    NOT NULL,
    enviadoEm   INTEGER NOT NULL,
    alteradoEm  INTEGER NOT NULL,
    total       INTEGER NOT NULL DEFAULT 0,
    respondidas INTEGER NOT NULL DEFAULT 0,
    UNIQUE (usuarioId, painelId)
  );

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
`);

/** Acrescenta a coluna se a tabela ainda não a tem — bancos de antes dos perfis. */
function garantirColuna(tabela: string, coluna: string, definicao: string): void {
  const colunas = banco.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>;
  if (colunas.some((c) => c.name === coluna)) return;
  banco.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  console.warn(`Coluna ${tabela}.${coluna} acrescentada.`);
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
    'INSERT INTO paineis (slug, nome, descricao, ordem, criadoEm) VALUES (?, ?, ?, ?, ?)',
  );
  const inserirResp = banco.prepare(
    'INSERT OR IGNORE INTO painel_responsaveis (painelId, email) VALUES (?, ?)',
  );
  for (const [i, p] of PAINEIS.entries()) {
    const info = inserirPainel.run(p.slug, p.nome, p.descricao, i, agora);
    inserirResp.run(Number(info.lastInsertRowid), p.responsavelEmail.toLowerCase());
  }
  console.log(`${PAINEIS.length} painéis iniciais cadastrados.`);
}

/**
 * Roda `corpo` dentro de uma transação. `node:sqlite` não traz o auxiliar
 * `.transaction()` do better-sqlite3, então o BEGIN/COMMIT é explícito —
 * qualquer erro desfaz tudo, e um painel nunca fica gravado sem responsável.
 */
export function emTransacao<T>(corpo: () => T): T {
  banco.exec('BEGIN');
  try {
    const resultado = corpo();
    banco.exec('COMMIT');
    return resultado;
  } catch (erro) {
    banco.exec('ROLLBACK');
    throw erro;
  }
}

/** Remove as sessões vencidas. Chamado na subida e a cada hora. */
export function limparSessoesVencidas(): number {
  const r = banco.prepare('DELETE FROM sessoes WHERE expiraEm < ?').run(Date.now());
  return Number(r.changes);
}
