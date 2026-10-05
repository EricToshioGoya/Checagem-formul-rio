import { existsSync } from 'node:fs';
import { calcularProgresso, checklistsDaTag, type MapaRespostas } from '../../compartilhado/progresso';
import type { DefinicaoFormulario } from '../../compartilhado/formulario';
import { banco, emTransacao, type Usuario } from './banco';
import {
  envioProjetoSchema,
  primeiroErro,
  TAMANHO_MAXIMO_MIDIA,
  type DocumentoProjeto,
} from './esquemas';
import { listarEntradasPorPainelId, obterDefinicao } from './formularios';
import { caminhoMidia, gravarMidia, moverParaLixeira, uidValido } from './midias';
import { ErroHttp, exigirSessao, listarPaineis, RespostaArquivo, type Contexto } from './rotas';

/**
 * Sincronização das checagens: cada montador manda para o servidor os projetos
 * que tem em cada painel — respostas, TAGs e fotos. Com isso, perder o
 * aparelho deixa de ser perder o trabalho, a mesma conta continua em outro
 * aparelho, e o responsável acompanha o andamento.
 *
 * O projeto é identificado pelo `uid` que tem no aparelho; um painel pode ter
 * vários projetos da mesma conta. Cada montador tem os seus; não há disputa
 * entre pessoas, só entre aparelhos da mesma conta, resolvida pela versão (ver
 * `envioProjetoSchema`).
 */

type Manipulador = (ctx: Contexto) => unknown;

/** Sincronizar exige o acesso valendo agora, como preencher. */
function exigirAcessoAoPainel(eu: Usuario, painelId: number): void {
  const painel = listarPaineis(eu.id, eu.email).find((p) => p.id === painelId);
  if (!painel) throw new ErroHttp(404, 'Painel não encontrado.');
  if (!painel.podePreencher) {
    throw new ErroHttp(403, 'O seu acesso a este painel não está liberado.', 'sem-acesso');
  }
}

/**
 * Andamento do projeto com a mesma regra do aparelho: cada TAG vezes cada
 * checklist ativo do painel escolhido para ela, contando as fotos de cada
 * etapa.
 */
export function andamentoDoDocumento(
  painelId: number,
  documento: DocumentoProjeto,
): { total: number; respondidas: number } {
  const definicoes = listarEntradasPorPainelId(painelId)
    .filter((f) => f.ativo)
    .map((f) => obterDefinicao(f.id))
    .filter((d): d is DefinicaoFormulario => d !== null);

  let total = 0;
  let respondidas = 0;
  for (const tag of documento.tags) {
    for (const definicao of checklistsDaTag(tag.formIds, definicoes)) {
      const preenchimento = documento.preenchimentos.find(
        (p) => p.tagUid === tag.uid && p.formId === definicao.id,
      );
      const fotos: Record<string, number> = {};
      for (const m of documento.midias) {
        if (m.tagUid === tag.uid && m.formId === definicao.id) {
          fotos[m.etapaId] = (fotos[m.etapaId] ?? 0) + 1;
        }
      }
      const progresso = calcularProgresso(
        definicao,
        (preenchimento?.respostas ?? {}) as MapaRespostas,
        fotos,
      );
      total += progresso.total;
      respondidas += progresso.respondidas;
    }
  }
  return { total, respondidas };
}

/** Teto de projetos por conta: cada um é um documento inteiro guardado aqui. */
const MAXIMO_PROJETOS_POR_CONTA = 500;

function uidsDoUsuario(usuarioId: number, projetoUid?: string): Set<string> {
  const linhas = (
    projetoUid === undefined
      ? banco.prepare('SELECT uid FROM sync_midias WHERE usuarioId = ?').all(usuarioId)
      : banco
          .prepare('SELECT uid FROM sync_midias WHERE usuarioId = ? AND projetoUid = ?')
          .all(usuarioId, projetoUid)
  ) as Array<{ uid: string }>;
  return new Set(linhas.map((l) => l.uid.toLowerCase()));
}

/** `uid` do projeto vindo da URL, já normalizado. */
function lerUidProjeto(ctx: Contexto): string {
  const uid = ctx.params.uid.toLowerCase();
  if (!uidValido(uid)) throw new ErroHttp(400, 'Identificador de projeto inválido.');
  return uid;
}

