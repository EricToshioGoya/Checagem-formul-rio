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
   * já existente é devolvido intacto, inclusive com o prazo em curso.
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
      validoAte: null,
    };
    const id = await db.acessos.add(registro);
    return { ...registro, id };
  },

  obter(email: string, painelId: string): Promise<AcessoMontagem | undefined> {
    return db.acessos.where('[email+painelId]').equals([normalizarEmail(email), painelId]).first();
  },

  /**
   * Até quando o acesso vale; nulo quando não há aprovação ou o prazo já
   * venceu. Registro sem `validoAte` conta como vencido.
   */
  async validadeDe(email: string, painelId: string): Promise<number | null> {
    const acesso = await this.obter(email, painelId);
    if (!acesso?.aprovadoEm || !acesso.validoAte) return null;
    return acesso.validoAte > Date.now() ? acesso.validoAte : null;
  },

  async estaAprovado(email: string, painelId: string): Promise<boolean> {
    return (await this.validadeDe(email, painelId)) !== null;
  },

  /**
   * Chamado depois de o código digitado conferir. Renovar é aprovar de novo
   * com o prazo do código novo — por isso o registro é sempre reescrito.
   */
  async aprovar(email: string, painelId: string, validoAte: number): Promise<void> {
    const acesso = await this.obter(email, painelId);
    if (!acesso?.id) {
      throw new Error('Pedido de acesso não encontrado neste aparelho.');
    }
    await db.acessos.update(acesso.id, { aprovadoEm: Date.now(), validoAte });
  },

  listar(): Promise<AcessoMontagem[]> {
    return db.acessos.orderBy('id').reverse().toArray();
  },

  async revogar(id: number): Promise<void> {
    await db.acessos.delete(id);
  },
};
