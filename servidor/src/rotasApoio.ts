import { existsSync } from 'node:fs';
import { banco } from './banco';
import { caminhoMidia, gravarMidia, uidValido } from './midias';
import { ErroHttp, exigirAdmin, exigirSessao, RespostaArquivo, type Contexto } from './rotas';

/**
 * Imagens, vídeos e PDFs de apoio das etapas: a administração envia ao montar o
 * checklist, e o montador vê na etapa — a foto do pino certo, o vídeo da
 * conexão correta.
 *
 * O aparelho comprime a imagem antes (JPEG, como as fotos das checagens; vídeo
 * vai como está) e escolhe o `uid`; o checklist guarda só o endereço `/api/apoio/<uid>`. Ler exige
 * sessão, como o próprio checklist; o aparelho baixa a imagem junto com o
 * checklist e a guarda para o preenchimento offline.
 */

type Manipulador = (ctx: Contexto) => unknown;

/** 5 MB: uma imagem comprimida no aparelho fica bem abaixo. */
export const TAMANHO_MAXIMO_IMAGEM_APOIO = 5 * 1024 * 1024;
/** 30 MB: um vídeo curto de instrução. Vai sem recompressão, como foi gravado. */
export const TAMANHO_MAXIMO_VIDEO_APOIO = 30 * 1024 * 1024;
/** Maior corpo aceito pela rota; o limite de cada tipo é conferido no manipulador. */
export const TAMANHO_MAXIMO_APOIO = TAMANHO_MAXIMO_VIDEO_APOIO;

/** 15 MB: manual ou laudo em PDF. */
export const TAMANHO_MAXIMO_PDF_APOIO = 15 * 1024 * 1024;

const MIMES_IMAGEM = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MIMES_VIDEO = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

/** Confere a assinatura do arquivo: o tipo declarado sozinho não basta. */
function assinaturaConfere(mime: string, dados: Buffer): boolean {
  if (mime === 'image/jpeg') return dados[0] === 0xff && dados[1] === 0xd8 && dados[2] === 0xff;
  if (mime === 'image/png') return dados.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') {
    return dados.subarray(0, 4).toString('latin1') === 'RIFF' && dados.subarray(8, 12).toString('latin1') === 'WEBP';
  }
  // MP4 e MOV (iPhone) começam com o tamanho do bloco e a marca "ftyp".
  if (mime === 'video/mp4' || mime === 'video/quicktime') {
    return dados.subarray(4, 8).toString('latin1') === 'ftyp';
  }
  if (mime === 'application/pdf') return dados.subarray(0, 5).toString('latin1') === '%PDF-';
  if (mime === 'video/webm') {
    return dados.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }
  return false;
}

export const rotasApoio: Record<string, Manipulador> = {
  'PUT /api/admin/apoio/:uid': (ctx) => {
    const eu = exigirAdmin(ctx);
    const uid = ctx.params.uid.toLowerCase();
    if (!uidValido(uid)) throw new ErroHttp(400, 'Identificador de imagem inválido.');
    const dados = ctx.corpoBruto;
    if (!dados?.length) throw new ErroHttp(400, 'Arquivo vazio.');
    const mime = (ctx.tipoConteudo ?? '').split(';')[0].trim().toLowerCase();
    const ehVideo = MIMES_VIDEO.has(mime);
    const ehPdf = mime === 'application/pdf';
    if ((!ehVideo && !ehPdf && !MIMES_IMAGEM.has(mime)) || !assinaturaConfere(mime, dados)) {
      throw new ErroHttp(400, 'Envie uma imagem (JPEG, PNG, WebP), um vídeo (MP4, WebM, MOV) ou um PDF.');
    }
    const limite = ehVideo
      ? TAMANHO_MAXIMO_VIDEO_APOIO
      : ehPdf
        ? TAMANHO_MAXIMO_PDF_APOIO
        : TAMANHO_MAXIMO_IMAGEM_APOIO;
    if (dados.length > limite) {
      throw new ErroHttp(
        413,
        ehVideo ? 'Vídeo grande demais (máximo 30 MB).' : ehPdf ? 'PDF grande demais (máximo 15 MB).' : 'Imagem grande demais.',
      );
    }
    // O `uid` é a identidade da imagem e vai parar no checklist: não se troca
    // o conteúdo de um já usado, nem se toma o de uma foto de checagem.
    const usado =
      banco.prepare('SELECT 1 FROM apoio_midias WHERE uid = ?').get(uid) ??
      banco.prepare('SELECT 1 FROM sync_midias WHERE uid = ?').get(uid) ??
      banco.prepare('SELECT 1 FROM pdfs_emitidos WHERE uid = ?').get(uid);
    if (usado) throw new ErroHttp(409, 'Identificador de imagem já usado.');

    gravarMidia(uid, dados);
    banco
      .prepare('INSERT INTO apoio_midias (uid, mime, tamanho, criadoEm, criadoPor) VALUES (?, ?, ?, ?, ?)')
      .run(uid, mime, dados.length, Date.now(), eu.id);
    return { src: `/api/apoio/${uid}` };
  },

  'GET /api/apoio/:uid': (ctx) => {
    exigirSessao(ctx);
    const uid = ctx.params.uid.toLowerCase();
    if (!uidValido(uid)) throw new ErroHttp(400, 'Identificador de imagem inválido.');
    const linha = banco.prepare('SELECT mime FROM apoio_midias WHERE uid = ?').get(uid) as
      | { mime: string }
      | undefined;
    const caminho = caminhoMidia(uid);
    if (!linha || !existsSync(caminho)) throw new ErroHttp(404, 'Imagem não encontrada.');
    return new RespostaArquivo(caminho, linha.mime);
  },
};
