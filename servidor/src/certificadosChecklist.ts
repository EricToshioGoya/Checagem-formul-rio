import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { agendarBackupContinuo } from './backup';
import { carimbarCertificado, type DadosCarimbo } from './carimboCertificado';
import { banco } from './banco';
import { caminhoDocumento, conferirHashRecebido } from './documentos';
import { gravarMidia, uidValido } from './midias';
import { ErroHttp, RespostaArquivo, exigirAdmin, exigirSessao, type Contexto } from './rotas';

/**
 * Certificado do checklist que "contém certificado".
 *
 * A administração envia, ao montar o checklist, o modelo do certificado em
 * PDF. Quando aprova o PDF do checklist preenchido, o certificado sai desse
 * modelo: cada página recebe um carimbo com o código único, a data e quem
 * aprovou. O código é aleatório (ex.: 7K3F-9Q2M), sem ordem e sem repetição.
 */

type Manipulador = (ctx: Contexto) => unknown;

/** 25 MB: um certificado com logotipos e assinatura digitalizada fica bem abaixo. */
export const TAMANHO_MAXIMO_MODELO = 25 * 1024 * 1024;

/** Sem 0/O e 1/I/L: o código é lido e digitado por pessoas. */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const PADRAO_CODIGO = /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

/** Código novo, conferido contra todos os certificados já registrados. */
export function novoCodigoCertificado(): string {
  const existe = banco.prepare('SELECT 1 FROM certificados WHERE numero = ?');
  for (let tentativa = 0; tentativa < 50; tentativa += 1) {
    let bruto = '';
    for (let i = 0; i < 8; i += 1) bruto += ALFABETO[randomInt(ALFABETO.length)];
    const codigo = `${bruto.slice(0, 4)}-${bruto.slice(4)}`;
    if (!existe.get(codigo)) return codigo;
  }
  // 31^8 combinações: chegar aqui indica defeito, e não azar.
  throw new ErroHttp(500, 'Não foi possível gerar um código único para o certificado.');
}

/** Modelo registrado; o arquivo é conferido (e reparado do backup) na leitura. */
function lerModelo(uid: string): Buffer {
  const modelo = banco.prepare('SELECT sha256, tamanho FROM modelos_certificado WHERE uid = ?').get(uid) as
    | { sha256: string; tamanho: number }
    | undefined;
  if (!modelo) {
    throw new ErroHttp(409, 'O checklist não tem o modelo do certificado. Envie o modelo ao editar o checklist.', 'sem-modelo-certificado');
  }
  return readFileSync(caminhoDocumento(uid, modelo.sha256, Number(modelo.tamanho)));
}

/** Gera o certificado a partir do modelo registrado do checklist. */
export async function gerarCertificadoDoModelo(modeloUid: string, d: DadosCarimbo): Promise<Buffer> {
  const modelo = lerModelo(modeloUid);
  try {
    return await carimbarCertificado(modelo, d);
  } catch {
    throw new ErroHttp(409, 'O modelo do certificado não pôde ser aberto. Envie outro PDF no checklist.', 'modelo-invalido');
  }
}

function uidDaUrl(bruto: string): string {
  const uid = bruto.toLowerCase();
  if (!uidValido(uid)) throw new ErroHttp(400, 'Identificador inválido.');
  return uid;
}

