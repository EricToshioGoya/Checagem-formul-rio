import { db } from '../db';
import type { Projeto, Tag } from '../tipos';

export interface NovoProjetoEntrada {
  empresa: string;
  nomeProjeto: string;
  operador: string;
  numeroPedido?: string;
  painelId?: number;
  painelSlug?: string;
  usuarioId?: number;
  tags: string[];
}

export interface ResumoProjeto extends Projeto {
  id: number;
  quantidadeTags: number;
}

/**
 * Grava o projeto e as suas TAGs. Só é chamada de dentro de uma transação
 * 'rw' sobre `projetos` e `tags` — quem chama abre a transação.
 */
async function criarEmTransacao(entrada: NovoProjetoEntrada): Promise<number> {
  const agora = Date.now();
  const projetoId = await db.projetos.add({
    empresa: entrada.empresa.trim(),
    nomeProjeto: entrada.nomeProjeto.trim(),
    operador: entrada.operador.trim(),
    numeroPedido: entrada.numeroPedido?.trim() || undefined,
    painelId: entrada.painelId,
    painelSlug: entrada.painelSlug,
    usuarioId: entrada.usuarioId,
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
}

/** Disparado a cada alteração de projeto: a sincronização escuta e agenda o envio. */
export const EVENTO_DADOS_ALTERADOS = 'dados-alterados';

function avisarAlteracao(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_DADOS_ALTERADOS));
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
  /**
   * Projetos visíveis para o usuário: os dele, mais os órfãos gravados antes
   * de existir login, que não pertencem a ninguém.
   */
  async listar(usuarioId?: number): Promise<ResumoProjeto[]> {
    const todos = await db.projetos.orderBy('atualizadoEm').reverse().toArray();
    const projetos =
      usuarioId === undefined
        ? todos
        : todos.filter((p) => p.usuarioId === undefined || p.usuarioId === usuarioId);
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

  /**
   * Projeto, desde que seja deste usuário (ou órfão, de antes do login).
   * Devolve `undefined` para o projeto de outra pessoa, de modo que digitar
   * a URL de um projeto alheio no aparelho compartilhado não abra nada.
   */
  async obterDoUsuario(id: number, usuarioId: number): Promise<Projeto | undefined> {
    const projeto = await db.projetos.get(id);
    if (!projeto) return undefined;
    if (projeto.usuarioId !== undefined && projeto.usuarioId !== usuarioId) return undefined;
    return projeto;
  },

  /**
   * Projeto local do painel para este usuário, criando-o na primeira abertura.
   *
   * Busca e criação na mesma transação: dois toques seguidos em "Abrir
   * checagens" criariam dois projetos para o mesmo painel, e o montador
   * preencheria um enquanto a tela mostra o outro.
   */
  async obterOuCriarPorPainel(
    usuarioId: number,
    painelId: number,
    entrada: Omit<NovoProjetoEntrada, 'painelId' | 'usuarioId'>,
  ): Promise<number> {
    return db.transaction('rw', db.projetos, db.tags, async () => {
      const existente = await db.projetos
        .where('[usuarioId+painelId]')
        .equals([usuarioId, painelId])
        .first();
      if (existente?.id) return existente.id;
      return criarEmTransacao({ ...entrada, painelId, usuarioId });
    });
  },

  async criar(entrada: NovoProjetoEntrada): Promise<number> {
    return db.transaction('rw', db.projetos, db.tags, async () => {
      return criarEmTransacao(entrada);
    });
  },

  async atualizar(id: number, dados: Partial<Projeto>): Promise<void> {
    await db.projetos.update(id, { ...dados, atualizadoEm: Date.now() });
    avisarAlteracao();
  },

  /**
   * Toda alteração do projeto passa por aqui (respostas, fotos, TAGs): é o
   * `atualizadoEm` mais novo que o `sincronizadoEm` que diz "falta enviar".
   */
  async marcarAlteracao(id: number): Promise<void> {
    await db.projetos.update(id, { atualizadoEm: Date.now() });
    avisarAlteracao();
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
