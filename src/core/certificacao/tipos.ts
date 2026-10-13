import type {
  Certificado,
  DadosSolicitacao,
  EstadoSolicitacao,
  Solicitacao,
} from '../db/tipos';

export interface NovaSolicitacaoEntrada {
  tipoPainel: string;
  formId: string;
  usuarioId?: number;
  dados: DadosSolicitacao;
}

export interface FiltroSolicitacoes {
  tipoPainel?: string;
  /**
   * Só as da conta indicada — e as anteriores ao login, que não têm dono.
   * Omitido, lista todas: é o que a validação ABB enxerga.
   */
  usuarioId?: number;
  estados?: EstadoSolicitacao[];
}

/**
 * Persistência das solicitações e dos certificados emitidos.
 *
 * O restante do sistema conhece apenas esta interface. A cópia do aparelho
 * fica no IndexedDB; a validação e a numeração são do servidor.
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

/**
 * Validação ABB, do lado do montador.
 *
 * A numeração é global, única e imutável, atribuída pelo servidor na aprovação
 * (ver `validacaoServidor.ts`, usado pela administração).
 */
export interface ServicoValidacao {
  /** Sobe a solicitação e pede a validação; exige conexão com o servidor. */
  enviarParaValidacao(solicitacaoId: number, por: string): Promise<void>;
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