export const rotasCertificadosChecklist: Record<string, Manipulador> = {
  /**
   * Modelo do certificado de um checklist: PDF, com o `uid` escolhido pela
   * tela. Fica guardado como documento; trocar o modelo é enviar outro.
   */
  'PUT /api/admin/modelos-certificado/:uid': async (ctx) => {
    const eu = exigirAdmin(ctx);
    const uid = uidDaUrl(ctx.params.uid);
    const dados = ctx.corpoBruto;
    if (!dados?.length) throw new ErroHttp(400, 'Selecione o PDF do modelo do certificado.');
    const mime = (ctx.tipoConteudo ?? '').split(';')[0].trim().toLowerCase();
    if (mime !== 'application/pdf' || dados.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new ErroHttp(400, 'O modelo do certificado deve ser um PDF.');
    }
    if (dados.length > TAMANHO_MAXIMO_MODELO) throw new ErroHttp(413, 'PDF grande demais (máximo 25 MB).');
    const sha256 = conferirHashRecebido(ctx.consulta.get('sha256'), dados);

    const existente = banco.prepare('SELECT * FROM modelos_certificado WHERE uid = ?').get(uid) as
      | { uid: string; nomeArquivo: string; tamanho: number; sha256: string; paginas: number }
      | undefined;
    if (existente) {
      // Reenvio do mesmo arquivo (queda de conexão): já está guardado.
      if (existente.sha256 === sha256) return { modelo: { ...existente, tamanho: Number(existente.tamanho), paginas: Number(existente.paginas) } };
      throw new ErroHttp(409, 'Identificador de modelo já usado.');
    }
    const usado =
      banco.prepare('SELECT 1 FROM sync_midias WHERE uid = ?').get(uid) ??
      banco.prepare('SELECT 1 FROM apoio_midias WHERE uid = ?').get(uid) ??
      banco.prepare('SELECT 1 FROM pdfs_emitidos WHERE uid = ?').get(uid) ??
      banco.prepare('SELECT 1 FROM certificados_anexos WHERE uid = ?').get(uid) ??
      banco.prepare('SELECT 1 FROM midias_protegidas WHERE uid = ?').get(uid);
    if (usado) throw new ErroHttp(409, 'Identificador de modelo já usado.');

    // O certificado sai deste arquivo na aprovação: um PDF que não abre (ou
    // protegido por senha) é recusado agora, e não lá.
    let paginas: number;
    try {
      paginas = (await PDFDocument.load(dados)).getPageCount();
    } catch {
      throw new ErroHttp(400, 'Este PDF não pôde ser aberto (protegido por senha ou danificado). Envie outro.');
    }
    if (paginas < 1) throw new ErroHttp(400, 'O PDF não tem páginas.');

    const nomeArquivo =
      (ctx.consulta.get('nomeArquivo') ?? '').replace(/[\u0000-\u001f\u007f/\\]/g, '-').trim().slice(0, 200) ||
      'modelo-certificado.pdf';
    gravarMidia(uid, dados);
    banco
      .prepare(
        `INSERT INTO modelos_certificado (uid, nomeArquivo, tamanho, sha256, paginas, enviadoEm, enviadoPor, enviadoPorNome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(uid, nomeArquivo, dados.length, sha256, paginas, Date.now(), eu.id, eu.nome);
    agendarBackupContinuo();
    return { modelo: { uid, nomeArquivo, tamanho: dados.length, sha256, paginas } };
  },

  'GET /api/admin/modelos-certificado/:uid': (ctx) => {
    exigirAdmin(ctx);
    const uid = uidDaUrl(ctx.params.uid);
    const modelo = banco.prepare('SELECT sha256, tamanho FROM modelos_certificado WHERE uid = ?').get(uid) as
      | { sha256: string; tamanho: number }
      | undefined;
    if (!modelo) throw new ErroHttp(404, 'Modelo não encontrado.');
    return new RespostaArquivo(caminhoDocumento(uid, modelo.sha256, Number(modelo.tamanho)), 'application/pdf');
  },

  /** O montador baixa o certificado emitido para o checklist que enviou. */
  'GET /api/verificacoes/:uid/certificado': (ctx) => {
    const eu = exigirSessao(ctx);
    const uid = uidDaUrl(ctx.params.uid);
    const l = banco
      .prepare("SELECT usuarioId, certificadoUid FROM verificacoes WHERE uid = ? AND categoria = 'certificado'")
      .get(uid) as { usuarioId: number | null; certificadoUid: string | null } | undefined;
    if (!l || l.usuarioId !== eu.id || !l.certificadoUid) throw new ErroHttp(404, 'Certificado não encontrado.');
    const anexo = banco
      .prepare('SELECT sha256, tamanho FROM certificados_anexos WHERE uid = ?')
      .get(l.certificadoUid) as { sha256: string; tamanho: number } | undefined;
    if (!anexo) throw new ErroHttp(404, 'Certificado não encontrado.');
    return new RespostaArquivo(caminhoDocumento(l.certificadoUid, anexo.sha256, Number(anexo.tamanho)), 'application/pdf');
  },
};
