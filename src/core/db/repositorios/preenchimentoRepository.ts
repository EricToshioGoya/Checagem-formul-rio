import { db } from '../db';
import type { Preenchimento } from '../tipos';
import type { MapaRespostas, Resposta, ValoresCabecalho } from '../../forms/tipos';

export const PreenchimentoRepository = {
  obter(tagId: number, formId: string): Promise<Preenchimento | undefined> {
    return db.preenchimentos.where('[tagId+formId]').equals([tagId, formId]).first();
  },

  obterPorId(id: number): Promise<Preenchimento | undefined> {
    return db.preenchimentos.get(id);
  },

  listarPorTags(tagIds: number[]): Promise<Preenchimento[]> {
    if (!tagIds.length) return Promise.resolve([]);
    return db.preenchimentos.where('tagId').anyOf(tagIds).toArray();
  },

  /** Uma solicitação de certificação tem exatamente um checklist. */
  obterPorSolicitacao(solicitacaoId: number): Promise<Preenchimento | undefined> {
    return db.preenchimentos.where('solicitacaoId').equals(solicitacaoId).first();
  },

  async obterOuCriarPorSolicitacao(
    solicitacaoId: number,
    formId: string,
    formRevisao: string,
  ): Promise<Preenchimento & { id: number }> {
    const existente = await this.obterPorSolicitacao(solicitacaoId);
    if (existente) {
      if (existente.formRevisao !== formRevisao) {
        await db.preenchimentos.update(existente.id!, { formRevisao });
        existente.formRevisao = formRevisao;
      }
      return existente as Preenchimento & { id: number };
    }
    const novo: Preenchimento = {
      solicitacaoId,
      formId,
      formRevisao,
      cabecalho: {},
      respostas: {},
      atualizadoEm: Date.now(),
    };
    const id = await db.preenchimentos.add(novo);
    return { ...novo, id };
  },

  /** Remove o preenchimento da solicitação e, em cascata, as suas mídias. */
  async excluirPorSolicitacao(solicitacaoId: number): Promise<void> {
    const preenchimentos = await db.preenchimentos
      .where('solicitacaoId')
      .equals(solicitacaoId)
      .toArray();
    const ids = preenchimentos.map((p) => p.id!).filter(Boolean);
    if (!ids.length) return;
    await db.midias.where('preenchimentoId').anyOf(ids).delete();
    await db.preenchimentos.bulkDelete(ids);
  },

  /** Devolve o preenchimento existente ou cria um vazio para o par TAG+formulário. */
  async obterOuCriar(
    tagId: number,
    formId: string,
    formRevisao: string,
  ): Promise<Preenchimento & { id: number }> {
    const existente = await this.obter(tagId, formId);
    if (existente) {
      if (existente.formRevisao !== formRevisao) {
        await db.preenchimentos.update(existente.id!, { formRevisao });
        existente.formRevisao = formRevisao;
      }
      return existente as Preenchimento & { id: number };
    }
    const novo: Preenchimento = {
      tagId,
      formId,
      formRevisao,
      cabecalho: {},
      respostas: {},
      atualizadoEm: Date.now(),
    };
    const id = await db.preenchimentos.add(novo);
    return { ...novo, id };
  },

  async salvarResposta(id: number, etapaId: string, resposta: Resposta | null): Promise<void> {
    await this.salvarRespostas(id, { [etapaId]: resposta });
  },

  /**
   * Grava só as etapas alteradas, lendo o registro atual dentro da transação.
   *
   * Escrever o mapa inteiro a partir do que a tela tem em memória fazia a
   * última gravação apagar o que outra tela — outra aba, ou o aplicativo
   * reaberto — havia acabado de registrar.
   */
  async salvarRespostas(
    id: number,
    alteracoes: Record<string, Resposta | null>,
  ): Promise<void> {
    const etapas = Object.keys(alteracoes);
    if (!etapas.length) return;
    await db.transaction('rw', db.preenchimentos, async () => {
      const atual = await db.preenchimentos.get(id);
      if (!atual) return;
      const respostas: MapaRespostas = { ...atual.respostas };
      for (const etapaId of etapas) {
        const resposta = alteracoes[etapaId];
        if (resposta === null) delete respostas[etapaId];
        else respostas[etapaId] = resposta;
      }
      await db.preenchimentos.update(id, { respostas, atualizadoEm: Date.now() });
    });
  },

  /** Mescla os campos informados no cabeçalho, preservando os demais. */
  async salvarCabecalho(id: number, cabecalho: ValoresCabecalho): Promise<void> {
    await db.transaction('rw', db.preenchimentos, async () => {
      const atual = await db.preenchimentos.get(id);
      if (!atual) return;
      await db.preenchimentos.update(id, {
        cabecalho: { ...atual.cabecalho, ...cabecalho },
        atualizadoEm: Date.now(),
      });
    });
  },
};
