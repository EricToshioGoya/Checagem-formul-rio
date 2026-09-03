import type { Projeto } from '../db/tipos';

export interface OpcoesExportacao {
  /** Formulários incluídos. Vazio significa todos os ativos. */
  formIds?: string[];
  /** Fotos incorporadas ao PDF ou entregues em ZIP separado. */
  incluirFotos?: boolean;
}

/**
 * Ponto de extensão 3 da especificação: um destino novo (SharePoint, e-mail,
 * API) implementa esta interface e passa a ser oferecido na tela de geração.
 * `PdfExport` é a implementação da v1.
 */
export interface ExportTarget {
  readonly nome: string;
  exportar(projeto: Projeto, opcoes?: OpcoesExportacao): Promise<void>;
}
