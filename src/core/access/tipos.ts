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
}
