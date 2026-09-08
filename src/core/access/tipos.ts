export interface Painel {
  id: string;
  nome: string;
  responsavelEmail: string;
  responsavelNome?: string;
  ativo: boolean;
}

export interface CatalogoPaineis {
  /**
   * URL pública da aplicação, usada no link de aprovação enviado ao
   * responsável. Vazia significa "usar o endereço em que o aplicativo está
   * aberto" — o que só serve ao responsável na modalidade hospedada.
   */
  urlAplicacao?: string;
  paineis: Painel[];
}

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

/** Montador identificado no aparelho e painel escolhido por ele. */
export interface SessaoMontador {
  id: 'atual';
  email: string;
  painelId: string;
}
