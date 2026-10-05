import { banco, statusEfetivo, type StatusSolicitacao, type Usuario } from './banco';
import { registrar, type TipoAlvo } from './auditoria';
import { avisar, processarFila, situacaoAvisos } from './avisos';
import { configuracaoBackup, fazerBackup, listarBackups } from './backup';
import { desativarConta, excluirConta, paineisComoResponsavel, reativarConta } from './contas';
import { lerPagina, padraoBusca } from './paginacao';
import { verificarPublicacao } from './publicacao';
import { ErroHttp, exigirAdmin, exigirSessao, type Contexto } from './rotas';

/**
 * Gestão: contas (desativar e excluir), histórico, a tela Sistema (backup,
 * avisos, publicação) e o andamento dos montadores.
 */

type Manipulador = (ctx: Contexto) => unknown;

function contaAlvo(ctx: Contexto, eu: Usuario): Usuario {
  const id = Number(ctx.params.id);
  if (id === eu.id) throw new ErroHttp(400, 'Você não pode fazer isso com a própria conta.');
  const conta = banco.prepare('SELECT * FROM usuarios WHERE id = ?').get(id) as Usuario | undefined;
  if (!conta) throw new ErroHttp(404, 'Conta não encontrada.');
  return conta;
}

const FILTROS_HISTORICO: Record<string, TipoAlvo[]> = {
  paineis: ['painel', 'checklist'],
  acessos: ['acesso'],
  contas: ['conta', 'administrador'],
  sistema: ['sistema'],
};

