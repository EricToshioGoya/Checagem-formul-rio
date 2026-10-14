import { createHash } from 'node:crypto';
import { normalizarCodigoPdf, PADRAO_CODIGO_PDF } from '../../compartilhado/codigoPdf';
import { existsSync } from 'node:fs';
import { banco } from './banco';
import { caminhoMidia, gravarMidia, uidValido } from './midias';
import { lerPagina } from './paginacao';
import { ErroHttp, exigirAdmin, exigirSessao, RespostaArquivo, type Contexto } from './rotas';

/**
 * Arquivo dos PDFs de checklist emitidos: a documentação que valida a
 * garantia ABB em caso de falha ou quebra do material.
 *
 * O aparelho gera o PDF (offline, se preciso), guarda numa fila e envia na
 * primeira conexão; o `uid` escolhido lá torna o envio idempotente. A
 * administração busca por empresa, projeto, número de identificação e período
 * de emissão e baixa o
 * arquivo original. Não há rota para alterar nem excluir: o SHA-256 gravado
 * no recebimento comprova que o arquivo é o mesmo.
 */

type Manipulador = (ctx: Contexto) => unknown;

/** 100 MB: um dossiê com todas as fotos incorporadas de várias TAGs. */
export const TAMANHO_MAXIMO_PDF_EMITIDO = 100 * 1024 * 1024;

/** Sem acento e em minúsculas: "São João" e "sao joao" se encontram. */
function paraBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function textoOpcional(ctx: Contexto, campo: string, rotulo: string, maximo = 200): string {
  const valor = (ctx.consulta.get(campo) ?? '').trim();
  if (valor.length > maximo) throw new ErroHttp(400, `${rotulo} longo demais.`);
  return valor;
}

function textoObrigatorio(ctx: Contexto, campo: string, rotulo: string, maximo = 200): string {
  const valor = textoOpcional(ctx, campo, rotulo, maximo);
  if (!valor) throw new ErroHttp(400, `${rotulo} não informado.`);
  return valor;
}

/** Instante em milissegundos vindo da consulta, ou nulo se ausente. */
function instante(ctx: Contexto, campo: string): number | null {
  const bruto = ctx.consulta.get(campo);
  if (bruto === null || bruto === '') return null;
  const valor = Number(bruto);
  if (!Number.isSafeInteger(valor) || valor < 0) throw new ErroHttp(400, 'Data inválida.');
  return valor;
}

interface LinhaPdf {
  uid: string;
  codigo: string | null;
  empresa: string;
  nomeProjeto: string;
  titulo: string;
  painelNome: string | null;
  montador: string | null;
  nomeArquivo: string;
  emitidoEm: number;
  recebidoEm: number;
  tamanho: number;
  sha256: string;
}

function publico(l: LinhaPdf) {
  return {
    uid: l.uid,
    codigo: l.codigo,
    empresa: l.empresa,
    nomeProjeto: l.nomeProjeto,
    titulo: l.titulo,
    painel: l.painelNome,
    montador: l.montador,
    nomeArquivo: l.nomeArquivo,
    emitidoEm: Number(l.emitidoEm),
    recebidoEm: Number(l.recebidoEm),
    tamanho: Number(l.tamanho),
    sha256: l.sha256,
  };
}

