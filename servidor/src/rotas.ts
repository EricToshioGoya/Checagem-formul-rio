import type { z } from 'zod';
import { plural } from '../../compartilhado/plural';
import {
  banco,
  emTransacao,
  statusEfetivo,
  type Painel,
  type Solicitacao,
  type StatusAcesso,
  type StatusSolicitacao,
  type Usuario,
} from './banco';
import {
  abrirSessao,
  conferirSenhaDaConta,
  criarHash,
  fecharSessao,
  fecharSessoesAdmin,
  type Perfil,
} from './auth';
import { deveNascerAdmin, quantosAdmins } from './admin';
import { registrar, ultimasAlteracoes } from './auditoria';
import { avisar } from './avisos';
import { chaveTentativa, esperaRestante, limparFalhas, registrarFalha } from './limite';
import { moverParaLixeira, removerRegistrosDeMidias } from './midias';
import { lerPagina, padraoBusca } from './paginacao';
import {
  cadastrarSchema,
  decisaoSchema,
  entrarSchema,
  formularioNovoSchema,
  formularioSchema,
  liberarAcessoSchema,
  painelSchema,
  pedidoAdminSchema,
  prazoAcessoSchema,
  primeiroErro,
  solicitarSchema,
  HORAS_MAXIMAS,
  type validadeSchema,
} from './esquemas';
import {
  criarParaPainel,
  definirAtivo,
  excluir as excluirFormulario,
  existe as formularioExiste,
  listarEntradasPorPainelId,
  obterDefinicao,
  salvarDefinicao,
} from './formularios';

/** Erro com código HTTP; o servidor traduz em resposta JSON. */
export class ErroHttp extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    /** Motivo legível por máquina, para a tela reagir sem ler o texto. */
    readonly codigo?: string,
  ) {
    super(mensagem);
  }
}

export interface Contexto {
  usuario: Usuario | null;
  token: string | null;
  /** Como a sessão foi aberta; nulo sem sessão. */
  perfil: Perfil | null;
  /** Endereço de origem, para o freio de tentativas de senha. */
  ip: string;
  corpo: unknown;
  /** Corpo em bytes, nas rotas que recebem arquivo (fotos sincronizadas). */
  corpoBruto?: Buffer;
  /** `Content-Type` da requisição, nas rotas que recebem arquivo. */
  tipoConteudo?: string;
  params: Record<string, string>;
  /** Parâmetros depois do `?`: página, busca, filtros. */
  consulta: URLSearchParams;
}

/** Resposta que é um arquivo em disco, e não JSON: o servidor o transmite. */
export class RespostaArquivo {
  constructor(
    readonly caminho: string,
    readonly mime: string,
  ) {}
}

/** Nunca devolve o hash da senha para o cliente. */
function publico(u: Usuario) {
  return { id: u.id, email: u.email, nome: u.nome, papel: u.papel };
}

export function exigirSessao(ctx: Contexto): Usuario {
  if (!ctx.usuario) throw new ErroHttp(401, 'Faça login para continuar.');
  return ctx.usuario;
}

/**
 * Administração exige as duas coisas a cada pedido: a conta tem o papel de
 * administrador **e** a sessão foi aberta pelo "Entrar como administrador".
 * Conferir o papel aqui, e não só no login, faz a remoção valer na hora.
 */
export function exigirAdmin(ctx: Contexto): Usuario {
  const eu = exigirSessao(ctx);
  if (eu.papel !== 'admin' || ctx.perfil !== 'admin') {
    throw new ErroHttp(403, 'Esta área é só para administradores.', 'nao-admin');
  }
  return eu;
}

/**
 * Confere e-mail e senha com o freio de tentativas. Mesma mensagem para
 * e-mail inexistente e senha errada: responder "não existe conta" entrega a
 * lista de quem trabalha no cliente.
 */
function autenticar(ctx: Contexto, email: string, senha: string): Usuario {
  const chave = chaveTentativa(email, ctx.ip);
  const espera = esperaRestante(chave);
  if (espera > 0) {
    const minutos = Math.ceil(espera / 60_000);
    throw new ErroHttp(
      429,
      `Muitas tentativas com senha errada. Tente de novo em ${minutos} min.`,
      'bloqueado',
    );
  }

  const usuario = banco.prepare('SELECT * FROM usuarios WHERE email = ?').get(email) as
    | Usuario
    | undefined;
  if (!conferirSenhaDaConta(senha, usuario?.senha) || !usuario) {
    registrarFalha(chave);
    throw new ErroHttp(401, 'E-mail ou senha incorretos.');
  }
  limparFalhas(chave);
  // Só depois da senha certa: quem não sabe a senha não descobre que a conta
  // existe e está desativada.
  if (!usuario.ativo) {
    throw new ErroHttp(
      403,
      'Esta conta está desativada. Fale com a administração.',
      'conta-desativada',
    );
  }
  return usuario;
}

function avisarPedidoAdmin(nome: string, email: string): void {
  avisar({
    assunto: `Pedido para ser administrador: ${nome}`,
    texto: `${nome} (${email}) criou conta e pediu para ser administrador do sistema de verificação de montagem. Confira se o e-mail é mesmo dessa pessoa antes de aprovar.`,
    emails: emailsDosAdmins(),
    rota: '#/admin?aba=administradores',
  });
}

/** Acesso com prazo dentro desta janela conta como "vencendo". */
const JANELA_VENCENDO_MS = 48 * 3_600_000;

function nomeDoPainel(id: number): string {
  return (banco.prepare('SELECT nome FROM paineis WHERE id = ?').get(id) as { nome: string } | undefined)?.nome ?? `painel #${id}`;
}

/** "Nome (e-mail)" de uma conta, para o histórico. */
function nomeDaConta(id: number): string {
  const conta = banco.prepare('SELECT nome, email FROM usuarios WHERE id = ?').get(id) as
    | { nome: string; email: string }
    | undefined;
  return conta ? `${conta.nome} (${conta.email})` : `conta #${id}`;
}

/** E-mails dos administradores ativos, para os avisos de pedido novo. */
function emailsDosAdmins(): string[] {
  return (
    banco.prepare("SELECT email FROM usuarios WHERE papel = 'admin' AND ativo = 1").all() as Array<{
      email: string;
    }>
  ).map((a) => a.email);
}

/** Validade em palavras, para o histórico: "por 2 dias", "até 04/10/2026 11:28". */
function descreverValidade(expiraEm: number | null, agora: number): string {
  if (expiraEm === null) return 'sem prazo';
  const horas = Math.round((expiraEm - agora) / 3_600_000);
  if (horas >= 24 && horas % 24 === 0) return `por ${plural(horas / 24, 'dia', 'dias')}`;
  const data = new Date(expiraEm).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `até ${data}`;
}

