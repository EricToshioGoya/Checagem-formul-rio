import type {
  Certificado,
  DadosSolicitacao,
  EstadoSolicitacao,
  Solicitacao,
} from '../db/tipos';

export interface NovaSolicitacaoEntrada {
  tipoPainel: string;
  formId: string;
  dados: DadosSolicitacao;
}

export interface FiltroSolicitacoes {
  tipoPainel?: string;
  estados?: EstadoSolicitacao[];
}

/**
 * Persistência das solicitações e dos certificados emitidos.
 *
 * O restante do sistema conhece apenas esta interface. A implementação local
 * grava no IndexedDB do aparelho; uma implementação de portal trocaria as
 * mesmas operações por chamadas ao servidor, sem tocar nas telas.
 */
export interface SolicitacaoStore {
  listar(filtro?: FiltroSolicitacoes): Promise<Solicitacao[]>;
  obter(id: number): Promise<Solicitacao | undefined>;
  criar(entrada: NovaSolicitacaoEntrada): Promise<number>;
  atualizarDados(id: number, dados: DadosSolicitacao): Promise<void>;
  excluir(id: number): Promise<void>;
  /** Grava o novo estado e acrescenta o evento correspondente ao histórico. */
  registrarEstado(
    id: number,
    estado: EstadoSolicitacao,
    por: string,
    observacao?: string,
  ): Promise<void>;
  listarCertificados(): Promise<Certificado[]>;
  obterCertificadoPorSolicitacao(solicitacaoId: number): Promise<Certificado | undefined>;
}

export interface ResultadoAprovacao {
  numero: string;
  certificado: Certificado;
}

/**
 * Validação ABB e numeração sequencial.
 *
 * A numeração é global, única e imutável: uma vez atribuída na aprovação, não
 * é reaproveitada nem reescrita. A implementação local resolve o contador em
 * uma transação do IndexedDB; a implementação de servidor resolveria o mesmo
 * contador no banco central, mantendo esta interface.
 */
export interface ServicoValidacao {
  enviarParaValidacao(solicitacaoId: number, por: string): Promise<void>;
  devolver(solicitacaoId: number, apontamentos: string, por: string): Promise<void>;
  aprovar(solicitacaoId: number, por: string): Promise<ResultadoAprovacao>;
  /** Marca o certificado como emitido depois que o arquivo foi gerado. */
  registrarEmissao(solicitacaoId: number, por: string): Promise<void>;
}

/** Estados em que o montador ainda pode editar a solicitação. */
export const ESTADOS_EDITAVEIS: EstadoSolicitacao[] = ['rascunho', 'devolvida'];

export function podeEditar(estado: EstadoSolicitacao): boolean {
  return ESTADOS_EDITAVEIS.includes(estado);
}

export const ROTULO_ESTADO: Record<EstadoSolicitacao, string> = {
  rascunho: 'Rascunho',
  enviada: 'Enviada para validação',
  devolvida: 'Devolvida com apontamentos',
  aprovada: 'Aprovada',
  emitida: 'Certificado emitido',
};
