import { localSolicitacaoStore } from './localSolicitacaoStore';
import {
  atualizarSolicitacoesDoServidor,
  pedirValidacaoNoServidor,
  registrarEmissaoNoServidor,
} from './sincronizacaoCertificacao';
import type { ServicoValidacao } from './tipos';

/**
 * Validação ABB do lado do montador. Devolver e aprovar (com a numeração do
 * certificado) acontecem no servidor, pela administração; o aparelho só pede a
 * validação e reflete a resposta.
 */
export const servicoValidacao: ServicoValidacao = {
  async enviarParaValidacao(solicitacaoId: number, por: string): Promise<void> {
    const solicitacao = await localSolicitacaoStore.obter(solicitacaoId);
    if (!solicitacao) throw new Error('Solicitação não encontrada.');
    if (solicitacao.estado !== 'rascunho' && solicitacao.estado !== 'devolvida') {
      throw new Error('Só um rascunho ou uma solicitação devolvida pode ser enviada.');
    }
    // O servidor decide: sem conexão, nada é marcado como enviado.
    await pedirValidacaoNoServidor(solicitacao);
    await localSolicitacaoStore.registrarEstado(solicitacaoId, 'enviada', por);
  },

  async registrarEmissao(solicitacaoId: number, por: string): Promise<void> {
    const solicitacao = await localSolicitacaoStore.obter(solicitacaoId);
    if (!solicitacao) throw new Error('Solicitação não encontrada.');
    if (!solicitacao.numeroCertificado) {
      throw new Error('A solicitação ainda não foi aprovada.');
    }
    if (solicitacao.estado === 'emitida') return;
    await localSolicitacaoStore.registrarEstado(
      solicitacaoId,
      'emitida',
      por,
      `Certificado ${solicitacao.numeroCertificado} baixado.`,
    );
    try {
      await registrarEmissaoNoServidor(solicitacao);
    } catch {
      // O arquivo já foi baixado; se o registro não chegar ao servidor, ele
      // continua em "aprovada" até o próximo download. O número não muda.
    }
  },
};

/** Traz do servidor o que mudou nas solicitações da conta (aprovada, devolvida…). */
export { atualizarSolicitacoesDoServidor };
