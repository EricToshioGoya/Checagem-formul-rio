import { localSolicitacaoStore } from './localSolicitacaoStore';
import type { SolicitacaoStore } from './tipos';

/**
 * Ponto único de composição das camadas de certificação.
 *
 * As solicitações são preparadas no aparelho (`solicitacaoStore`, IndexedDB) e
 * sincronizadas com o servidor, que valida e numera os certificados:
 * `servicoValidacao` para o montador, `validacaoServidor` para a administração.
 */
export const solicitacaoStore: SolicitacaoStore = localSolicitacaoStore;

export { servicoValidacao, atualizarSolicitacoesDoServidor } from './servicoValidacao';
export { excluirSolicitacaoEmTodaParte } from './sincronizacaoCertificacao';
export { situacaoDaSolicitacao } from './progressoSolicitacao';
export type { SituacaoSolicitacao } from './progressoSolicitacao';
export { ESTADOS_EDITAVEIS, ROTULO_ESTADO, podeEditar } from './tipos';
export type {
  FiltroSolicitacoes,
  NovaSolicitacaoEntrada,
  ServicoValidacao,
  SolicitacaoStore,
} from './tipos';
