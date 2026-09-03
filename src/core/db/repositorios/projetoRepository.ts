import { db } from '../db';
import type { Projeto, Tag } from '../tipos';

export interface NovoProjetoEntrada {
  empresa: string;
  nomeProjeto: string;
  operador: string;
  numeroPedido?: string;
  tags: string[];
}

export interface ResumoProjeto extends Projeto {
  id: number;
  quantidadeTags: number;
}

async function excluirPreenchimentosDeTags(tagIds: number[]): Promise<void> {
  if (!tagIds.length) return;
  const preenchimentos = await db.preenchimentos.where('tagId').anyOf(tagIds).toArray();
  const ids = preenchimentos.map((p) => p.id!).filter(Boolean);
  if (ids.length) {
    await db.midias.where('preenchimentoId').anyOf(ids).delete();
    await db.preenchimentos.bulkDelete(ids);
  }
}

export const ProjetoRepository = {
  async listar(): Promise<ResumoProjeto[]> {
    const projetos = await db.projetos.orderBy('atualizadoEm').reverse().toArray();
    return Promise.all(
      projetos.map(async (p) => ({
        ...(p as Projeto & { id: number }),
        quantidadeTags: await db.tags.where('projetoId').equals(p.id!).count(),
      })),
    );
  },

  obter(id: number): Promise<Projeto | undefined> {
    return db.projetos.get(id);
  },

  async criar(entrada: NovoProjetoEntrada): Promise<number> {
    const agora = Date.now();
    return db.transaction('rw', db.projetos, db.tags, async () => {
      const projetoId = await db.projetos.add({
        empresa: entrada.empresa.trim(),
        nomeProjeto: entrada.nomeProjeto.trim(),
        operador: entrada.operador.trim(),
        numeroPedido: entrada.numeroPedido?.trim() || undefined,
        criadoEm: agora,
        atualizadoEm: agora,
      });
      await db.tags.bulkAdd(
        entrada.tags.map((nome, i) => ({
          projetoId,
          nome: nome.trim() || `TAG ${i + 1}`,
          ordem: i,
        })),
      );
      return projetoId;
    });
  },

  async atualizar(id: number, dados: Partial<Projeto>): Promise<void> {
    await db.projetos.update(id, { ...dados, atualizadoEm: Date.now() });
  },

  async marcarAlteracao(id: number): Promise<void> {
    await db.projetos.update(id, { atualizadoEm: Date.now() });
  },

  /** Remove o projeto e, em cascata, TAGs, preenchimentos e mídias. */
  async excluir(id: number): Promise<void> {
    await db.transaction(
      'rw',
      db.projetos,
      db.tags,
      db.preenchimentos,
      db.midias,
      async () => {
        const tags = await db.tags.where('projetoId').equals(id).toArray();
        await excluirPreenchimentosDeTags(tags.map((t) => t.id!));
        await db.tags.where('projetoId').equals(id).delete();
        await db.projetos.delete(id);
      },
    );
  },

  listarTags(projetoId: number): Promise<Tag[]> {
    return db.tags
      .where('projetoId')
      .equals(projetoId)
      .sortBy('ordem');
  },

  async adicionarTag(projetoId: number, nome: string): Promise<number> {
    const existentes = await db.tags.where('projetoId').equals(projetoId).count();
    const id = await db.tags.add({ projetoId, nome: nome.trim(), ordem: existentes });
    await this.marcarAlteracao(projetoId);
    return id;
  },

  async renomearTag(tagId: number, nome: string): Promise<void> {
    const tag = await db.tags.get(tagId);
    if (!tag) return;
    await db.tags.update(tagId, { nome: nome.trim() });
    await this.marcarAlteracao(tag.projetoId);
  },

  /** Remove a TAG e, em cascata, seus preenchimentos e mídias. */
  async removerTag(tagId: number): Promise<void> {
    const tag = await db.tags.get(tagId);
    if (!tag) return;
    await db.transaction('rw', db.tags, db.preenchimentos, db.midias, async () => {
      await excluirPreenchimentosDeTags([tagId]);
      await db.tags.delete(tagId);
    });
    await this.marcarAlteracao(tag.projetoId);
  },

  obterTag(tagId: number): Promise<Tag | undefined> {
    return db.tags.get(tagId);
  },
};
