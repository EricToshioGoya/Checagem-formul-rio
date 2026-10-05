import { db } from '../db';

/** Imagens de apoio guardadas no aparelho, pelo endereço que está no checklist. */
export const ApoioRepository = {
  async obter(src: string): Promise<Blob | undefined> {
    return (await db.apoio.get(src))?.blob;
  },

  async gravar(src: string, blob: Blob): Promise<void> {
    await db.apoio.put({ src, blob, baixadoEm: Date.now() });
  },

  async existe(src: string): Promise<boolean> {
    return (await db.apoio.where('src').equals(src).count()) > 0;
  },
};
