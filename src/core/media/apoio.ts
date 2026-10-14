import { api } from '../api/cliente';
import { novoUid } from '../db/db';
import { ApoioRepository } from '../db/repositorios';
import type { DefinicaoFormulario } from '../forms/tipos';
import { normalizarImagem } from './imagem';

/**
 * Imagens e vídeos de apoio das etapas. A administração envia ao montar o
 * checklist; o checklist guarda só o endereço `/api/apoio/<uid>`, e o aparelho
 * do montador baixa o arquivo junto com o checklist e a guarda para usar sem rede.
 *
 * Imagens com caminho dentro da aplicação (`/media/…`, as que vêm com o
 * publicado) seguem servidas como antes, pelo próprio aplicativo.
 */

const PREFIXO = '/api/apoio/';

export function ehApoioDoServidor(src: string): boolean {
  return src.startsWith(PREFIXO);
}

/** Mesmo limite do servidor: avisa antes de subir um arquivo que seria recusado. */
export const TAMANHO_MAXIMO_VIDEO_APOIO = 30 * 1024 * 1024;

const TIPOS_VIDEO: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const TIPOS_VIDEO_ACEITOS = new Set(Object.values(TIPOS_VIDEO));

/** Tipo MIME do vídeo; alguns navegadores deixam o `type` vazio para .mov/.mp4. */
export function mimeDoVideo(arquivo: File): string | null {
  if (TIPOS_VIDEO_ACEITOS.has(arquivo.type)) return arquivo.type;
  const extensao = arquivo.name.split('.').pop()?.toLowerCase() ?? '';
  return TIPOS_VIDEO[extensao] ?? null;
}


/** Mesmo limite do servidor para o PDF de apoio. */
export const TAMANHO_MAXIMO_PDF_APOIO = 15 * 1024 * 1024;

export function ehPdfDeApoio(arquivo: File): boolean {
  return arquivo.type === 'application/pdf' || arquivo.name.toLowerCase().endsWith('.pdf');
}

/** Envia o PDF como está; devolve o endereço a gravar no checklist. */
export async function enviarPdfApoio(arquivo: File): Promise<string> {
  if (!ehPdfDeApoio(arquivo)) throw new Error('Escolha um arquivo PDF.');
  if (arquivo.size > TAMANHO_MAXIMO_PDF_APOIO) throw new Error('O PDF passa de 15 MB.');
  return enviarBlob(new Blob([arquivo], { type: 'application/pdf' }));
}

export function ehVideo(arquivo: File): boolean {
  return mimeDoVideo(arquivo) !== null;
}

async function enviarBlob(blob: Blob): Promise<string> {
  const src = `${PREFIXO}${novoUid()}`;
  await api.enviarArquivo(`/api/admin${src.slice('/api'.length)}`, blob);
  // Quem enviou já tem o arquivo: guarda para a pré-visualização não baixar de volta.
  await ApoioRepository.gravar(src, blob);
  return src;
}

/** Comprime e envia a imagem; devolve o endereço a gravar no checklist. */
export async function enviarImagemApoio(arquivo: File): Promise<string> {
  const { blob } = await normalizarImagem(arquivo);
  return enviarBlob(blob);
}

/** Envia o vídeo como foi gravado; devolve o endereço a gravar no checklist. */
export async function enviarVideoApoio(arquivo: File): Promise<string> {
  const mime = mimeDoVideo(arquivo);
  if (!mime) throw new Error('Escolha um vídeo MP4, WebM ou MOV.');
  if (arquivo.size > TAMANHO_MAXIMO_VIDEO_APOIO) {
    throw new Error('O vídeo passa de 30 MB. Reduza a duração ou a resolução e tente de novo.');
  }
  return enviarBlob(new Blob([arquivo], { type: mime }));
}

/** A imagem ou o vídeo, do aparelho ou, se ainda não estiver nele, do servidor. */
export async function obterImagemApoio(src: string): Promise<Blob> {
  const guardada = await ApoioRepository.obter(src);
  if (guardada) return guardada;
  const blob = await api.baixarArquivo(src);
  await ApoioRepository.gravar(src, blob);
  return blob;
}

/**
 * Baixa as imagens, vídeos e PDFs de apoio que o aparelho ainda não tem. Roda quando o
 * checklist é sincronizado, que é quando há rede: a falha de uma imagem não
 * impede as outras nem o checklist — ela é tentada de novo na próxima vez.
 */
export async function baixarImagensDoChecklist(definicao: DefinicaoFormulario): Promise<void> {
  const enderecos = new Set<string>();
  for (const secao of definicao.secoes) {
    for (const etapa of secao.etapas) {
      for (const m of etapa.midiaApoio ?? []) {
        if (ehApoioDoServidor(m.src)) {
          enderecos.add(m.src);
        }
      }
    }
  }
  for (const src of enderecos) {
    try {
      if (!(await ApoioRepository.existe(src))) await obterImagemApoio(src);
    } catch {
      // Sem rede ou imagem removida: a etapa mostra o aviso no lugar dela.
    }
  }
}
