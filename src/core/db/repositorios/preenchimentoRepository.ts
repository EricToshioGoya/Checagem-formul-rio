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

  /** Como `obterOuCriar`, para o checklist de uma solicitação de certificação. */
  async obterOuCriarPorSolicitacao(
    solicitacaoId: number,
    formId: string,
    formRevisao: string,
  ): Promise<Preenchimento & { id: number }> {
    return db.transaction('rw', db.preenchimentos, async () => {
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
    });
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

  /**
   * Devolve o preenchimento existente ou cria um vazio para o par TAG+formulário.
   *
   * Leitura e criação ficam na mesma transação: duas chamadas concorrentes para
   * a mesma TAG+formulário — o efeito remontado pelo StrictMode, duas abas, um
   * toque duplo — criariam duas linhas para o mesmo par, e o `.first()` das
   * leituras seguintes devolveria a linha vazia, escondendo as respostas.
   */
  async obterOuCriar(
    tagId: number,
    formId: string,
    formRevisao: string,
  ): Promise<Preenchimento & { id: number }> {
    return db.transaction('rw', db.preenchimentos, async () => {
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
    });
  },

  /**
   * Grava só o que a pessoa mudou, por cima do que já está guardado: o que a
   * sincronização trouxe de outro aparelho enquanto a tela estava aberta não se
   * perde. `null` apaga a resposta.
   */
  async aplicarMudancasRespostas(id: number, mudancas: Record<string, Resposta | null>): Promise<void> {
    await db.transaction('rw', db.preenchimentos, async () => {
      const atual = await db.preenchimentos.get(id);
      if (!atual) return;
      const respostas: MapaRespostas = { ...atual.respostas };
      for (const [etapaId, resposta] of Object.entries(mudancas)) {
        if (resposta === null) delete respostas[etapaId];
        else respostas[etapaId] = resposta;
      }
      await db.preenchimentos.update(id, { respostas, atualizadoEm: Date.now() });
    });
  },

  /** Igual às respostas: só os campos do cabeçalho que a pessoa mudou. */
  async aplicarMudancasCabecalho(id: number, mudancas: Record<string, string | null>): Promise<void> {
    await db.transaction('rw', db.preenchimentos, async () => {
      const atual = await db.preenchimentos.get(id);
      if (!atual) return;
      const cabecalho: ValoresCabecalho = { ...atual.cabecalho };
      for (const [campoId, valor] of Object.entries(mudancas)) {
        if (valor === null) delete cabecalho[campoId];
        else cabecalho[campoId] = valor;
      }
      await db.preenchimentos.update(id, { cabecalho, atualizadoEm: Date.now() });
    });
  },
};
