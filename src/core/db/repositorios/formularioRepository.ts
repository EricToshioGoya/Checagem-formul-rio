import { db } from '../db';
import type { FormularioCache } from '../tipos';

/**
 * Cópia local dos checklists que a administração montou no servidor.
 *
 * Guardar a definição inteira (em vez de um diff) é o que permite abrir o
 * formulário sem rede: o montador baixa uma vez, ao entrar, e trabalha o dia
 * todo dentro do galpão.
 */
export const FormularioRepository = {
  obter(id: string): Promise<FormularioCache | undefined> {
    return db.formularios.get(id);
  },

  listar(): Promise<FormularioCache[]> {
    return db.formularios.toArray();
  },

  listarPorPainel(painelSlug: string): Promise<FormularioCache[]> {
    return db.formularios.where('painelSlug').equals(painelSlug).toArray();
  },

  /**
   * Troca todos os checklists de um painel pelos que vieram do servidor.
   *
   * É substituição, e não união: um checklist excluído pela administração
   * precisa sumir do aparelho, senão o montador continuaria preenchendo algo
   * que não vale mais.
   */
  async substituirPainel(painelSlug: string, formularios: FormularioCache[]): Promise<void> {
    await db.transaction('rw', db.formularios, async () => {
      const atuais = await db.formularios.where('painelSlug').equals(painelSlug).primaryKeys();
      const novos = new Set(formularios.map((f) => f.id));
      const removidos = atuais.filter((id) => !novos.has(id));
      if (removidos.length) await db.formularios.bulkDelete(removidos);
      if (formularios.length) await db.formularios.bulkPut(formularios);
    });
  },
};
