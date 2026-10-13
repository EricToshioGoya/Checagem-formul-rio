import type { MapaRespostas, ValoresCabecalho } from '../forms/tipos';

export interface Projeto {
  id?: number;
  empresa: string;
  nomeProjeto: string;
  operador: string;
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

/**
 * PDF gerado que ainda não chegou ao arquivo central. Fica no aparelho até o
 * servidor confirmar o recebimento: a geração funciona offline e o envio
 * acontece quando houver conexão.
 */
export interface EnvioPendente {
  id?: number;
  /** Chave de idempotência: reenviar após uma queda não duplica o registro. */
  idEnvio: string;
  empresa: string;
  projeto: string;
  tipo: string;
  nomeArquivo: string;
  /** Instante de emissão em ISO 8601 — o mesmo impresso no PDF. */
  emitidoEm: string;
  blob: Blob;
  criadoEm: number;
  ultimoErro?: string;
}