export const rotasGestao: Record<string, Manipulador> = {
  // ------------------------------------------------------------ contas

  'GET /api/admin/contas': (ctx) => {
    exigirAdmin(ctx);
    const agora = Date.now();
    const { pagina, porPagina, deslocamento } = lerPagina(ctx.consulta, 25);
    const busca = (ctx.consulta.get('busca') ?? '').trim();
    const filtro = ctx.consulta.get('filtro') ?? 'todas';

    const condicoes: string[] = [];
    const valores: Array<string | number> = [];
    if (busca) {
      condicoes.push("(lower(u.nome) LIKE ? ESCAPE '\\' OR lower(u.email) LIKE ? ESCAPE '\\')");
      valores.push(padraoBusca(busca), padraoBusca(busca));
    }
    if (filtro === 'ativas') condicoes.push('u.ativo = 1');
    if (filtro === 'desativadas') condicoes.push('u.ativo = 0');
    if (filtro === 'admins') condicoes.push("u.papel = 'admin'");
    const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const total = Number(
      (banco.prepare(`SELECT COUNT(*) AS n FROM usuarios u ${onde}`).get(...valores) as { n: number }).n,
    );
    const linhas = banco
      .prepare(
        `SELECT u.id, u.nome, u.email, u.papel, u.ativo, u.criadoEm, u.desativadoEm, u.ultimoAcessoEm,
                (SELECT COUNT(*) FROM solicitacoes s
                  WHERE s.usuarioId = u.id AND s.status = 'aprovada'
                    AND (s.expiraEm IS NULL OR s.expiraEm > ?)) AS acessosAtivos,
                (SELECT COUNT(*) FROM sync_projetos sp WHERE sp.usuarioId = u.id) AS projetos,
                (SELECT COUNT(*) FROM painel_responsaveis r WHERE r.email = u.email) AS responsavelPor
           FROM usuarios u ${onde}
          ORDER BY u.ativo DESC, lower(u.nome)
          LIMIT ? OFFSET ?`,
      )
      .all(agora, ...valores, porPagina, deslocamento) as Array<Record<string, unknown>>;

    const contar = (sql: string) => Number((banco.prepare(sql).get() as { n: number }).n);
    return {
      pagina,
      porPagina,
      total,
      contagem: {
        todas: contar('SELECT COUNT(*) AS n FROM usuarios'),
        ativas: contar('SELECT COUNT(*) AS n FROM usuarios WHERE ativo = 1'),
        desativadas: contar('SELECT COUNT(*) AS n FROM usuarios WHERE ativo = 0'),
        admins: contar("SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'admin'"),
      },
      contas: linhas.map((l) => ({
        id: Number(l.id),
        nome: String(l.nome),
        email: String(l.email),
        papel: l.papel as 'montador' | 'admin',
        ativo: Number(l.ativo) === 1,
        criadoEm: Number(l.criadoEm),
        desativadoEm: l.desativadoEm === null ? null : Number(l.desativadoEm),
        ultimoAcessoEm: l.ultimoAcessoEm === null ? null : Number(l.ultimoAcessoEm),
        acessosAtivos: Number(l.acessosAtivos),
        projetos: Number(l.projetos),
        responsavelPor: Number(l.responsavelPor),
      })),
    };
  },

  /** O que some junto com a conta — a tela mostra antes de pedir a confirmação. */
  'GET /api/admin/contas/:id/exclusao': (ctx) => {
    const eu = exigirAdmin(ctx);
    const conta = contaAlvo(ctx, eu);
    const contar = (sql: string) => Number((banco.prepare(sql).get(conta.id) as { n: number }).n);
    return {
      paineisComoResponsavel: paineisComoResponsavel(conta.email),
      acessos: contar('SELECT COUNT(*) AS n FROM solicitacoes WHERE usuarioId = ?'),
      projetos: contar('SELECT COUNT(*) AS n FROM sync_projetos WHERE usuarioId = ?'),
      fotos: contar('SELECT COUNT(*) AS n FROM sync_midias WHERE usuarioId = ?'),
    };
  },

  'POST /api/admin/contas/:id/desativar': (ctx) => {
    const eu = exigirAdmin(ctx);
    desativarConta(contaAlvo(ctx, eu).id, eu);
    return { ok: true };
  },

  'POST /api/admin/contas/:id/reativar': (ctx) => {
    const eu = exigirAdmin(ctx);
    reativarConta(contaAlvo(ctx, eu).id, eu);
    return { ok: true };
  },

  'DELETE /api/admin/contas/:id': (ctx) => {
    const eu = exigirAdmin(ctx);
    return { ok: true, ...excluirConta(contaAlvo(ctx, eu).id, eu) };
  },

  /** Busca de contas ativas para o "Liberar acesso" — a lista inteira não vem mais de uma vez. */
  'GET /api/admin/usuarios': (ctx) => {
    exigirAdmin(ctx);
    const busca = (ctx.consulta.get('busca') ?? '').trim();
    const linhas = (
      busca
        ? banco
            .prepare(
              `SELECT id, nome, email, criadoEm FROM usuarios
                WHERE ativo = 1 AND (lower(nome) LIKE ? ESCAPE '\\' OR lower(email) LIKE ? ESCAPE '\\')
                ORDER BY lower(nome) LIMIT 20`,
            )
            .all(padraoBusca(busca), padraoBusca(busca))
        : banco
            .prepare('SELECT id, nome, email, criadoEm FROM usuarios WHERE ativo = 1 ORDER BY lower(nome) LIMIT 20')
            .all()
    ) as Array<{ id: number; nome: string; email: string; criadoEm: number }>;
    return {
      usuarios: linhas.map((u) => ({ id: Number(u.id), nome: u.nome, email: u.email, criadoEm: Number(u.criadoEm) })),
    };
  },

  /** Situação de uma conta em cada painel: o modal mostra "já tem acesso até…". */
  'GET /api/admin/usuarios/:id/acessos': (ctx) => {
    exigirAdmin(ctx);
    const id = Number(ctx.params.id);
    const conta = banco.prepare('SELECT email FROM usuarios WHERE id = ?').get(id) as
      | { email: string }
      | undefined;
    if (!conta) throw new ErroHttp(404, 'Conta não encontrada.');
    const agora = Date.now();
    const acessos = banco
      .prepare('SELECT painelId, status, expiraEm FROM solicitacoes WHERE usuarioId = ?')
      .all(id) as Array<{ painelId: number; status: StatusSolicitacao; expiraEm: number | null }>;
    const responsavel = banco
      .prepare('SELECT painelId FROM painel_responsaveis WHERE email = ?')
      .all(conta.email) as Array<{ painelId: number }>;
    return {
      acessos: acessos.map((a) => ({
        painelId: Number(a.painelId),
        status: statusEfetivo(a.status, a.expiraEm === null ? null : Number(a.expiraEm), agora),
        expiraEm: a.expiraEm === null ? null : Number(a.expiraEm),
      })),
      responsavelPor: responsavel.map((r) => Number(r.painelId)),
    };
  },

  // ---------------------------------------------------------- histórico

  'GET /api/admin/auditoria': (ctx) => {
    exigirAdmin(ctx);
    const { pagina, porPagina, deslocamento } = lerPagina(ctx.consulta, 30);
    const tipos = FILTROS_HISTORICO[ctx.consulta.get('tipo') ?? ''] ?? null;
    const busca = (ctx.consulta.get('busca') ?? '').trim();

    const condicoes: string[] = [];
    const valores: Array<string | number> = [];
    if (tipos) {
      condicoes.push(`alvoTipo IN (${tipos.map(() => '?').join(', ')})`);
      valores.push(...tipos);
    }
    if (busca) {
      condicoes.push(
        "(lower(autorNome) LIKE ? ESCAPE '\\' OR lower(alvo) LIKE ? ESCAPE '\\' OR lower(COALESCE(detalhe, '')) LIKE ? ESCAPE '\\' OR lower(acao) LIKE ? ESCAPE '\\')",
      );
      const p = padraoBusca(busca);
      valores.push(p, p, p, p);
    }
    const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const total = Number(
      (banco.prepare(`SELECT COUNT(*) AS n FROM auditoria ${onde}`).get(...valores) as { n: number }).n,
    );
    const linhas = banco
      .prepare(
        `SELECT id, em, autorNome, acao, alvoTipo, alvo, detalhe FROM auditoria ${onde}
          ORDER BY em DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...valores, porPagina, deslocamento) as Array<Record<string, unknown>>;
    return {
      pagina,
      porPagina,
      total,
      registros: linhas.map((l) => ({
        id: Number(l.id),
        em: Number(l.em),
        autor: String(l.autorNome),
        acao: String(l.acao),
        alvoTipo: String(l.alvoTipo),
        alvo: String(l.alvo),
        detalhe: (l.detalhe as string | null) ?? null,
      })),
    };
  },

  // ------------------------------------------------------------ sistema

  'GET /api/admin/sistema': (ctx) => {
    exigirAdmin(ctx);
    return {
      avisos: situacaoAvisos(),
      backup: { ...configuracaoBackup(), recentes: listarBackups().slice(0, 8) },
      publicacao: verificarPublicacao(),
    };
  },

  'POST /api/admin/sistema/backup': (ctx) => {
    const eu = exigirAdmin(ctx);
    const feito = fazerBackup('manual');
    if (!feito) throw new ErroHttp(409, 'Já houve um backup neste mesmo segundo. Tente de novo.');
    registrar({ autor: eu, acao: 'fez um backup manual', alvoTipo: 'sistema', alvo: feito.arquivo });
    return { backup: feito };
  },

  /** Manda um aviso de teste para o administrador e para o webhook. */
  'POST /api/admin/sistema/aviso-teste': async (ctx) => {
    const eu = exigirAdmin(ctx);
    const situacao = situacaoAvisos();
    if (!situacao.email.configurado && !situacao.webhook.configurado) {
      throw new ErroHttp(400, 'Nenhum canal de aviso configurado (SMTP_* ou AVISO_WEBHOOK_URL).');
    }
    avisar({
      assunto: 'Aviso de teste — Verificação de Montagem',
      texto: `Teste pedido por ${eu.nome}. Se esta mensagem chegou, os avisos de pedidos novos estão funcionando.`,
      emails: [eu.email],
      rota: '#/admin?aba=sistema',
    });
    // Tenta enviar já, para a tela mostrar o resultado sem esperar a fila.
    await processarFila();
    registrar({ autor: eu, acao: 'enviou um aviso de teste', alvoTipo: 'sistema', alvo: 'Avisos' });
    return { avisos: situacaoAvisos() };
  },

  // --------------------------------------------------------- andamento

  /**
   * Andamento dos montadores: o administrador vê todos os painéis; o
   * responsável, os painéis dele. Entra quem tem acesso valendo e quem já
   * sincronizou algo — quem tem acesso e nunca enviou aparece em 0%.
   */
  'GET /api/andamento': (ctx) => {
    const eu = exigirSessao(ctx);
    const ehAdmin = eu.papel === 'admin' && ctx.perfil === 'admin';
    const visiveis = (
      ehAdmin
        ? banco.prepare('SELECT id FROM paineis').all()
        : banco.prepare('SELECT painelId AS id FROM painel_responsaveis WHERE email = ?').all(eu.email)
    ) as Array<{ id: number }>;
    let ids = visiveis.map((v) => Number(v.id));
    const painelFiltro = Number(ctx.consulta.get('painel')) || null;
    if (painelFiltro) ids = ids.filter((id) => id === painelFiltro);

    const { pagina, porPagina, deslocamento } = lerPagina(ctx.consulta, 25);
    const paineis = (
      ehAdmin
        ? banco.prepare('SELECT id, nome FROM paineis ORDER BY ordem, id').all()
        : banco
            .prepare(
              `SELECT p.id, p.nome FROM paineis p JOIN painel_responsaveis r ON r.painelId = p.id
                WHERE r.email = ? ORDER BY p.ordem, p.id`,
            )
            .all(eu.email)
    ) as Array<{ id: number; nome: string }>;
    if (!ids.length) return { pagina, porPagina, total: 0, itens: [], paineis };

    const agora = Date.now();
    const marcadores = ids.map(() => '?').join(', ');
    const base = `FROM (
          SELECT painelId, usuarioId FROM solicitacoes
           WHERE status = 'aprovada' AND (expiraEm IS NULL OR expiraEm > ?)
          UNION
          SELECT painelId, usuarioId FROM sync_projetos
        ) b
        JOIN paineis p  ON p.id = b.painelId
        JOIN usuarios u ON u.id = b.usuarioId
        LEFT JOIN sync_projetos sp ON sp.painelId = b.painelId AND sp.usuarioId = b.usuarioId
       WHERE b.painelId IN (${marcadores})`;
    const total = Number(
      (banco.prepare(`SELECT COUNT(*) AS n ${base}`).get(agora, ...ids) as { n: number }).n,
    );
    const linhas = banco
      .prepare(
        `SELECT p.id AS painelId, p.nome AS painelNome, u.id AS usuarioId, u.nome, u.email,
                sp.total, sp.respondidas, sp.enviadoEm, sp.alteradoEm, sp.empresa, sp.qtdTags,
                sp.projetoUid, sp.nomeProjeto
           ${base}
          ORDER BY p.ordem, p.id, lower(u.nome), lower(sp.nomeProjeto)
          LIMIT ? OFFSET ?`,
      )
      .all(agora, ...ids, porPagina, deslocamento) as Array<Record<string, unknown>>;

    return {
      pagina,
      porPagina,
      total,
      paineis,
      itens: linhas.map((l) => {
        const totalEtapas = l.total === null ? 0 : Number(l.total);
        const respondidas = l.respondidas === null ? 0 : Number(l.respondidas);
        return {
          painel: { id: Number(l.painelId), nome: String(l.painelNome) },
          usuario: { id: Number(l.usuarioId), nome: String(l.nome), email: String(l.email) },
          projeto:
            l.projetoUid === null
              ? null
              : { uid: String(l.projetoUid), nome: (l.nomeProjeto as string | null) ?? null },
          empresa: (l.empresa as string | null) ?? null,
          tags: l.qtdTags === null ? 0 : Number(l.qtdTags),
          total: totalEtapas,
          respondidas,
          percentual: totalEtapas ? Math.round((respondidas / totalEtapas) * 100) : 0,
          enviadoEm: l.enviadoEm === null ? null : Number(l.enviadoEm),
          alteradoEm: l.alteradoEm === null ? null : Number(l.alteradoEm),
        };
      }),
    };
  },
};
