import type { MapaRespostas, ValoresCabecalho } from '../forms/tipos';

export interface Projeto {
  id?: number;
  empresa: string;
  nomeProjeto: string;
  operador: string;
  /**
   * Linha de produto (painel) escolhida no login. Projetos gravados antes da
   * escolha de painel não têm o campo e continuam visíveis em qualquer painel.
   */
  painel?: string;
  /** Modelado desde a v1 para a futura integração SAP/ERP. */
  numeroPedido?: string;
  criadoEm: number;
  atualizadoEm: number;
}

export interface Tag {
  id?: number;
  projetoId: number;
  nome: string;
  ordem: number;
}

export interface Preenchimento {
  id?: number;
  tagId: number;
  formId: string;
  /** Revisão da definição usada — impressa no PDF. */
  formRevisao: string;
  cabecalho: ValoresCabecalho;
  respostas: MapaRespostas;
  atualizadoEm: number;
}

export interface Midia {
  id?: number;
  preenchimentoId: number;
  etapaId: string;
  blob: Blob;
  mime: string;
  largura: number;
  altura: number;
  tamanho: number;
  nomeOriginal?: string;
  criadoEm: number;
  ordem: number;
}

/**
 * Definição de formulário editada pela aba de administração.
 * Quando existe, tem precedência sobre o arquivo em `/public/forms`.
 */
export interface FormularioCustomizado {
  id: string;
  definicao: unknown;
  atualizadoEm: number;
}
