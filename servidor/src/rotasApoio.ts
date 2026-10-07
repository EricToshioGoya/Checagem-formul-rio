import { existsSync } from 'node:fs';
import { banco } from './banco';
import { caminhoMidia, gravarMidia, uidValido } from './midias';
import { ErroHttp, exigirAdmin, exigirSessao, RespostaArquivo, type Contexto } from './rotas';

/**
 * Imagens de apoio das etapas: a administração envia ao montar o checklist, e
 * o montador vê na etapa — a foto do pino certo, da cor esperada.
 *
 * O aparelho comprime antes (JPEG, como as fotos das checagens) e escolhe o
 * `uid`; o checklist guarda só o endereço `/api/apoio/<uid>`. Ler exige
 * sessão, como o próprio checklist; o aparelho baixa a imagem junto com o
 * checklist e a guarda para o preenchimento offline.
 */

type Manipulador = (ctx: Contexto) => unknown;

/** 5 MB: uma imagem comprimida no aparelho fica bem abaixo. */
export const TAMANHO_MAXIMO_APOIO = 5 * 1024 * 1024;

const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Confere a assinatura do arquivo: o tipo declarado sozinho não basta. */
function assinaturaConfere(mime: string, dados: Buffer): boolean {
  if (mime === 'image/jpeg') return dados[0] === 0xff && dados[1] === 0xd8 && dados[2] === 0xff;
  if (mime === 'image/png') return dados.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') {
    return dados.subarray(0, 4).toString('latin1') === 'RIFF' && dados.subarray(8, 12).toString('latin1') === 'WEBP';
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
    if (dados.length > TAMANHO_MAXIMO_APOIO) throw new ErroHttp(413, 'Imagem grande demais.');
    const mime = (ctx.tipoConteudo ?? '').split(';')[0].trim().toLowerCase();
    if (!MIMES.has(mime) || !assinaturaConfere(mime, dados)) {
      throw new ErroHttp(400, 'Envie uma imagem JPEG, PNG ou WebP.');
    }
    // O `uid` é a identidade da imagem e vai parar no checklist: não se troca
    // o conteúdo de um já usado, nem se toma o de uma foto de checagem.
    const usado =
      banco.prepare('SELECT 1 FROM apoio_midias WHERE uid = ?').get(uid) ??
      banco.prepare('SELECT 1 FROM sync_midias WHERE uid = ?').get(uid);
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
