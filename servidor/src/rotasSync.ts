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
 * Sincronização das checagens: cada montador manda para o servidor o projeto
 * que tem em cada painel — respostas, TAGs e fotos. Com isso, perder o
 * aparelho deixa de ser perder o trabalho, a mesma conta continua em outro
 * aparelho, e o responsável acompanha o andamento.
 *
 * O projeto é identificado por (conta, painel), o mesmo par que o identifica
 * no aparelho. Cada montador tem o seu; não há disputa entre pessoas, só entre
 * aparelhos da mesma conta, resolvida pela versão (ver `envioProjetoSchema`).
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

function uidsDoUsuario(usuarioId: number, painelId?: number): Set<string> {
  const linhas = (
    painelId === undefined
      ? banco.prepare('SELECT uid FROM sync_midias WHERE usuarioId = ?').all(usuarioId)
      : banco.prepare('SELECT uid FROM sync_midias WHERE usuarioId = ? AND painelId = ?').all(usuarioId, painelId)
  ) as Array<{ uid: string }>;
  return new Set(linhas.map((l) => l.uid.toLowerCase()));
}

export const rotasSync: Record<string, Manipulador> = {
  /** O que a conta tem no servidor: o aparelho compara com o que tem e decide. */
  'GET /api/sync/projetos': (ctx) => {
    const eu = exigirSessao(ctx);
    const linhas = banco
      .prepare('SELECT painelId, versao, enviadoEm FROM sync_projetos WHERE usuarioId = ?')
      .all(eu.id) as Array<{ painelId: number; versao: number; enviadoEm: number }>;
    return {
      projetos: linhas.map((l) => ({
        painelId: Number(l.painelId),
        versao: Number(l.versao),
        enviadoEm: Number(l.enviadoEm),
      })),
    };
  },

  'GET /api/sync/projetos/:painelId': (ctx) => {
    const eu = exigirSessao(ctx);
    const painelId = Number(ctx.params.painelId);
    exigirAcessoAoPainel(eu, painelId);
    const linha = banco
      .prepare('SELECT versao, documento, enviadoEm FROM sync_projetos WHERE usuarioId = ? AND painelId = ?')
      .get(eu.id, painelId) as { versao: number; documento: string; enviadoEm: number } | undefined;
    if (!linha) throw new ErroHttp(404, 'Nada sincronizado deste painel ainda.');
    return {
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
  'PUT /api/sync/projetos/:painelId': (ctx) => {
    const eu = exigirSessao(ctx);
    const painelId = Number(ctx.params.painelId);
    exigirAcessoAoPainel(eu, painelId);
    const r = envioProjetoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const { versaoBase, documento } = r.data;

    const citadas = documento.midias.map((m) => m.uid.toLowerCase());
    if (new Set(citadas).size !== citadas.length) throw new ErroHttp(400, 'Mídia repetida no projeto.');
    const tags = documento.tags.map((t) => t.uid.toLowerCase());
    if (new Set(tags).size !== tags.length) throw new ErroHttp(400, 'TAG repetida no projeto.');

    const atual = banco
      .prepare('SELECT versao FROM sync_projetos WHERE usuarioId = ? AND painelId = ?')
      .get(eu.id, painelId) as { versao: number } | undefined;
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
             (usuarioId, painelId, versao, documento, enviadoEm, alteradoEm, total, respondidas, empresa, qtdTags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (usuarioId, painelId) DO UPDATE SET
             versao = excluded.versao, documento = excluded.documento,
             enviadoEm = excluded.enviadoEm, alteradoEm = excluded.alteradoEm,
             total = excluded.total, respondidas = excluded.respondidas,
             empresa = excluded.empresa, qtdTags = excluded.qtdTags`,
        )
        .run(
          eu.id,
          painelId,
          versao,
          JSON.stringify(documento),
          agora,
          Math.min(documento.projeto.atualizadoEm, agora),
          total,
          respondidas,
          documento.projeto.empresa || null,
          documento.tags.length,
        );
      const fora = [...uidsDoUsuario(eu.id, painelId)].filter((uid) => !citadasSet.has(uid));
      const apagar = banco.prepare('DELETE FROM sync_midias WHERE uid = ?');
      for (const uid of fora) apagar.run(uid);
      return fora;
    });
    moverParaLixeira(sobrando);

    const recebidas = uidsDoUsuario(eu.id);
    return { versao, faltando: citadas.filter((uid) => !recebidas.has(uid)) };
  },

  /**
   * O montador excluiu o projeto no aparelho: sai do servidor também, senão a
   * sincronização o traria de volta. Não exige o acesso valendo — é o próprio
   * trabalho dele. As fotos passam 30 dias na lixeira.
   */
  'DELETE /api/sync/projetos/:painelId': (ctx) => {
    const eu = exigirSessao(ctx);
    const painelId = Number(ctx.params.painelId);
    const fotos = emTransacao(() => {
      const uids = (
        banco
          .prepare('SELECT uid FROM sync_midias WHERE usuarioId = ? AND painelId = ?')
          .all(eu.id, painelId) as Array<{ uid: string }>
      ).map((m) => m.uid);
      banco.prepare('DELETE FROM sync_midias WHERE usuarioId = ? AND painelId = ?').run(eu.id, painelId);
      banco.prepare('DELETE FROM sync_projetos WHERE usuarioId = ? AND painelId = ?').run(eu.id, painelId);
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
      .prepare('SELECT painelId, documento FROM sync_projetos WHERE usuarioId = ?')
      .all(eu.id) as Array<{ painelId: number; documento: string }>;
    let painelId: number | null = null;
    let mime: string | null = null;
    for (const p of projetos) {
      const citada = (JSON.parse(p.documento) as DocumentoProjeto).midias.find(
        (m) => m.uid.toLowerCase() === uid,
      );
      if (citada) {
        painelId = Number(p.painelId);
        mime = citada.mime;
        break;
      }
    }
    if (painelId === null || mime === null) {
      throw new ErroHttp(404, 'Esta mídia não consta de nenhum projeto sincronizado.', 'midia-desconhecida');
    }
    exigirAcessoAoPainel(eu, painelId);

    const tipo = (ctx.tipoConteudo ?? '').split(';')[0].trim().toLowerCase();
    if (tipo !== mime) throw new ErroHttp(400, 'O tipo do arquivo não é o registrado no projeto.');
    const dono = banco.prepare('SELECT usuarioId FROM sync_midias WHERE uid = ?').get(uid) as
      | { usuarioId: number }
      | undefined;
    if (dono && dono.usuarioId !== eu.id) throw new ErroHttp(409, 'Identificador de mídia já usado.');

    gravarMidia(uid, dados);
    banco
      .prepare(
        `INSERT INTO sync_midias (uid, usuarioId, painelId, mime, tamanho, recebidoEm)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (uid) DO UPDATE SET painelId = excluded.painelId, tamanho = excluded.tamanho,
           recebidoEm = excluded.recebidoEm`,
      )
      .run(uid, eu.id, painelId, mime, dados.length, Date.now());
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
