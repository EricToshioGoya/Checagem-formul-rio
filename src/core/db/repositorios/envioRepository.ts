import { db } from '../db';
import type { EnvioPendente } from '../tipos';

/** Fila local dos PDFs que aguardam envio ao arquivo central. */
export const EnvioRepository = {
  async adicionar(envio: Omit<EnvioPendente, 'id'>): Promise<void> {
    await db.enviosPendentes.add(envio);
  },

  listar(): Promise<EnvioPendente[]> {
    return db.enviosPendentes.orderBy('criadoEm').toArray();
  },

  contar(): Promise<number> {
    return db.enviosPendentes.count();
  },

  async remover(id: number): Promise<void> {
    await db.enviosPendentes.delete(id);
  },

  async registrarErro(id: number, mensagem: string): Promise<void> {
    await db.enviosPendentes.update(id, { ultimoErro: mensagem });
  },
};