export const rotasPdfs: Record<string, Manipulador> = {
  /**
   * Recebe um PDF emitido no aparelho. Os dados vêm na consulta, o arquivo no
   * corpo. Não exige o acesso ao painel valendo: o PDF pode ter sido gerado
   * offline, antes de o prazo vencer, e a documentação não pode se perder.
   */
  'PUT /api/pdfs/:uid': (ctx) => {
    const eu = exigirSessao(ctx);
    const uid = ctx.params.uid.toLowerCase();
    if (!uidValido(uid)) throw new ErroHttp(400, 'Identificador do PDF inválido.');

    const existente = banco.prepare('SELECT usuarioId FROM pdfs_emitidos WHERE uid = ?').get(uid) as
      | { usuarioId: number | null }
      | undefined;
    if (existente) {
      // Reenvio depois de uma queda de conexão: já está guardado.
      if (existente.usuarioId === eu.id) return { ok: true };
      throw new ErroHttp(409, 'Identificador do PDF já usado.');
    }

    // Fotos, apoio e PDFs dividem a pasta, com o `uid` como nome: um `uid` de
    // outro arquivo sobrescreveria aquele arquivo.
    const usado =
      banco.prepare('SELECT 1 FROM sync_midias WHERE uid = ?').get(uid) ??
      banco.prepare('SELECT 1 FROM apoio_midias WHERE uid = ?').get(uid);
    if (usado) throw new ErroHttp(409, 'Identificador do PDF já usado.');

    const dados = ctx.corpoBruto;
    if (!dados?.length) throw new ErroHttp(400, 'Arquivo vazio.');
    const mime = (ctx.tipoConteudo ?? '').split(';')[0].trim().toLowerCase();
    if (mime !== 'application/pdf' || dados.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new ErroHttp(400, 'O arquivo enviado não é um PDF.');
    }
    if (dados.length > TAMANHO_MAXIMO_PDF_EMITIDO) {
      throw new ErroHttp(413, 'PDF grande demais (máximo 100 MB).');
    }

    // Empresa e projeto em branco no aparelho não impedem o arquivamento.
    const empresa = textoOpcional(ctx, 'empresa', 'Empresa') || '—';
    const nomeProjeto = textoOpcional(ctx, 'projeto', 'Projeto') || '—';
    const titulo = textoObrigatorio(ctx, 'titulo', 'Título');
    const nomeArquivo = textoObrigatorio(ctx, 'nomeArquivo', 'Nome do arquivo', 255);
    const emitidoEm = instante(ctx, 'emitidoEm');
    if (emitidoEm === null) throw new ErroHttp(400, 'Data de emissão não informada.');
    // Ausente só nos PDFs que já estavam na fila do aparelho antes do número existir.
    const codigoBruto = ctx.consulta.get('codigo');
    const codigo = codigoBruto ? normalizarCodigoPdf(codigoBruto) : null;
    if (codigo !== null && !PADRAO_CODIGO_PDF.test(codigo)) {
      throw new ErroHttp(400, 'Número de identificação do PDF inválido.');
    }
    if (codigo !== null && banco.prepare('SELECT 1 FROM pdfs_emitidos WHERE codigo = ?').get(codigo)) {
      throw new ErroHttp(409, `O número de identificação ${codigo} já foi usado por outro PDF.`);
    }

    const slug = ctx.consulta.get('painel')?.trim();
    const painel = slug
      ? (banco.prepare('SELECT id, nome FROM paineis WHERE slug = ?').get(slug) as
          | { id: number; nome: string }
          | undefined)
      : undefined;

    gravarMidia(uid, dados);
    banco
      .prepare(
        `INSERT INTO pdfs_emitidos
           (uid, usuarioId, painelId, painelNome, empresa, nomeProjeto, titulo, nomeArquivo,
            emitidoEm, recebidoEm, tamanho, sha256, busca, codigo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        uid,
        eu.id,
        painel?.id ?? null,
        painel?.nome ?? null,
        empresa,
        nomeProjeto,
        titulo,
        nomeArquivo,
        emitidoEm,
        Date.now(),
        dados.length,
        createHash('sha256').update(dados).digest('hex'),
        paraBusca(`${empresa} ${nomeProjeto} ${codigo ?? ''}`),
        codigo,
      );
    return { ok: true };
  },

  /**
   * Busca no arquivo (só administradores): trecho do nome da empresa, do
   * projeto ou do número de identificação, e período de emissão (`de` e `ate`
   * em milissegundos, inclusivos).
   */
  'GET /api/admin/pdfs': (ctx) => {
    exigirAdmin(ctx);
    const { pagina, porPagina, deslocamento } = lerPagina(ctx.consulta, 25);
    const condicoes: string[] = [];
    const valores: Array<string | number> = [];
    for (const termo of paraBusca(ctx.consulta.get('busca') ?? '').split(/\s+/).filter(Boolean)) {
      condicoes.push('instr(d.busca, ?) > 0');
      valores.push(termo);
    }
    const de = instante(ctx, 'de');
    const ate = instante(ctx, 'ate');
    if (de !== null) {
      condicoes.push('d.emitidoEm >= ?');
      valores.push(de);
    }
    if (ate !== null) {
      condicoes.push('d.emitidoEm <= ?');
      valores.push(ate);
    }
    const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const total = Number(
      (banco.prepare(`SELECT COUNT(*) AS n FROM pdfs_emitidos d ${onde}`).get(...valores) as { n: number }).n,
    );
    const linhas = banco
      .prepare(
        `SELECT d.uid, d.codigo, d.empresa, d.nomeProjeto, d.titulo, d.painelNome, u.nome AS montador,
                d.nomeArquivo, d.emitidoEm, d.recebidoEm, d.tamanho, d.sha256
           FROM pdfs_emitidos d LEFT JOIN usuarios u ON u.id = d.usuarioId
           ${onde}
          ORDER BY d.emitidoEm DESC, d.uid
          LIMIT ? OFFSET ?`,
      )
      .all(...valores, porPagina, deslocamento) as unknown as LinhaPdf[];
    return { pagina, porPagina, total, pdfs: linhas.map(publico) };
  },

  'GET /api/admin/pdfs/:uid/arquivo': (ctx) => {
    exigirAdmin(ctx);
    const uid = ctx.params.uid.toLowerCase();
    if (!uidValido(uid)) throw new ErroHttp(400, 'Identificador do PDF inválido.');
    const caminho = caminhoMidia(uid);
    if (!banco.prepare('SELECT 1 FROM pdfs_emitidos WHERE uid = ?').get(uid) || !existsSync(caminho)) {
      throw new ErroHttp(404, 'PDF não encontrado.');
    }
    return new RespostaArquivo(caminho, 'application/pdf');
  },
};