export const rotasSync: Record<string, Manipulador> = {
  /** O que a conta tem no servidor: o aparelho compara com o que tem e decide. */
  'GET /api/sync/projetos': (ctx) => {
    const eu = exigirSessao(ctx);
    const linhas = banco
      .prepare('SELECT projetoUid, painelId, versao, enviadoEm FROM sync_projetos WHERE usuarioId = ?')
      .all(eu.id) as Array<{ projetoUid: string; painelId: number; versao: number; enviadoEm: number }>;
    return {
      projetos: linhas.map((l) => ({
        uid: l.projetoUid,
        painelId: Number(l.painelId),
        versao: Number(l.versao),
        enviadoEm: Number(l.enviadoEm),
      })),
    };
  },

  'GET /api/sync/projetos/:uid': (ctx) => {
    const eu = exigirSessao(ctx);
    const uid = lerUidProjeto(ctx);
    const linha = banco
      .prepare(
        'SELECT painelId, versao, documento, enviadoEm FROM sync_projetos WHERE usuarioId = ? AND projetoUid = ?',
      )
      .get(eu.id, uid) as
      | { painelId: number; versao: number; documento: string; enviadoEm: number }
      | undefined;
    if (!linha) throw new ErroHttp(404, 'Projeto não sincronizado.');
    exigirAcessoAoPainel(eu, Number(linha.painelId));
    return {
      painelId: Number(linha.painelId),
      versao: Number(linha.versao),
      enviadoEm: Number(linha.enviadoEm),
      documento: JSON.parse(linha.documento) as DocumentoProjeto,
    };
  },

  /**
   * Grava o projeto. Fotos que o documento não cita mais vão para a lixeira;
   * as que ele cita e o servidor ainda não tem voltam em `faltando`, para o
   * aparelho mandar em seguida.
   */
  'PUT /api/sync/projetos/:uid': (ctx) => {
    const eu = exigirSessao(ctx);
    const uid = lerUidProjeto(ctx);
    const r = envioProjetoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const { versaoBase, painelId, documento } = r.data;

    const citadas = documento.midias.map((m) => m.uid.toLowerCase());
    if (new Set(citadas).size !== citadas.length) throw new ErroHttp(400, 'Mídia repetida no projeto.');
    const tags = documento.tags.map((t) => t.uid.toLowerCase());
    if (new Set(tags).size !== tags.length) throw new ErroHttp(400, 'TAG repetida no projeto.');

    const atual = banco
      .prepare('SELECT painelId, versao FROM sync_projetos WHERE usuarioId = ? AND projetoUid = ?')
      .get(eu.id, uid) as { painelId: number; versao: number } | undefined;
    // O projeto nasce num painel e fica nele: trocar o painel pela URL levaria
    // as checagens para onde a pessoa talvez nem tenha acesso aprovado.
    if (atual && Number(atual.painelId) !== painelId) {
      throw new ErroHttp(400, 'O projeto pertence a outro painel.');
    }
    exigirAcessoAoPainel(eu, painelId);
    if (!atual) {
      const { n } = banco
        .prepare('SELECT COUNT(*) AS n FROM sync_projetos WHERE usuarioId = ?')
        .get(eu.id) as { n: number };
      if (Number(n) >= MAXIMO_PROJETOS_POR_CONTA) {
        throw new ErroHttp(409, 'Limite de projetos desta conta atingido.');
      }
    }
    if ((atual?.versao ?? 0) !== versaoBase) {
      throw new ErroHttp(
        409,
        'Outro aparelho desta conta enviou alterações antes. Juntando as duas versões…',
        'versao-desatualizada',
      );
    }

    const { total, respondidas } = andamentoDoDocumento(painelId, documento);
    const agora = Date.now();
    const versao = versaoBase + 1;
    const citadasSet = new Set(citadas);

    const sobrando = emTransacao(() => {
      banco
        .prepare(
          `INSERT INTO sync_projetos
             (usuarioId, painelId, projetoUid, versao, documento, enviadoEm, alteradoEm,
              total, respondidas, empresa, qtdTags, nomeProjeto)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (usuarioId, projetoUid) DO UPDATE SET
             versao = excluded.versao, documento = excluded.documento,
             enviadoEm = excluded.enviadoEm, alteradoEm = excluded.alteradoEm,
             total = excluded.total, respondidas = excluded.respondidas,
             empresa = excluded.empresa, qtdTags = excluded.qtdTags,
             nomeProjeto = excluded.nomeProjeto`,
        )
        .run(
          eu.id,
          painelId,
          uid,
          versao,
          JSON.stringify(documento),
          agora,
          Math.min(documento.projeto.atualizadoEm, agora),
          total,
          respondidas,
          documento.projeto.empresa || null,
          documento.tags.length,
          documento.projeto.nomeProjeto || null,
        );
      const fora = [...uidsDoUsuario(eu.id, uid)].filter((m) => !citadasSet.has(m));
      const apagar = banco.prepare('DELETE FROM sync_midias WHERE uid = ?');
      for (const m of fora) apagar.run(m);
      return fora;
    });
    moverParaLixeira(sobrando);

    const recebidas = uidsDoUsuario(eu.id);
    return { versao, faltando: citadas.filter((m) => !recebidas.has(m)) };
  },

  /**
   * O montador excluiu o projeto no aparelho: sai do servidor também, senão a
   * sincronização o traria de volta. Não exige o acesso valendo — é o próprio
   * trabalho dele. As fotos passam 30 dias na lixeira.
   */
  'DELETE /api/sync/projetos/:uid': (ctx) => {
    const eu = exigirSessao(ctx);
    const uid = lerUidProjeto(ctx);
    const fotos = emTransacao(() => {
      const uids = [...uidsDoUsuario(eu.id, uid)];
      banco.prepare('DELETE FROM sync_midias WHERE usuarioId = ? AND projetoUid = ?').run(eu.id, uid);
      banco.prepare('DELETE FROM sync_projetos WHERE usuarioId = ? AND projetoUid = ?').run(eu.id, uid);
      return uids;
    });
    moverParaLixeira(fotos);
    return { ok: true };
  },

  /** Recebe o arquivo de uma foto ou anexo citado num projeto já sincronizado. */
  'PUT /api/sync/midias/:uid': (ctx) => {
    const eu = exigirSessao(ctx);
    const uid = ctx.params.uid.toLowerCase();
    if (!uidValido(uid)) throw new ErroHttp(400, 'Identificador de mídia inválido.');
    const dados = ctx.corpoBruto;
    if (!dados?.length) throw new ErroHttp(400, 'Arquivo vazio.');
    if (dados.length > TAMANHO_MAXIMO_MIDIA) throw new ErroHttp(413, 'Arquivo grande demais.');

    // Só entra arquivo que algum projeto da conta cita: o servidor não vira
    // depósito de qualquer coisa que alguém resolva mandar.
    const projetos = banco
      .prepare('SELECT projetoUid, painelId, documento FROM sync_projetos WHERE usuarioId = ?')
      .all(eu.id) as Array<{ projetoUid: string; painelId: number; documento: string }>;
    let dono: { projetoUid: string; painelId: number; mime: string } | null = null;
    for (const p of projetos) {
      const citada = (JSON.parse(p.documento) as DocumentoProjeto).midias.find(
        (m) => m.uid.toLowerCase() === uid,
      );
      if (citada) {
        dono = { projetoUid: p.projetoUid, painelId: Number(p.painelId), mime: citada.mime };
        break;
      }
    }
    if (dono === null) {
      throw new ErroHttp(404, 'Esta mídia não consta de nenhum projeto sincronizado.', 'midia-desconhecida');
    }
    exigirAcessoAoPainel(eu, dono.painelId);

    const tipo = (ctx.tipoConteudo ?? '').split(';')[0].trim().toLowerCase();
    if (tipo !== dono.mime) throw new ErroHttp(400, 'O tipo do arquivo não é o registrado no projeto.');
    const registrada = banco.prepare('SELECT usuarioId FROM sync_midias WHERE uid = ?').get(uid) as
      | { usuarioId: number }
      | undefined;
    if (registrada && registrada.usuarioId !== eu.id) throw new ErroHttp(409, 'Identificador de mídia já usado.');

    gravarMidia(uid, dados);
    banco
      .prepare(
        `INSERT INTO sync_midias (uid, usuarioId, painelId, projetoUid, mime, tamanho, recebidoEm)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (uid) DO UPDATE SET painelId = excluded.painelId,
           projetoUid = excluded.projetoUid, tamanho = excluded.tamanho,
           recebidoEm = excluded.recebidoEm`,
      )
      .run(uid, eu.id, dono.painelId, dono.projetoUid, dono.mime, dados.length, Date.now());
    return { ok: true };
  },

  'GET /api/sync/midias/:uid': (ctx) => {
    const eu = exigirSessao(ctx);
    const uid = ctx.params.uid.toLowerCase();
    if (!uidValido(uid)) throw new ErroHttp(400, 'Identificador de mídia inválido.');
    const linha = banco
      .prepare('SELECT painelId, mime FROM sync_midias WHERE uid = ? AND usuarioId = ?')
      .get(uid, eu.id) as { painelId: number; mime: string } | undefined;
    if (!linha) throw new ErroHttp(404, 'Mídia não encontrada.');
    exigirAcessoAoPainel(eu, Number(linha.painelId));
    const caminho = caminhoMidia(uid);
    if (!existsSync(caminho)) throw new ErroHttp(404, 'Mídia não encontrada.');
    return new RespostaArquivo(caminho, linha.mime);
  },
};
