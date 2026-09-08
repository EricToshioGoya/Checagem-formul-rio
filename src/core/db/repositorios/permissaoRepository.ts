import { db } from '../db';
import type { PermissaoCustomizada } from '../tipos';

/**
 * Permissões editadas pela aba de administração, por painel. Como nos
 * formulários, guarda-se o objeto inteiro: exportar e importar ficam
 * simétricos, e publicar é copiar o JSON exportado para `/public/paineis`.
 */
export const PermissaoRepository = {
  obter(painelId: string): Promise<PermissaoCustomizada | undefined> {
    return db.permissoes.get(painelId);
  },

  listar(): Promise<PermissaoCustomizada[]> {
    return db.permissoes.toArray();
  },

  async salvar(painelId: string, permissao: unknown): Promise<void> {
    await db.permissoes.put({ painelId, permissao, atualizadoEm: Date.now() });
  },

  /** Descarta a edição local e devolve o painel ao arquivo publicado. */
  async restaurarPublicada(painelId: string): Promise<void> {
    await db.permissoes.delete(painelId);
  },
};
