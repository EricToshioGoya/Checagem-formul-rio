import { api } from '../api/cliente';
import { novoUid } from '../db/db';
import { ApoioRepository } from '../db/repositorios';
import type { DefinicaoFormulario } from '../forms/tipos';
import { normalizarImagem } from './imagem';

/**
 * Imagens de apoio das etapas. A administração envia ao montar o checklist; o
 * checklist guarda só o endereço `/api/apoio/<uid>`, e o aparelho do montador
 * baixa a imagem junto com o checklist e a guarda para usar sem rede.
 *
 * Imagens com caminho dentro da aplicação (`/media/…`, as que vêm com o
 * publicado) seguem servidas como antes, pelo próprio aplicativo.
 */

const PREFIXO = '/api/apoio/';

export function ehApoioDoServidor(src: string): boolean {
  return src.startsWith(PREFIXO);
}

/** Comprime e envia a imagem; devolve o endereço a gravar no checklist. */
export async function enviarImagemApoio(arquivo: File): Promise<string> {
  const { blob } = await normalizarImagem(arquivo);
  const src = `${PREFIXO}${novoUid()}`;
  await api.enviarArquivo(`/api/admin${src.slice('/api'.length)}`, blob);
  // Quem enviou já tem a imagem: guarda para a pré-visualização não baixar de volta.
  await ApoioRepository.gravar(src, blob);
  return src;
}

/** A imagem, do aparelho ou, se ainda não estiver nele, do servidor. */
export async function obterImagemApoio(src: string): Promise<Blob> {
  const guardada = await ApoioRepository.obter(src);
  if (guardada) return guardada;
  const blob = await api.baixarArquivo(src);
  await ApoioRepository.gravar(src, blob);
  return blob;
}

/**
 * Baixa as imagens de apoio que o aparelho ainda não tem. Roda quando o
 * checklist é sincronizado, que é quando há rede: a falha de uma imagem não
 * impede as outras nem o checklist — ela é tentada de novo na próxima vez.
 */
export async function baixarImagensDoChecklist(definicao: DefinicaoFormulario): Promise<void> {
  const enderecos = new Set<string>();
  for (const secao of definicao.secoes) {
    for (const etapa of secao.etapas) {
      for (const m of etapa.midiaApoio ?? []) {
        if (m.tipo === 'imagem' && ehApoioDoServidor(m.src)) enderecos.add(m.src);
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