type StatusPedidoAdmin = 'pendente' | 'aprovado' | 'recusado' | 'removido';

function statusPedidoAdmin(usuarioId: number): StatusPedidoAdmin | null {
  const linha = banco
    .prepare('SELECT status FROM pedidos_admin WHERE usuarioId = ?')
    .get(usuarioId) as { status: StatusPedidoAdmin } | undefined;
  return linha?.status ?? null;
}

/** Abre (ou reabre, depois de recusado ou removido) o pedido para ser administrador. */
function registrarPedidoAdmin(usuarioId: number): void {
  banco
    .prepare(
      `INSERT INTO pedidos_admin (usuarioId, status, criadoEm) VALUES (?, 'pendente', ?)
       ON CONFLICT (usuarioId) DO UPDATE SET
         status = 'pendente', criadoEm = excluded.criadoEm,
         decididoEm = NULL, decididoPor = NULL`,
    )
    .run(usuarioId, Date.now());
}

/** Como o usuário atual se relaciona com um painel. */
export type Acesso = 'dono' | StatusAcesso | 'nenhum';

/** Converte a validade escolhida no instante em que o acesso termina; nulo é sem prazo. */
function calcularExpiracao(validade: z.infer<typeof validadeSchema>, agora: number): number | null {
  if (validade.tipo === 'indeterminado') return null;
  if (validade.tipo === 'horas') return agora + Math.round(validade.horas * 60 * 60 * 1000);
  if (validade.ate <= agora) throw new ErroHttp(400, 'A data escolhida já passou.');
  // O mesmo teto da duração em horas: o ano 9999 passava como data válida.
  if (validade.ate > agora + HORAS_MAXIMAS * 60 * 60 * 1000) {
    throw new ErroHttp(400, 'Prazo longo demais — use "sem prazo".');
  }
  return validade.ate;
}

interface PainelComAcesso {
  id: number;
  slug: string;
  nome: string;
  descricao: string | null;
  responsaveis: string[];
  meuAcesso: Acesso;
  podePreencher: boolean;
  /** Até quando o acesso aprovado vale, ou quando venceu; nulo é sem prazo. */
  acessoExpiraEm: number | null;
  pendentes: number;
  /** Quantos checklists ativos o painel tem. Zero mostra o aviso no cartão. */
  formularios: number;
}

/** `painelId` → e-mails que aprovam naquele painel. */
function mapaResponsaveis(): Map<number, string[]> {
  const linhas = banco
    .prepare('SELECT painelId, email FROM painel_responsaveis ORDER BY email')
    .all() as Array<{ painelId: number; email: string }>;
  const mapa = new Map<number, string[]>();
  for (const l of linhas) {
    const atual = mapa.get(l.painelId);
    if (atual) atual.push(l.email);
    else mapa.set(l.painelId, [l.email]);
  }
  return mapa;
}

