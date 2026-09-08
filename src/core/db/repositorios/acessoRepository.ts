import { db } from '../db';
import { normalizarEmail } from '../../auth/acesso';
import type { AcessoMontagem } from '../../access/tipos';

export interface PedidoAcesso {
  email: string;
  painelId: string;
  painelNome: string;
  responsavelEmail: string;
}

/**
 * Permissões de montagem gravadas no aparelho e identificação do montador
 * corrente. Nenhuma tela toca no Dexie: como os demais repositórios, este é
 * o ponto único de troca quando existir servidor central.
 */
export const AcessoRepository = {
  /**
   * Registra (ou reaproveita) o pedido do montador para o painel. Um pedido
   * já aprovado é devolvido intacto — a aprovação é permanente.
   */
  async registrarPedido(pedido: PedidoAcesso): Promise<AcessoMontagem> {
    const email = normalizarEmail(pedido.email);
    const existente = await this.obter(email, pedido.painelId);
    if (existente) return existente;
    const registro: AcessoMontagem = {
      email,
      painelId: pedido.painelId,
      painelNome: pedido.painelNome,
      responsavelEmail: pedido.responsavelEmail,
      solicitadoEm: Date.now(),
      aprovadoEm: null,
    };
    const id = await db.acessos.add(registro);
    return { ...registro, id };
  },

  obter(email: string, painelId: string): Promise<AcessoMontagem | undefined> {
    return db.acessos.where('[email+painelId]').equals([normalizarEmail(email), painelId]).first();
  },

  async estaAprovado(email: string, painelId: string): Promise<boolean> {
    const acesso = await this.obter(email, painelId);
    return Boolean(acesso?.aprovadoEm);
  },

  /** Chamado depois de o código digitado conferir. */
  async aprovar(email: string, painelId: string): Promise<void> {
    const acesso = await this.obter(email, painelId);
    if (!acesso?.id) {
      throw new Error('Pedido de acesso não encontrado neste aparelho.');
    }
    if (acesso.aprovadoEm) return;
    await db.acessos.update(acesso.id, { aprovadoEm: Date.now() });
  },

  listar(): Promise<AcessoMontagem[]> {
    return db.acessos.orderBy('id').reverse().toArray();
  },

  async revogar(id: number): Promise<void> {
    await db.acessos.delete(id);
  },
};
