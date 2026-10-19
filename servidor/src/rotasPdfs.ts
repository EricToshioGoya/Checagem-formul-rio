import { banco, emTransacao } from './banco';
import { agendarBackupContinuo } from './backup';
import { caminhoDocumento, conferirHashRecebido, paraBusca } from './documentos';
import { gravarMidia, uidValido } from './midias';
import { lerPagina } from './paginacao';
import { ErroHttp, exigirAdmin, exigirSessao, RespostaArquivo, type Contexto } from './rotas';

/**
 * Arquivo dos PDFs de checklist emitidos: a documentação que valida a
 * garantia ABB em caso de falha ou quebra do material.
 *
 * O aparelho gera o PDF (offline, se preciso), guarda numa fila e envia na
 * primeira conexão; o `uid` escolhido lá torna o envio idempotente. A
 * administração busca por empresa, projeto e período de emissão e baixa o
 * arquivo original. Não há rota para alterar nem excluir — e o banco recusa
 * as duas coisas por gatilho. O aparelho manda o SHA-256 que calculou: um
 * arquivo que chega diferente (transferência incompleta) é recusado, e o hash
 * gravado comprova depois que o arquivo é o mesmo.
 */

type Manipulador = (ctx: Contexto) => unknown;

/** 100 MB: um dossiê com todas as fotos incorporadas de várias TAGs. */
export const TAMANHO_MAXIMO_PDF_EMITIDO = 100 * 1024 * 1024;


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

/**
 * Recalcula o texto de busca dos PDFs: os arquivados antes de a busca incluir
 * título, arquivo, painel e montador só tinham empresa e projeto. Roda na
 * subida; só muda o que estiver diferente.
 */
export function atualizarBuscaDosPdfs(): void {
  const linhas = banco
    .prepare(
      `SELECT d.uid, d.empresa, d.nomeProjeto, d.titulo, d.nomeArquivo, d.painelNome, d.busca, u.nome AS montador
         FROM pdfs_emitidos d LEFT JOIN usuarios u ON u.id = d.usuarioId`,
    )
    .all() as Array<Record<string, string | null>>;
  const gravar = banco.prepare('UPDATE pdfs_emitidos SET busca = ? WHERE uid = ?');
  emTransacao(() => {
    for (const l of linhas) {
      const busca = paraBusca(
        `${l.empresa ?? ''} ${l.nomeProjeto ?? ''} ${l.titulo ?? ''} ${l.nomeArquivo ?? ''} ${l.painelNome ?? ''} ${l.montador ?? ''}`,
      );
      if (busca !== l.busca) gravar.run(busca, l.uid);
    }
  });
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
      banco.prepare('SELECT 1 FROM apoio_midias WHERE uid = ?').get(uid) ??
      banco.prepare('SELECT 1 FROM certificados_anexos WHERE uid = ?').get(uid) ??
      banco.prepare('SELECT 1 FROM modelos_certificado WHERE uid = ?').get(uid) ??
      banco.prepare('SELECT 1 FROM midias_protegidas WHERE uid = ?').get(uid);
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
    const sha256 = conferirHashRecebido(ctx.consulta.get('sha256'), dados);

    // Empresa e projeto em branco no aparelho não impedem o arquivamento.
    const empresa = textoOpcional(ctx, 'empresa', 'Empresa') || '—';
    const nomeProjeto = textoOpcional(ctx, 'projeto', 'Projeto') || '—';
    const titulo = textoObrigatorio(ctx, 'titulo', 'Título');
    const nomeArquivo = textoObrigatorio(ctx, 'nomeArquivo', 'Nome do arquivo', 255);
    const emitidoEm = instante(ctx, 'emitidoEm');
    if (emitidoEm === null) throw new ErroHttp(400, 'Data de emissão não informada.');

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
            emitidoEm, recebidoEm, tamanho, sha256, busca)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        sha256,
        paraBusca(`${empresa} ${nomeProjeto} ${titulo} ${nomeArquivo} ${painel?.nome ?? ''} ${eu.nome}`),
      );
    agendarBackupContinuo();
    return { ok: true };
  },

  /**
   * Busca no arquivo (só administradores): trecho do nome da empresa ou do
   * projeto e período de emissão (`de` e `ate` em milissegundos, inclusivos).
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
        `SELECT d.uid, d.empresa, d.nomeProjeto, d.titulo, d.painelNome, u.nome AS montador,
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
    const pdf = banco.prepare('SELECT sha256, tamanho FROM pdfs_emitidos WHERE uid = ?').get(uid) as
      | { sha256: string; tamanho: number }
      | undefined;
    if (!pdf) throw new ErroHttp(404, 'PDF não encontrado.');
    return new RespostaArquivo(caminhoDocumento(uid, pdf.sha256, Number(pdf.tamanho)), 'application/pdf');
  },
};
