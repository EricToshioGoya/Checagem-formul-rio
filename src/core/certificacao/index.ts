import { localServicoValidacao } from './localServicoValidacao';
import { localSolicitacaoStore } from './localSolicitacaoStore';
import type { ServicoValidacao, SolicitacaoStore } from './tipos';

/**
 * Ponto único de composição das camadas de certificação.
 *
 * A decisão entre execução local/offline e portal com servidor ainda não está
 * tomada. Quando estiver, troca-se apenas o que estas duas constantes apontam:
 * nenhuma tela importa a implementação diretamente.
 */
export const solicitacaoStore: SolicitacaoStore = localSolicitacaoStore;
export const servicoValidacao: ServicoValidacao = localServicoValidacao;

export { formatarNumeroCertificado } from './localServicoValidacao';
export { situacaoDaSolicitacao } from './progressoSolicitacao';
export type { SituacaoSolicitacao } from './progressoSolicitacao';
export { ESTADOS_EDITAVEIS, ROTULO_ESTADO, podeEditar } from './tipos';
export type {
  FiltroSolicitacoes,
  NovaSolicitacaoEntrada,
  ResultadoAprovacao,
  ServicoValidacao,
  SolicitacaoStore,
} from './tipos';
