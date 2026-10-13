export interface OpcoesExportacao {
  /** Formulários incluídos. Vazio significa todos os ativos. */
  formIds?: string[];
  /** Fotos incorporadas ao PDF ou entregues em ZIP separado. */
  incluirFotos?: boolean;
}
