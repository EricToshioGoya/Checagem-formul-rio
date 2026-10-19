import { banco } from './banco';
import { paraBusca } from './documentos';
import { lerPagina } from './paginacao';
import { ErroHttp, exigirAdmin, type Contexto } from './rotas';

/**
 * Busca de documentos na administração: os PDFs emitidos (com a situação do
 * envio para aprovação, quando houver) e os certificados anexados, numa lista
 * só. O arquivo de cada um se baixa pela rota da sua categoria.
 */

type Manipulador = (ctx: Contexto) => unknown;

const CATEGORIAS = ['verificacao', 'checklist', 'certificado'] as const;
const SITUACOES = ['aguardando', 'aprovada', 'reprovada', 'substituida'] as const;

/** Instante em milissegundos vindo da consulta, ou nulo se ausente. */
function instante(ctx: Contexto, campo: string): number | null {
  const bruto = ctx.consulta.get(campo);
  if (bruto === null || bruto === '') return null;
  const valor = Number(bruto);
  if (!Number.isSafeInteger(valor) || valor < 0) throw new ErroHttp(400, 'Data inválida.');
  return valor;
}

const UNIAO = `
  SELECT CASE WHEN v.id IS NULL THEN 'checklist' ELSE 'verificacao' END AS categoria,
         d.uid, d.nomeArquivo, d.emitidoEm AS em, d.tamanho, d.sha256,
         d.empresa, d.nomeProjeto AS projeto, d.titulo, d.painelNome AS painel,
         COALESCE(u.nome, v.montadorNome) AS montador,
         v.id AS verificacaoId, v.estado AS situacao, v.versao AS versao,
         NULL AS numero, NULL AS certificacaoId, v.categoria AS envioCategoria,
         d.busca || ' ' || COALESCE(v.busca, '') AS busca,
         i.situacao AS integridade, i.verificadoEm AS verificadoEm
    FROM pdfs_emitidos d
    LEFT JOIN usuarios u ON u.id = d.usuarioId
    LEFT JOIN verificacoes v ON v.pdfUid = d.uid AND v.estado <> 'recebendo'
    LEFT JOIN integridade_arquivos i ON i.uid = d.uid
  UNION ALL
  SELECT 'certificado', c.uid, c.nomeArquivo, c.anexadoEm, c.tamanho, c.sha256,
         c.empresa, c.projeto,
         'Certificado nº ' || c.numero || CASE WHEN c.tagPainel <> '' THEN ' — TAG ' || c.tagPainel ELSE '' END,
         c.painelNome, c.montadorNome,
         c.verificacaoId, 'aprovada', NULL, c.numero, c.certificacaoId,
         CASE WHEN c.verificacaoId IS NULL THEN NULL ELSE 'certificado' END,
         c.busca, i.situacao, i.verificadoEm
    FROM certificados_anexos c
    LEFT JOIN integridade_arquivos i ON i.uid = c.uid`;

export const rotasDocumentos: Record<string, Manipulador> = {
  /**
   * Filtros: `busca` (empresa, projeto, TAG, montador, painel, nº do
   * certificado — sem diferenciar maiúsculas e acentos), `categoria`,
   * `situacao` e período (`de` e `ate`, em milissegundos, inclusivos).
   */
  'GET /api/admin/documentos': (ctx) => {
    exigirAdmin(ctx);
    const { pagina, porPagina, deslocamento } = lerPagina(ctx.consulta, 25);
    const condicoes: string[] = [];
    const valores: Array<string | number> = [];

    for (const termo of paraBusca(ctx.consulta.get('busca') ?? '').split(/\s+/).filter(Boolean)) {
      condicoes.push('instr(doc.busca, ?) > 0');
      valores.push(termo);
    }
    const categoria = ctx.consulta.get('categoria');
    if (categoria) {
      if (!CATEGORIAS.includes(categoria as (typeof CATEGORIAS)[number])) {
        throw new ErroHttp(400, 'Categoria de documento inválida.');
      }
      condicoes.push('doc.categoria = ?');
      valores.push(categoria);
    }
    const situacao = ctx.consulta.get('situacao');
    if (situacao) {
      if (!SITUACOES.includes(situacao as (typeof SITUACOES)[number])) throw new ErroHttp(400, 'Situação inválida.');
      condicoes.push('doc.situacao = ?');
      valores.push(situacao);
    }
    const de = instante(ctx, 'de');
    const ate = instante(ctx, 'ate');
    if (de !== null) {
      condicoes.push('doc.em >= ?');
      valores.push(de);
    }
    if (ate !== null) {
      condicoes.push('doc.em <= ?');
      valores.push(ate);
    }
    const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const total = Number(
      (banco.prepare(`SELECT COUNT(*) AS n FROM (${UNIAO}) doc ${onde}`).get(...valores) as { n: number }).n,
    );
    const linhas = banco
      .prepare(`SELECT * FROM (${UNIAO}) doc ${onde} ORDER BY doc.em DESC, doc.uid LIMIT ? OFFSET ?`)
      .all(...valores, porPagina, deslocamento) as Array<Record<string, unknown>>;

    const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      pagina,
      porPagina,
      total,
      documentos: linhas.map((l) => ({
        categoria: l.categoria as (typeof CATEGORIAS)[number],
        uid: String(l.uid),
        nomeArquivo: String(l.nomeArquivo),
        em: Number(l.em),
        tamanho: Number(l.tamanho),
        sha256: String(l.sha256),
        empresa: String(l.empresa ?? ''),
        projeto: String(l.projeto ?? ''),
        titulo: String(l.titulo ?? ''),
        painel: (l.painel as string | null) ?? null,
        montador: (l.montador as string | null) ?? null,
        verificacaoId: numero(l.verificacaoId),
        situacao: (l.situacao as string | null) ?? null,
        versao: numero(l.versao),
        numero: (l.numero as string | null) ?? null,
        certificacaoId: numero(l.certificacaoId),
        /** O PDF (ou o certificado) veio de um envio para aprovação: de qual aba. */
        envioCategoria: (l.envioCategoria as 'verificacao' | 'certificado' | null) ?? null,
        integridade:
          l.integridade === null || l.integridade === undefined
            ? null
            : { situacao: String(l.integridade), verificadoEm: Number(l.verificadoEm) },
      })),
    };
  },
};
