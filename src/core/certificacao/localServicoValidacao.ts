import { db } from '../db/db';
import { NUMERO_CERTIFICADO_DIGITOS, PREFIXO_NUMERO_CERTIFICADO } from '../config';
import { obterPainel } from '../paineis/catalogo';
import type { Certificado } from '../db/tipos';
import { localSolicitacaoStore } from './localSolicitacaoStore';
import type { ResultadoAprovacao, ServicoValidacao } from './tipos';

const CONTADOR_CERTIFICADO = 'certificado';

export function formatarNumeroCertificado(sequencial: number): string {
  return `${PREFIXO_NUMERO_CERTIFICADO}${String(sequencial).padStart(
    NUMERO_CERTIFICADO_DIGITOS,
    '0',
  )}`;
}

/**
 * Implementação local da validação ABB e da numeração sequencial.
 *
 * O número sai de um contador guardado na própria base e é resolvido dentro da
 * transação que grava o certificado: duas aprovações simultâneas na mesma aba
 * não conseguem obter o mesmo número, e o índice único de `certificados.numero`
 * é a última barreira. Substituir esta implementação pela do servidor não
 * altera nenhuma tela — só a linha de composição em `./index.ts`.
 */
export const localServicoValidacao: ServicoValidacao = {
  async enviarParaValidacao(solicitacaoId: number, por: string): Promise<void> {
    const solicitacao = await localSolicitacaoStore.obter(solicitacaoId);
    if (!solicitacao) throw new Error('Solicitação não encontrada.');
    if (solicitacao.estado !== 'rascunho' && solicitacao.estado !== 'devolvida') {
      throw new Error('Só um rascunho ou uma solicitação devolvida pode ser enviada.');
    }
    await localSolicitacaoStore.registrarEstado(solicitacaoId, 'enviada', por);
  },

  async devolver(solicitacaoId: number, apontamentos: string, por: string): Promise<void> {
    const texto = apontamentos.trim();
    if (!texto) throw new Error('Informe os apontamentos da devolução.');
    const solicitacao = await localSolicitacaoStore.obter(solicitacaoId);
    if (!solicitacao) throw new Error('Solicitação não encontrada.');
    if (solicitacao.estado !== 'enviada') {
      throw new Error('Só uma solicitação enviada pode ser devolvida.');
    }
    await localSolicitacaoStore.registrarEstado(solicitacaoId, 'devolvida', por, texto);
  },

  async aprovar(solicitacaoId: number, por: string): Promise<ResultadoAprovacao> {
    const solicitacao = await localSolicitacaoStore.obter(solicitacaoId);
    if (!solicitacao) throw new Error('Solicitação não encontrada.');
    if (solicitacao.numeroCertificado) {
      throw new Error(
        `Solicitação já aprovada sob o número ${solicitacao.numeroCertificado}. O número é imutável.`,
      );
    }
    if (solicitacao.estado !== 'enviada') {
      throw new Error('Só uma solicitação enviada para validação pode ser aprovada.');
    }

    // O catálogo é lido antes da transação: uma leitura de rede dentro de uma
    // transação do Dexie a encerraria por inatividade.
    const painel = await obterPainel(solicitacao.tipoPainel);
    const dados = solicitacao.dados;

    return db.transaction(
      'rw',
      db.contadores,
      db.certificados,
      db.solicitacoes,
      async () => {
        const contador = await db.contadores.get(CONTADOR_CERTIFICADO);
        const sequencial = contador?.proximo ?? 1;
        await db.contadores.put({ id: CONTADOR_CERTIFICADO, proximo: sequencial + 1 });

        const numero = formatarNumeroCertificado(sequencial);
        const agora = Date.now();
        const certificado: Certificado = {
          numero,
          solicitacaoId,
          tipoPainel: solicitacao.tipoPainel,
          nomePainel: painel.nome,
          projeto: dados.projeto ?? '',
          tagPainel: dados.tagPainel ?? '',
          clienteFinal: dados.clienteFinal ?? '',
          montador: dados.montador ?? '',
          correnteNominal: dados.correnteNominal ?? '',
          correnteCurtoCircuito: dados.correnteCurtoCircuito ?? '',
          responsavel: painel.responsavel?.nome ?? por,
          emitidoEm: agora,
        };
        await db.certificados.add(certificado);

        const atual = await db.solicitacoes.get(solicitacaoId);
        await db.solicitacoes.update(solicitacaoId, {
          estado: 'aprovada',
          numeroCertificado: numero,
          aprovadoEm: agora,
          aprovadoPor: por,
          apontamentos: undefined,
          historico: [
            ...(atual?.historico ?? []),
            { estado: 'aprovada', em: agora, por, observacao: `Certificado ${numero}` },
          ],
          atualizadoEm: agora,
        });

        return { numero, certificado };
      },
    );
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
      `Certificado ${solicitacao.numeroCertificado} gerado.`,
    );
  },
};
