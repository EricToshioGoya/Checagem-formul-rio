import { db } from '../db/db';
import { PreenchimentoRepository } from '../db/repositorios';
import type {
  Certificado,
  DadosSolicitacao,
  EstadoSolicitacao,
  Solicitacao,
} from '../db/tipos';
import type {
  FiltroSolicitacoes,
  NovaSolicitacaoEntrada,
  SolicitacaoStore,
} from './tipos';

/** Implementação de `SolicitacaoStore` sobre o IndexedDB do aparelho. */
export const localSolicitacaoStore: SolicitacaoStore = {
  async listar(filtro: FiltroSolicitacoes = {}): Promise<Solicitacao[]> {
    const todas = await db.solicitacoes.orderBy('atualizadoEm').reverse().toArray();
    return todas.filter(
      (s) =>
        (!filtro.tipoPainel || s.tipoPainel === filtro.tipoPainel) &&
        (!filtro.estados?.length || filtro.estados.includes(s.estado)),
    );
  },

  obter(id: number): Promise<Solicitacao | undefined> {
    return db.solicitacoes.get(id);
  },

  async criar(entrada: NovaSolicitacaoEntrada): Promise<number> {
    const agora = Date.now();
    return db.solicitacoes.add({
      tipoPainel: entrada.tipoPainel,
      formId: entrada.formId,
      estado: 'rascunho',
      dados: entrada.dados,
      historico: [{ estado: 'rascunho', em: agora, por: entrada.dados.operador ?? '' }],
      criadoEm: agora,
      atualizadoEm: agora,
    });
  },

  async atualizarDados(id: number, dados: DadosSolicitacao): Promise<void> {
    await db.solicitacoes.update(id, { dados, atualizadoEm: Date.now() });
  },

  /** Remove a solicitação e, em cascata, o seu preenchimento e as mídias. */
  async excluir(id: number): Promise<void> {
    await db.transaction('rw', db.solicitacoes, db.preenchimentos, db.midias, async () => {
      await PreenchimentoRepository.excluirPorSolicitacao(id);
      await db.solicitacoes.delete(id);
    });
  },

  async registrarEstado(
    id: number,
    estado: EstadoSolicitacao,
    por: string,
    observacao?: string,
  ): Promise<void> {
    await db.transaction('rw', db.solicitacoes, async () => {
      const atual = await db.solicitacoes.get(id);
      if (!atual) throw new Error('Solicitação não encontrada.');
      const agora = Date.now();
      await db.solicitacoes.update(id, {
        estado,
        // O apontamento fica visível enquanto a solicitação estiver devolvida.
        apontamentos: estado === 'devolvida' ? observacao : undefined,
        historico: [...atual.historico, { estado, em: agora, por, observacao }],
        atualizadoEm: agora,
      });
    });
  },

  listarCertificados(): Promise<Certificado[]> {
    return db.certificados.orderBy('emitidoEm').reverse().toArray();
  },

  obterCertificadoPorSolicitacao(solicitacaoId: number): Promise<Certificado | undefined> {
    return db.certificados.where('solicitacaoId').equals(solicitacaoId).first();
  },
};
