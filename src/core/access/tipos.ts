/** Permissão de um montador sobre um painel, gravada no aparelho. */
export interface AcessoMontagem {
  id?: number;
  /** E-mail normalizado (minúsculo, sem espaços) — chave junto com o painel. */
  email: string;
  painelId: string;
  painelNome: string;
  responsavelEmail: string;
  solicitadoEm: number;
  /** Nulo enquanto o responsável não aprovar. */
  aprovadoEm: number | null;
  /**
   * Fim do prazo que o código aprovado carregava. Nulo enquanto não há
   * aprovação — e, num registro antigo sem prazo, vale como vencido: nesta
   * versão nenhum acesso é permanente.
   */
  validoAte: number | null;
}
