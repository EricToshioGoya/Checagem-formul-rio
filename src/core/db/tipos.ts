import type { MapaRespostas, ValoresCabecalho } from '../forms/tipos';

export interface Projeto {
  id?: number;
  /**
   * Tipo de painel do catálogo. Ausente nos projetos gravados antes da
   * inclusão dos demais painéis — esses são, por definição, SEN Plus.
   */
  tipoPainel?: string;
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
  /** Preenchimento do fluxo de verificação (projeto → TAG → formulário). */
  tagId?: number;
  /** Preenchimento do fluxo de certificação: uma solicitação, um checklist. */
  solicitacaoId?: number;
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

/** Permissões de um painel editadas na aba de administração. */
export interface PermissaoCustomizada {
  painelId: string;
  permissao: unknown;
  atualizadoEm: number;
}

/**
 * Ciclo de vida da solicitação de certificação.
 *
 * rascunho → enviada → aprovada → emitida
 *                   ↘ devolvida → enviada (correção e reenvio)
 */
export type EstadoSolicitacao =
  | 'rascunho'
  | 'enviada'
  | 'devolvida'
  | 'aprovada'
  | 'emitida';

/** `campoId` → valor informado nos dados da solicitação. */
export type DadosSolicitacao = Record<string, string>;

export interface EventoSolicitacao {
  estado: EstadoSolicitacao;
  em: number;
  por: string;
  observacao?: string;
}

export interface Solicitacao {
  id?: number;
  /** Id do painel no catálogo (`spee`, `spep`, `safr`). */
  tipoPainel: string;
  /** Id do checklist usado — vem do catálogo de painéis. */
  formId: string;
  estado: EstadoSolicitacao;
  dados: DadosSolicitacao;
  /** Apontamentos da última devolução, exibidos ao montador. */
  apontamentos?: string;
  historico: EventoSolicitacao[];
  /** Atribuído na aprovação e imutável a partir dali. */
  numeroCertificado?: string;
  aprovadoEm?: number;
  aprovadoPor?: string;
  criadoEm: number;
  atualizadoEm: number;
}

/**
 * Registro da emissão, exigido para rastreamento. Guarda uma cópia dos dados
 * no momento da aprovação: alterar a solicitação depois não reescreve o
 * certificado já emitido.
 */
export interface Certificado {
  id?: number;
  numero: string;
  solicitacaoId: number;
  tipoPainel: string;
  nomePainel: string;
  projeto: string;
  tagPainel: string;
  clienteFinal: string;
  montador: string;
  correnteNominal: string;
  correnteCurtoCircuito: string;
  responsavel: string;
  emitidoEm: number;
}

/** Contador do número sequencial global dos certificados. */
export interface Contador {
  id: string;
  proximo: number;
}