/** Gera um `slug` estável e único a partir do nome do painel. */
function gerarSlug(nome: string): string {
  const base =
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'painel';

  let slug = base;
  let n = 2;
  while (banco.prepare('SELECT 1 FROM paineis WHERE slug = ?').get(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

/**
 * Os quatro painéis com a situação do usuário em cada um.
 *
 * `podePreencher` é a resposta oficial da pergunta "esta pessoa pode registrar
 * as checagens deste painel?". A tela obedece a ela, painel por painel — uma
 * aprovação em SEN Plus não abre MNS.
 */
export function listarPaineis(usuarioId: number, email: string): PainelComAcesso[] {
  const linhas = banco
    .prepare(
      `SELECT p.id, p.slug, p.nome, p.descricao,
              s.status AS statusSolicitacao, s.expiraEm AS acessoExpiraEm,
              (SELECT COUNT(*) FROM solicitacoes x
                WHERE x.painelId = p.id AND x.status = 'pendente') AS pendentes,
              (SELECT COUNT(*) FROM formularios f
                WHERE f.painelId = p.id AND f.ativo = 1) AS formularios
         FROM paineis p
         LEFT JOIN solicitacoes s ON s.painelId = p.id AND s.usuarioId = ?
        ORDER BY p.ordem, p.id`,
    )
    .all(usuarioId) as Array<Record<string, unknown>>;

  const responsaveis = mapaResponsaveis();
  const agora = Date.now();

  return linhas.map((l) => {
    const id = Number(l.id);
    const lista = responsaveis.get(id) ?? [];
    const souResponsavel = lista.includes(email);
    const expiraEm = l.acessoExpiraEm === null ? null : Number(l.acessoExpiraEm);
    const status = l.statusSolicitacao as StatusSolicitacao | null;
    const meuAcesso: Acesso = souResponsavel
      ? 'dono'
      : status
        ? statusEfetivo(status, expiraEm, agora)
        : 'nenhum';
    return {
      id,
      slug: String(l.slug),
      nome: String(l.nome),
      descricao: (l.descricao as string | null) ?? null,
      responsaveis: lista,
      meuAcesso,
      // O responsável preenche o painel dele sem pedir nada a ninguém.
      podePreencher: meuAcesso === 'dono' || meuAcesso === 'aprovada',
      acessoExpiraEm: meuAcesso === 'aprovada' || meuAcesso === 'expirada' ? expiraEm : null,
      pendentes: souResponsavel ? Number(l.pendentes) : 0,
      formularios: Number(l.formularios),
    };
  });
}

type Manipulador = (ctx: Contexto) => unknown;

export const rotas: Record<string, Manipulador> = {
  /**
   * Cria a conta na primeira vez que o e-mail aparece.
   *
   * Com `perfil: 'admin'`, a conta nasce de montador e com o pedido para ser
   * administrador aberto: o papel só vem quando outro administrador aprovar,
   * e por isso não abre sessão nenhuma. A exceção é o administrador inicial,
   * enquanto não houver nenhum — não existiria quem aprovar.
   */
  'POST /api/cadastro': (ctx) => {
    const r = cadastrarSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const { email, senha, nome, perfil } = r.data;

    const existente = banco.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (existente) {
      throw new ErroHttp(409, 'Já existe conta com este e-mail. Entre com a sua senha.');
    }

    const papel = deveNascerAdmin(email) ? 'admin' : 'montador';
    const aguardaAprovacao = perfil === 'admin' && papel !== 'admin';

    let id: number;
    try {
      id = emTransacao(() => {
        const info = banco
          .prepare(
            'INSERT INTO usuarios (email, nome, senha, criadoEm, papel) VALUES (?, ?, ?, ?, ?)',
          )
          .run(email, nome, criarHash(senha), Date.now(), papel);
        const novo = Number(info.lastInsertRowid);
        if (aguardaAprovacao) registrarPedidoAdmin(novo);
        return novo;
      });
    } catch (erro) {
      // Outro processo no mesmo banco (o comando de socorro, um segundo
      // servidor) criou a conta entre a consulta acima e esta gravação.
      if (erro instanceof Error && erro.message.includes('UNIQUE')) {
        throw new ErroHttp(409, 'Já existe conta com este e-mail. Entre com a sua senha.');
      }
      throw erro;
    }

    if (aguardaAprovacao) {
      avisarPedidoAdmin(nome, email);
      return { pedidoAdmin: 'pendente' };
    }

    const { token, expiraEm } = abrirSessao(id, perfil);
    return { token, expiraEm, perfil, usuario: { id, email, nome, papel } };
  },

  'POST /api/sessao': (ctx) => {
    const r = entrarSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const { email, senha, perfil } = r.data;

    const usuario = autenticar(ctx, email, senha);

    // A senha confere, mas a conta não tem o papel: a tela oferece pedir.
    if (perfil === 'admin' && usuario.papel !== 'admin') {
      const pedido = statusPedidoAdmin(usuario.id);
      if (pedido === 'pendente') {
        throw new ErroHttp(
          403,
          'O seu pedido para ser administrador ainda aguarda a aprovação de outro administrador.',
          'admin-pendente',
        );
      }
      throw new ErroHttp(
        403,
        pedido === 'recusado'
          ? 'O seu pedido para ser administrador foi recusado.'
          : 'Esta conta não é de administrador.',
        'nao-admin',
      );
    }

    const { token, expiraEm } = abrirSessao(usuario.id, perfil);
    banco.prepare('UPDATE usuarios SET ultimoAcessoEm = ? WHERE id = ?').run(Date.now(), usuario.id);
    return { token, expiraEm, perfil, usuario: publico(usuario) };
  },

  /** Conta já existente pedindo para ser administrador; prova quem é com a senha. */
  'POST /api/pedidos-admin': (ctx) => {
    const r = pedidoAdminSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const usuario = autenticar(ctx, r.data.email, r.data.senha);

    if (usuario.papel === 'admin') {
      throw new ErroHttp(400, 'Esta conta já é de administrador. Entre como administrador.');
    }
    if (statusPedidoAdmin(usuario.id) === 'pendente') {
      throw new ErroHttp(409, 'O seu pedido já aguarda aprovação.', 'admin-pendente');
    }
    registrarPedidoAdmin(usuario.id);
    avisarPedidoAdmin(usuario.nome, usuario.email);
    return { pedidoAdmin: 'pendente' };
  },

  'GET /api/sessao': (ctx) => {
    const eu = exigirSessao(ctx);
    // Sessão de administrador de quem perdeu o papel vale só como montador.
    return { usuario: publico(eu), perfil: eu.papel === 'admin' ? ctx.perfil : 'montador' };
  },

  'DELETE /api/sessao': (ctx) => {
    if (ctx.token) fecharSessao(ctx.token);
    return { ok: true };
  },

  'GET /api/paineis': (ctx) => {
    const eu = exigirSessao(ctx);
    return { paineis: listarPaineis(eu.id, eu.email) };
  },

  /**
   * Catálogo aberto dos painéis, sem sessão: a tela de login precisa mostrar
   * a lista para a pessoa escolher antes de ter conta. Devolve só nome e
   * descrição — nem responsável, nem quem pediu acesso.
   */
  'GET /api/paineis/publicos': () => {
    const linhas = banco
      .prepare('SELECT id, slug, nome, descricao FROM paineis ORDER BY ordem')
      .all() as Array<Record<string, unknown>>;
    return {
      paineis: linhas.map((l) => ({
        id: Number(l.id),
        slug: String(l.slug),
        nome: String(l.nome),
        descricao: (l.descricao as string | null) ?? null,
      })),
    };
  },

  /**
   * Checklists de um painel, com a definição inteira.
   *
   * É o que o aparelho baixa uma vez e guarda para trabalhar offline, então
   * devolve tudo de uma vez em vez de um pedido por formulário. Exige acesso
   * liberado àquele painel: a definição descreve o produto do cliente.
   */
  'GET /api/paineis/:id/formularios': (ctx) => {
    const eu = exigirSessao(ctx);
    const painelId = Number(ctx.params.id);
    const painel = listarPaineis(eu.id, eu.email).find((p) => p.id === painelId);
    if (!painel) throw new ErroHttp(404, 'Painel não encontrado.');
    if (!painel.podePreencher) {
      throw new ErroHttp(403, 'O seu acesso a este painel ainda não foi aprovado.');
    }

    const entradas = listarEntradasPorPainelId(painelId).filter((e) => e.ativo);
    return {
      formularios: entradas.map((entrada) => ({
        ...entrada,
        definicao: obterDefinicao(entrada.id)!,
      })),
    };
  },

  'POST /api/paineis/:id/solicitacoes': (ctx) => {
    const eu = exigirSessao(ctx);
    const r = solicitarSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));

    const painelId = Number(ctx.params.id);
    const painel = banco.prepare('SELECT * FROM paineis WHERE id = ?').get(painelId) as
      | Painel
      | undefined;
    if (!painel) throw new ErroHttp(404, 'Painel não encontrado.');
    const souResponsavel = banco
      .prepare('SELECT 1 FROM painel_responsaveis WHERE painelId = ? AND email = ?')
      .get(painelId, eu.email);
    if (souResponsavel) {
      throw new ErroHttp(400, 'Você é responsável por este painel; já tem acesso.');
    }

    const atual = banco
      .prepare('SELECT * FROM solicitacoes WHERE painelId = ? AND usuarioId = ?')
      .get(painelId, eu.id) as Solicitacao | undefined;

    // Aprovação vencida ou retirada não segura ninguém: pede-se de novo.
    if (atual && statusEfetivo(atual.status, atual.expiraEm) === 'aprovada') {
      throw new ErroHttp(400, 'Você já tem acesso a este painel.');
    }
    if (atual?.status === 'pendente') {
      throw new ErroHttp(400, 'O seu pedido já está aguardando o dono.');
    }

    const agora = Date.now();
    // `ON CONFLICT` cobre o caso de reenvio depois de uma recusa: o pedido
    // volta a pendente em vez de estourar a chave única.
    banco
      .prepare(
        `INSERT INTO solicitacoes (painelId, usuarioId, status, mensagem, criadoEm)
         VALUES (?, ?, 'pendente', ?, ?)
         ON CONFLICT (painelId, usuarioId) DO UPDATE SET
           status = 'pendente', mensagem = excluded.mensagem, criadoEm = excluded.criadoEm,
           decididoEm = NULL, decididoPor = NULL, expiraEm = NULL`,
      )
      .run(painelId, eu.id, r.data.mensagem ?? null, agora);

    // Responsáveis do painel e administradores decidem; os dois são avisados.
    const responsaveis = mapaResponsaveis().get(painelId) ?? [];
    avisar({
      assunto: `Pedido de acesso: ${painel.nome}`,
      texto:
        `${eu.nome} (${eu.email}) pediu acesso ao painel ${painel.nome}.` +
        (r.data.mensagem ? `\nMensagem: "${r.data.mensagem}"` : '') +
        '\n\nAprove ou recuse em Aprovações (responsáveis) ou em Administração → Acessos.',
      emails: [...responsaveis, ...emailsDosAdmins()],
      rota: '#/aprovacoes',
    });

    return { painel: listarPaineis(eu.id, eu.email).find((p) => p.id === painelId) };
  },

  /** Caixa de entrada do dono: pedidos aguardando decisão nos painéis dele. */
  'GET /api/solicitacoes': (ctx) => {
    const eu = exigirSessao(ctx);
    const linhas = banco
      .prepare(
        `SELECT s.id, s.status, s.mensagem, s.criadoEm, s.decididoEm, s.expiraEm,
                p.id AS painelId, p.nome AS painelNome,
                u.nome AS solicitanteNome, u.email AS solicitanteEmail
           FROM solicitacoes s
           JOIN paineis  p ON p.id = s.painelId
           JOIN usuarios u ON u.id = s.usuarioId
           JOIN painel_responsaveis r ON r.painelId = p.id AND r.email = ?
          ORDER BY s.status = 'pendente' DESC, s.criadoEm DESC`,
      )
      .all(eu.email) as Array<Record<string, unknown>>;

    const agora = Date.now();
    return {
      solicitacoes: linhas.map((l) => {
        const expiraEm = l.expiraEm === null ? null : Number(l.expiraEm);
        return {
          id: Number(l.id),
          status: statusEfetivo(l.status as StatusSolicitacao, expiraEm, agora),
          mensagem: (l.mensagem as string | null) ?? null,
          criadoEm: Number(l.criadoEm),
          decididoEm: l.decididoEm === null ? null : Number(l.decididoEm),
          expiraEm,
          painel: { id: Number(l.painelId), nome: String(l.painelNome) },
          solicitante: {
            nome: String(l.solicitanteNome),
            email: String(l.solicitanteEmail),
          },
        };
      }),
    };
  },

  // ---------------------------------------------------------------- admin

  /** Contadores para os selos do cabeçalho e das abas. */
  'GET /api/admin/resumo': (ctx) => {
    exigirAdmin(ctx);
    const contar = (sql: string) => Number((banco.prepare(sql).get() as { n: number }).n);
    return {
      pedidosAdmin: contar("SELECT COUNT(*) AS n FROM pedidos_admin WHERE status = 'pendente'"),
      acessosPendentes: contar("SELECT COUNT(*) AS n FROM solicitacoes WHERE status = 'pendente'"),
    };
  },

  // ------------------------------------------- admin › administradores

  /** Quem é administrador, quem pediu para ser, e as últimas decisões. */
  'GET /api/admin/administradores': (ctx) => {
    exigirAdmin(ctx);

    const administradores = banco
      .prepare(
        `SELECT u.id, u.nome, u.email, p.decididoEm AS aprovadoEm, d.nome AS aprovadoPor
           FROM usuarios u
           LEFT JOIN pedidos_admin p ON p.usuarioId = u.id AND p.status = 'aprovado'
           LEFT JOIN usuarios d ON d.id = p.decididoPor
          WHERE u.papel = 'admin'
          ORDER BY u.nome COLLATE NOCASE`,
      )
      .all() as Array<Record<string, unknown>>;

    const pedidos = banco
      .prepare(
        `SELECT p.id, p.status, p.criadoEm, p.decididoEm, d.nome AS decididoPor,
                u.id AS usuarioId, u.nome, u.email, u.criadoEm AS contaCriadaEm
           FROM pedidos_admin p
           JOIN usuarios u ON u.id = p.usuarioId
           LEFT JOIN usuarios d ON d.id = p.decididoPor
          WHERE p.status <> 'aprovado'
          ORDER BY p.status = 'pendente' DESC, COALESCE(p.decididoEm, p.criadoEm) DESC
          LIMIT 50`,
      )
      .all() as Array<Record<string, unknown>>;

    return {
      administradores: administradores.map((a) => ({
        id: Number(a.id),
        nome: String(a.nome),
        email: String(a.email),
        // Sem aprovação registrada é o administrador inicial.
        aprovadoEm: a.aprovadoEm === null ? null : Number(a.aprovadoEm),
        aprovadoPor: (a.aprovadoPor as string | null) ?? null,
      })),
      pedidos: pedidos.map((p) => ({
        id: Number(p.id),
        status: p.status as StatusPedidoAdmin,
        criadoEm: Number(p.criadoEm),
        decididoEm: p.decididoEm === null ? null : Number(p.decididoEm),
        decididoPor: (p.decididoPor as string | null) ?? null,
        usuario: {
          id: Number(p.usuarioId),
          nome: String(p.nome),
          email: String(p.email),
          criadoEm: Number(p.contaCriadaEm),
        },
      })),
    };
  },

  'POST /api/admin/pedidos-admin/:id/decisao': (ctx) => {
    const eu = exigirAdmin(ctx);
    const r = decisaoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));

    const id = Number(ctx.params.id);
    const pedido = banco.prepare('SELECT usuarioId, status FROM pedidos_admin WHERE id = ?').get(id) as
      | { usuarioId: number; status: StatusPedidoAdmin }
      | undefined;
    if (!pedido) throw new ErroHttp(404, 'Pedido não encontrado.');
    if (pedido.status !== 'pendente') throw new ErroHttp(409, 'Este pedido já foi decidido.');

    const pessoa = nomeDaConta(pedido.usuarioId);
    emTransacao(() => {
      banco
        .prepare(
          'UPDATE pedidos_admin SET status = ?, decididoEm = ?, decididoPor = ? WHERE id = ?',
        )
        .run(r.data.aprovar ? 'aprovado' : 'recusado', Date.now(), eu.id, id);
      if (r.data.aprovar) {
        banco.prepare("UPDATE usuarios SET papel = 'admin' WHERE id = ?").run(pedido.usuarioId);
      }
      registrar({
        autor: eu,
        acao: r.data.aprovar ? 'aprovou como administrador' : 'recusou o pedido de administrador',
        alvoTipo: 'administrador',
        alvoId: pedido.usuarioId,
        alvo: pessoa,
      });
    });
    return { ok: true };
  },

  /**
   * Tira o papel de administrador. A conta continua valendo para montagem;
   * as sessões de administrador dela caem na hora. Ninguém tira o próprio
   * papel — assim sempre sobra pelo menos um administrador.
   */
  'DELETE /api/admin/administradores/:id': (ctx) => {
    const eu = exigirAdmin(ctx);
    const id = Number(ctx.params.id);
    if (id === eu.id) {
      throw new ErroHttp(400, 'Você não pode tirar o seu próprio papel. Peça a outro administrador.');
    }
    const alvo = banco.prepare('SELECT papel FROM usuarios WHERE id = ?').get(id) as
      | { papel: string }
      | undefined;
    if (!alvo || alvo.papel !== 'admin') throw new ErroHttp(404, 'Administrador não encontrado.');

    const agora = Date.now();
    emTransacao(() => {
      banco.prepare("UPDATE usuarios SET papel = 'montador' WHERE id = ?").run(id);
      banco
        .prepare(
          `INSERT INTO pedidos_admin (usuarioId, status, criadoEm, decididoEm, decididoPor)
           VALUES (?, 'removido', ?, ?, ?)
           ON CONFLICT (usuarioId) DO UPDATE SET
             status = 'removido', decididoEm = excluded.decididoEm,
             decididoPor = excluded.decididoPor`,
        )
        .run(id, agora, agora, eu.id);
      registrar({
        autor: eu,
        acao: 'tirou o papel de administrador',
        alvoTipo: 'administrador',
        alvoId: id,
        alvo: nomeDaConta(id),
      });
    });
    fecharSessoesAdmin(id);
    return { ok: true, restantes: quantosAdmins() };
  },

  // ---------------------------------------------------- admin › painéis

  'GET /api/admin/paineis': (ctx) => {
    exigirAdmin(ctx);
    const linhas = banco
      .prepare('SELECT id, slug, nome, descricao, ordem, criadoEm FROM paineis ORDER BY ordem, id')
      .all() as Array<Record<string, unknown>>;
    const responsaveis = mapaResponsaveis();
    const contagem = banco
      .prepare(
        `SELECT painelId, COUNT(*) AS n FROM solicitacoes
          WHERE status = 'aprovada' AND (expiraEm IS NULL OR expiraEm > ?)
          GROUP BY painelId`,
      )
      .all(Date.now()) as Array<{ painelId: number; n: number }>;
    const aprovados = new Map(contagem.map((c) => [c.painelId, Number(c.n)]));
    // Quem mexeu por último em cada painel e checklist, vindo do histórico.
    const edicoesPainel = ultimasAlteracoes('painel');
    const edicoesChecklist = ultimasAlteracoes('checklist');

    return {
      paineis: linhas.map((l) => {
        const id = Number(l.id);
        return {
          id,
          slug: String(l.slug),
          nome: String(l.nome),
          descricao: (l.descricao as string | null) ?? null,
          responsaveis: responsaveis.get(id) ?? [],
          montadoresAprovados: aprovados.get(id) ?? 0,
          editado: edicoesPainel.get(String(id)) ?? null,
          // Resumo, sem as definições inteiras: a tela mostra nome, tipo e
          // quantas etapas cada checklist tem, e só o editor baixa o conteúdo.
          formularios: listarEntradasPorPainelId(id).map((f) => ({
            ...f,
            editado: edicoesChecklist.get(f.id) ?? null,
          })),
        };
      }),
    };
  },

  'POST /api/admin/paineis': (ctx) => {
    const eu = exigirAdmin(ctx);
    const r = painelSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const { nome, descricao, responsaveis } = r.data;

    const proxima = banco.prepare('SELECT COALESCE(MAX(ordem), -1) + 1 AS n FROM paineis').get() as {
      n: number;
    };

    const { id, formularioId } = emTransacao(() => {
      const slug = gerarSlug(nome);
      const info = banco
        .prepare(
          'INSERT INTO paineis (slug, nome, descricao, ordem, criadoEm) VALUES (?, ?, ?, ?, ?)',
        )
        .run(slug, nome, descricao ?? null, Number(proxima.n), Date.now());
      const painelId = Number(info.lastInsertRowid);
      const inserir = banco.prepare(
        'INSERT OR IGNORE INTO painel_responsaveis (painelId, email) VALUES (?, ?)',
      );
      for (const email of responsaveis) inserir.run(painelId, email);
      // O painel nasce com o checklist de montagem em branco: cadastrar o
      // painel e ter onde montar as checagens é um só passo.
      const checklist = criarParaPainel({
        painelId,
        painelSlug: slug,
        painelNome: nome,
      });
      registrar({
        autor: eu,
        acao: 'cadastrou o painel',
        alvoTipo: 'painel',
        alvoId: painelId,
        alvo: nome,
        detalhe: `Aprovam: ${responsaveis.join(', ')}`,
      });
      return { id: painelId, formularioId: checklist.id };
    });

    return { id, formularioId };
  },

  'PUT /api/admin/paineis/:id': (ctx) => {
    const eu = exigirAdmin(ctx);
    const r = painelSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const { nome, descricao, responsaveis } = r.data;

    const id = Number(ctx.params.id);
    const antes = banco.prepare('SELECT nome FROM paineis WHERE id = ?').get(id) as
      | { nome: string }
      | undefined;
    if (!antes) throw new ErroHttp(404, 'Painel não encontrado.');
    const responsaveisAntes = mapaResponsaveis().get(id) ?? [];

    // O `slug` não muda ao renomear: ele amarra o painel aos formulários do
    // catálogo e aos projetos já gravados nos aparelhos.
    emTransacao(() => {
      banco
        .prepare('UPDATE paineis SET nome = ?, descricao = ? WHERE id = ?')
        .run(nome, descricao ?? null, id);
      banco.prepare('DELETE FROM painel_responsaveis WHERE painelId = ?').run(id);
      const inserir = banco.prepare(
        'INSERT OR IGNORE INTO painel_responsaveis (painelId, email) VALUES (?, ?)',
      );
      for (const email of responsaveis) inserir.run(id, email);

      // O que mudou, em palavras: o histórico mostra o antes e o depois.
      const mudancas: string[] = [];
      if (antes.nome !== nome) mudancas.push(`nome: ${antes.nome} → ${nome}`);
      const entraram = responsaveis.filter((e) => !responsaveisAntes.includes(e));
      const sairam = responsaveisAntes.filter((e) => !responsaveis.includes(e));
      if (entraram.length) mudancas.push(`passam a aprovar: ${entraram.join(', ')}`);
      if (sairam.length) mudancas.push(`deixam de aprovar: ${sairam.join(', ')}`);
      if (mudancas.length) {
        registrar({
          autor: eu,
          acao: 'editou o painel',
          alvoTipo: 'painel',
          alvoId: id,
          alvo: nome,
          detalhe: mudancas.join('; '),
        });
      }
    });

    return { ok: true };
  },

  'DELETE /api/admin/paineis/:id': (ctx) => {
    const eu = exigirAdmin(ctx);
    const id = Number(ctx.params.id);
    const painel = banco.prepare('SELECT nome FROM paineis WHERE id = ?').get(id) as
      | { nome: string }
      | undefined;
    if (!painel) throw new ErroHttp(404, 'Painel não encontrado.');
    // As solicitações, os responsáveis e as cópias sincronizadas saem em
    // cascata. O que está só nos aparelhos não é tocado. As fotos vão para a
    // lixeira depois da transação, como em toda exclusão.
    const fotos = emTransacao(() => {
      const uids = removerRegistrosDeMidias({ painelId: id });
      banco.prepare('DELETE FROM paineis WHERE id = ?').run(id);
      registrar({ autor: eu, acao: 'excluiu o painel', alvoTipo: 'painel', alvoId: id, alvo: painel.nome });
      return uids;
    });
    moverParaLixeira(fotos);
    return { ok: true };
  },

  // --------------------------------------------------- admin › acessos

  /**
   * Todos os acessos de todos os painéis, mais as contas e os painéis que a
   * tela precisa para liberar um acesso novo. `agora` é o relógio do servidor:
   * a contagem regressiva da tela se acerta por ele, e não pelo do aparelho.
   */
  'GET /api/admin/acessos': (ctx) => {
    exigirAdmin(ctx);
    const agora = Date.now();
    const { pagina, porPagina, deslocamento } = lerPagina(ctx.consulta, 25);
    const filtro = ctx.consulta.get('filtro') ?? 'todos';
    const busca = (ctx.consulta.get('busca') ?? '').trim();
    const painelId = Number(ctx.consulta.get('painel')) || null;

    const condicoes: string[] = [];
    const valores: Array<string | number> = [];
    if (painelId) {
      condicoes.push('s.painelId = ?');
      valores.push(painelId);
    }
    if (busca) {
      condicoes.push("(lower(u.nome) LIKE ? ESCAPE '\\' OR lower(u.email) LIKE ? ESCAPE '\\')");
      valores.push(padraoBusca(busca), padraoBusca(busca));
    }
    if (filtro === 'ativos') {
      condicoes.push("s.status = 'aprovada' AND (s.expiraEm IS NULL OR s.expiraEm > ?)");
      valores.push(agora);
    } else if (filtro === 'vencendo') {
      condicoes.push("s.status = 'aprovada' AND s.expiraEm > ? AND s.expiraEm <= ?");
      valores.push(agora, agora + JANELA_VENCENDO_MS);
    } else if (filtro === 'pendentes') {
      condicoes.push("s.status = 'pendente'");
    } else if (filtro === 'encerrados') {
      condicoes.push("(s.status IN ('recusada', 'revogada') OR (s.status = 'aprovada' AND s.expiraEm <= ?))");
      valores.push(agora);
    }
    const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const base = `FROM solicitacoes s
           JOIN paineis  p ON p.id = s.painelId
           JOIN usuarios u ON u.id = s.usuarioId
           LEFT JOIN usuarios d ON d.id = s.decididoPor
          ${onde}`;

    const total = Number((banco.prepare(`SELECT COUNT(*) AS n ${base}`).get(...valores) as { n: number }).n);

    // Ordem de leitura: primeiro o que pede decisão, depois o que vence
    // antes, depois o acesso sem prazo, e por fim o histórico.
    const linhas = banco
      .prepare(
        `SELECT s.id, s.status, s.mensagem, s.criadoEm, s.decididoEm, s.expiraEm,
                p.id AS painelId, p.nome AS painelNome,
                u.id AS usuarioId, u.nome AS usuarioNome, u.email AS usuarioEmail,
                d.nome AS decididoPorNome,
                CASE WHEN s.status = 'pendente' THEN 0
                     WHEN s.status = 'aprovada' AND s.expiraEm > ? THEN 1
                     WHEN s.status = 'aprovada' AND s.expiraEm IS NULL THEN 2
                     ELSE 3 END AS peso
           ${base}
          ORDER BY peso, CASE WHEN peso = 1 THEN s.expiraEm END,
                   COALESCE(s.decididoEm, s.criadoEm) DESC
          LIMIT ? OFFSET ?`,
      )
      .all(agora, ...valores, porPagina, deslocamento) as Array<Record<string, unknown>>;

    // Os cartões do topo contam tudo, e não só a página ou o filtro.
    const c = banco
      .prepare(
        `SELECT
           COALESCE(SUM(status = 'aprovada' AND (expiraEm IS NULL OR expiraEm > ?)), 0) AS ativos,
           COALESCE(SUM(status = 'aprovada' AND expiraEm > ?), 0) AS temporarios,
           COALESCE(SUM(status = 'aprovada' AND expiraEm > ? AND expiraEm <= ?), 0) AS vencendo,
           COALESCE(SUM(status = 'pendente'), 0) AS pendentes,
           COALESCE(SUM(status IN ('recusada', 'revogada') OR (status = 'aprovada' AND expiraEm <= ?)), 0) AS encerrados
         FROM solicitacoes`,
      )
      .get(agora, agora, agora, agora + JANELA_VENCENDO_MS, agora) as Record<string, number>;

    const paineis = banco
      .prepare('SELECT id, nome FROM paineis ORDER BY ordem, id')
      .all() as Array<{ id: number; nome: string }>;

    return {
      agora,
      pagina,
      porPagina,
      total,
      contagem: {
        ativos: Number(c.ativos),
        temporarios: Number(c.temporarios),
        vencendo: Number(c.vencendo),
        pendentes: Number(c.pendentes),
        encerrados: Number(c.encerrados),
      },
      acessos: linhas.map((l) => {
        const expiraEm = l.expiraEm === null ? null : Number(l.expiraEm);
        const decidido = l.decididoEm !== null;
        return {
          id: Number(l.id),
          status: statusEfetivo(l.status as StatusSolicitacao, expiraEm, agora),
          mensagem: (l.mensagem as string | null) ?? null,
          criadoEm: Number(l.criadoEm),
          decididoEm: decidido ? Number(l.decididoEm) : null,
          expiraEm,
          // Linha decidida sem `decididoPor` foi decidida pela administração.
          decididoPor: decidido ? ((l.decididoPorNome as string | null) ?? 'Administração') : null,
          painel: { id: Number(l.painelId), nome: String(l.painelNome) },
          usuario: {
            id: Number(l.usuarioId),
            nome: String(l.usuarioNome),
            email: String(l.usuarioEmail),
          },
        };
      }),
      paineis: paineis.map((p) => ({ id: Number(p.id), nome: p.nome })),
    };
  },

  /**
   * Libera o acesso direto, sem esperar pedido: um montador, um ou mais
   * painéis, um prazo. Quem já tinha linha naquele painel — pedido pendente,
   * acesso vencido, retirado — passa a aprovado com o prazo novo.
   */
  'POST /api/admin/acessos': (ctx) => {
    const eu = exigirAdmin(ctx);
    const r = liberarAcessoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const { usuarioId, painelIds, validade } = r.data;

    const conta = banco.prepare('SELECT ativo FROM usuarios WHERE id = ?').get(usuarioId) as
      | { ativo: number }
      | undefined;
    if (!conta) throw new ErroHttp(404, 'Montador não encontrado.');
    if (!conta.ativo) throw new ErroHttp(400, 'Esta conta está desativada. Reative-a antes de liberar acesso.');
    const nomePainel = banco.prepare('SELECT nome FROM paineis WHERE id = ?');
    const nomes = painelIds.map((id) => (nomePainel.get(id) as { nome: string } | undefined)?.nome);
    if (nomes.some((n) => n === undefined)) throw new ErroHttp(404, 'Painel não encontrado.');

    const agora = Date.now();
    const expiraEm = calcularExpiracao(validade, agora);
    emTransacao(() => {
      const liberar = banco.prepare(
        `INSERT INTO solicitacoes
           (painelId, usuarioId, status, criadoEm, decididoEm, decididoPor, expiraEm)
         VALUES (?, ?, 'aprovada', ?, ?, ?, ?)
         ON CONFLICT (painelId, usuarioId) DO UPDATE SET
           status = 'aprovada', decididoEm = excluded.decididoEm,
           decididoPor = excluded.decididoPor, expiraEm = excluded.expiraEm`,
      );
      for (const painelId of painelIds) {
        liberar.run(painelId, usuarioId, agora, agora, eu.id, expiraEm);
      }
      registrar({
        autor: eu,
        acao: 'liberou acesso',
        alvoTipo: 'acesso',
        alvoId: usuarioId,
        alvo: nomeDaConta(usuarioId),
        detalhe: `${nomes.join(', ')} — ${descreverValidade(expiraEm, agora)}`,
      });
    });

    return { ok: true, expiraEm };
  },

  /**
   * Define um prazo novo para um acesso: aprova o pedido pendente, estende o
   * ativo, reativa o vencido ou o retirado. Sempre termina aprovado.
   */
  'PUT /api/admin/acessos/:id': (ctx) => {
    const eu = exigirAdmin(ctx);
    const r = prazoAcessoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));

    const id = Number(ctx.params.id);
    const linha = banco.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(id) as
      | Solicitacao
      | undefined;
    if (!linha) throw new ErroHttp(404, 'Acesso não encontrado.');

    const agora = Date.now();
    const expiraEm = calcularExpiracao(r.data.validade, agora);
    const antes = statusEfetivo(linha.status, linha.expiraEm, agora);
    emTransacao(() => {
      banco
        .prepare(
          `UPDATE solicitacoes
              SET status = 'aprovada', expiraEm = ?, decididoEm = ?, decididoPor = ?
            WHERE id = ?`,
        )
        .run(expiraEm, agora, eu.id, id);
      registrar({
        autor: eu,
        acao:
          antes === 'pendente'
            ? 'aprovou o pedido de acesso'
            : antes === 'aprovada'
              ? 'alterou o prazo do acesso'
              : 'reativou o acesso',
        alvoTipo: 'acesso',
        alvoId: linha.usuarioId,
        alvo: nomeDaConta(linha.usuarioId),
        detalhe: `${nomeDoPainel(linha.painelId)} — ${descreverValidade(expiraEm, agora)}`,
      });
    });

    return { ok: true, expiraEm };
  },

  /**
   * Retira o acesso. Num pedido ainda pendente, é a recusa. A linha fica —
   * é o histórico de quem teve acesso — e pode ser reativada depois.
   */
  'POST /api/admin/acessos/:id/revogar': (ctx) => {
    const eu = exigirAdmin(ctx);
    const id = Number(ctx.params.id);
    const linha = banco.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(id) as
      | Solicitacao
      | undefined;
    if (!linha) throw new ErroHttp(404, 'Acesso não encontrado.');

    const atual = statusEfetivo(linha.status, linha.expiraEm);
    if (atual !== 'aprovada' && atual !== 'pendente') {
      throw new ErroHttp(409, 'Este acesso já está encerrado.');
    }

    emTransacao(() => {
      banco
        .prepare(
          'UPDATE solicitacoes SET status = ?, decididoEm = ?, decididoPor = ? WHERE id = ?',
        )
        .run(atual === 'pendente' ? 'recusada' : 'revogada', Date.now(), eu.id, id);
      registrar({
        autor: eu,
        acao: atual === 'pendente' ? 'recusou o pedido de acesso' : 'retirou o acesso',
        alvoTipo: 'acesso',
        alvoId: linha.usuarioId,
        alvo: nomeDaConta(linha.usuarioId),
        detalhe: nomeDoPainel(linha.painelId),
      });
    });

    return { ok: true };
  },

  /**
   * Apaga o registro de um acesso já encerrado (expirado, retirado ou
   * recusado), para limpar a lista. Acesso valendo ou pedido aguardando não se
   * apaga daqui: primeiro se retira ou recusa — assim ninguém perde o acesso
   * por um clique no botão errado. O histórico guarda que o registro existiu.
   */
  'DELETE /api/admin/acessos/:id': (ctx) => {
    const eu = exigirAdmin(ctx);
    const id = Number(ctx.params.id);
    const linha = banco.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(id) as
      | Solicitacao
      | undefined;
    if (!linha) throw new ErroHttp(404, 'Acesso não encontrado.');

    const atual = statusEfetivo(linha.status, linha.expiraEm);
    if (atual === 'aprovada' || atual === 'pendente') {
      throw new ErroHttp(
        409,
        atual === 'aprovada'
          ? 'Este acesso ainda vale: retire-o antes de excluir o registro.'
          : 'Este pedido aguarda decisão: recuse-o antes de excluir o registro.',
      );
    }

    emTransacao(() => {
      banco.prepare('DELETE FROM solicitacoes WHERE id = ?').run(id);
      registrar({
        autor: eu,
        acao: 'excluiu o registro de acesso',
        alvoTipo: 'acesso',
        alvoId: linha.usuarioId,
        alvo: nomeDaConta(linha.usuarioId),
        detalhe: `${nomeDoPainel(linha.painelId)} — estava ${atual === 'expirada' ? 'expirado' : atual === 'revogada' ? 'retirado' : 'recusado'}`,
      });
    });

    return { ok: true };
  },

  // ------------------------------------------------ admin › formulários

  /** Checklists de um painel, inclusive os desativados. */
  'GET /api/admin/paineis/:id/formularios': (ctx) => {
    exigirAdmin(ctx);
    const painelId = Number(ctx.params.id);
    if (!banco.prepare('SELECT 1 FROM paineis WHERE id = ?').get(painelId)) {
      throw new ErroHttp(404, 'Painel não encontrado.');
    }
    return { formularios: listarEntradasPorPainelId(painelId) };
  },

  /** Um checklist com a definição inteira: é o que o editor abre. */
  'GET /api/admin/formularios/:id': (ctx) => {
    exigirAdmin(ctx);
    const definicao = obterDefinicao(ctx.params.id);
    if (!definicao) throw new ErroHttp(404, 'Checklist não encontrado.');
    return { definicao };
  },

  'POST /api/admin/paineis/:id/formularios': (ctx) => {
    const eu = exigirAdmin(ctx);
    const r = formularioNovoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));

    const painelId = Number(ctx.params.id);
    const painel = banco
      .prepare('SELECT id, slug, nome FROM paineis WHERE id = ?')
      .get(painelId) as { id: number; slug: string; nome: string } | undefined;
    if (!painel) throw new ErroHttp(404, 'Painel não encontrado.');

    const formulario = criarParaPainel({
      painelId: painel.id,
      painelSlug: painel.slug,
      painelNome: painel.nome,
      tipo: r.data.tipo,
      nome: r.data.nome,
    });
    registrar({
      autor: eu,
      acao: 'criou o checklist',
      alvoTipo: 'checklist',
      alvoId: formulario.id,
      alvo: formulario.nome,
      detalhe: `Painel ${painel.nome}`,
    });
    return { formulario };
  },

  'PUT /api/admin/formularios/:id': (ctx) => {
    const eu = exigirAdmin(ctx);
    const r = formularioSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));

    const id = ctx.params.id;
    if (!formularioExiste(id)) throw new ErroHttp(404, 'Checklist não encontrado.');

    // O nome enviado à parte vence o que estiver no JSON: é o campo que a tela
    // edita. `salvarDefinicao` reetiqueta o `id` a partir da URL, de modo que
    // um JSON importado de outro painel não sobrescreve o vizinho.
    let formulario;
    try {
      formulario = salvarDefinicao(id, {
        ...(r.data.definicao as object),
        nome: r.data.nome,
      });
    } catch (erro) {
      throw new ErroHttp(400, erro instanceof Error ? erro.message : 'Definição inválida.');
    }

    definirAtivo(id, r.data.ativo);
    // O editor grava a cada pausa: as gravações seguidas da mesma pessoa
    // viram uma linha só no histórico.
    registrar(
      {
        autor: eu,
        acao: 'editou o checklist',
        alvoTipo: 'checklist',
        alvoId: id,
        alvo: formulario.nome,
        detalhe: `${plural(formulario.etapas, 'verificação', 'verificações')}${r.data.ativo ? '' : ' · desativado para os montadores'}`,
      },
      true,
    );
    return { formulario };
  },

  'DELETE /api/admin/formularios/:id': (ctx) => {
    const eu = exigirAdmin(ctx);
    const nome = obterDefinicao(ctx.params.id)?.nome ?? ctx.params.id;
    // O que os montadores já preencheram vive no aparelho deles, referenciado
    // por `formId`, e não é tocado aqui.
    if (!excluirFormulario(ctx.params.id)) {
      throw new ErroHttp(404, 'Checklist não encontrado.');
    }
    registrar({ autor: eu, acao: 'excluiu o checklist', alvoTipo: 'checklist', alvoId: ctx.params.id, alvo: nome });
    return { ok: true };
  },

  'POST /api/solicitacoes/:id/decisao': (ctx) => {
    const eu = exigirSessao(ctx);
    const r = decisaoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));

    const id = Number(ctx.params.id);
    // O JOIN com painel_responsaveis é o controle de autorização: a linha só
    // aparece se o usuário for um dos responsáveis daquele painel. 404, e não
    // 403, para que quem não responde por ele não descubra que existe.
    const linha = banco
      .prepare(
        `SELECT s.* FROM solicitacoes s
         JOIN painel_responsaveis r ON r.painelId = s.painelId AND r.email = ?
        WHERE s.id = ?`,
      )
      .get(eu.email, id) as Solicitacao | undefined;

    if (!linha) throw new ErroHttp(404, 'Solicitação não encontrada.');
    if (linha.status !== 'pendente') throw new ErroHttp(409, 'Este pedido já foi decidido.');

    // A aprovação pelo responsável é sem prazo; prazo é coisa da administração.
    emTransacao(() => {
      banco
        .prepare(
          `UPDATE solicitacoes SET status = ?, decididoEm = ?, decididoPor = ?, expiraEm = NULL
            WHERE id = ?`,
        )
        .run(r.data.aprovar ? 'aprovada' : 'recusada', Date.now(), eu.id, id);
      registrar({
        autor: eu,
        acao: r.data.aprovar ? 'aprovou o pedido de acesso' : 'recusou o pedido de acesso',
        alvoTipo: 'acesso',
        alvoId: linha.usuarioId,
        alvo: nomeDaConta(linha.usuarioId),
        detalhe: `${nomeDoPainel(linha.painelId)} — como responsável${r.data.aprovar ? ', sem prazo' : ''}`,
      });
    });

    return { ok: true };
  },
};
