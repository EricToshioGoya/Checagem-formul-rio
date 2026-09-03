import { db } from '../db';
import type { FormularioCustomizado } from '../tipos';

/**
 * Definições editadas pela aba de administração. Guardar o JSON completo
 * (em vez de um diff) mantém exportação e importação simétricas.
 */
export const FormularioRepository = {
  obter(id: string): Promise<FormularioCustomizado | undefined> {
    return db.formulariosCustom.get(id);
  },

  listar(): Promise<FormularioCustomizado[]> {
    return db.formulariosCustom.toArray();
  },

  async salvar(id: string, definicao: unknown): Promise<void> {
    await db.formulariosCustom.put({ id, definicao, atualizadoEm: Date.now() });
  },

  /** Descarta a customização e devolve o formulário ao arquivo original. */
  async restaurarOriginal(id: string): Promise<void> {
    await db.formulariosCustom.delete(id);
  },
};
