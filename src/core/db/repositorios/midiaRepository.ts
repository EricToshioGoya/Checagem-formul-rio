import { db } from '../db';
import type { Midia } from '../tipos';

export const MAX_FOTOS_POR_ETAPA = 4;

export const MidiaRepository = {
  listarPorEtapa(preenchimentoId: number, etapaId: string): Promise<Midia[]> {
    return db.midias
      .where('[preenchimentoId+etapaId]')
      .equals([preenchimentoId, etapaId])
      .sortBy('ordem');
  },

  listarPorPreenchimento(preenchimentoId: number): Promise<Midia[]> {
    return db.midias.where('preenchimentoId').equals(preenchimentoId).sortBy('ordem');
  },

  listarPorPreenchimentos(ids: number[]): Promise<Midia[]> {
    if (!ids.length) return Promise.resolve([]);
    return db.midias.where('preenchimentoId').anyOf(ids).toArray();
  },

  contarPorEtapa(preenchimentoId: number, etapaId: string): Promise<number> {
    return db.midias
      .where('[preenchimentoId+etapaId]')
      .equals([preenchimentoId, etapaId])
      .count();
  },

  /**
   * Contagem de mídias por etapa. Percorre apenas as chaves do índice
   * composto: os blobs não são carregados, o que mantém o cálculo de
   * progresso rápido mesmo com centenas de fotos gravadas.
   */
  async mapaContagem(preenchimentoId: number): Promise<Record<string, number>> {
    const mapa: Record<string, number> = {};
    await db.midias
      .where('[preenchimentoId+etapaId]')
      .between([preenchimentoId, ''], [preenchimentoId, '\uffff'])
      .eachKey((chave) => {
        const etapaId = (chave as unknown as [number, string])[1];
        mapa[etapaId] = (mapa[etapaId] ?? 0) + 1;
      });
    return mapa;
  },

  async adicionar(midia: Omit<Midia, 'id' | 'ordem' | 'criadoEm'>): Promise<number> {
    const existentes = await this.contarPorEtapa(midia.preenchimentoId, midia.etapaId);
    return db.midias.add({ ...midia, ordem: existentes, criadoEm: Date.now() });
  },

  async remover(id: number): Promise<void> {
    await db.midias.delete(id);
  },

  async removerPorPreenchimento(preenchimentoId: number): Promise<void> {
    await db.midias.where('preenchimentoId').equals(preenchimentoId).delete();
  },
};
