import { db } from '../db';
import type { Projeto, Tag } from '../tipos';
import type { ValoresCabecalho } from '../../forms/tipos';

/** TAG a gravar, com os checklists escolhidos e o cabeçalho de cada um. */
export interface NovaTagEntrada {
  nome: string;
  /** Ausente: a TAG segue com todos os checklists do painel. */
  formIds?: string[];
  /** Checklists que já nascem com os dados do painel no cabeçalho. */
  preenchimentos?: Array<{ formId: string; formRevisao: string; cabecalho: ValoresCabecalho }>;
}

export interface NovoProjetoEntrada {
  empresa: string;
  nomeProjeto: string;
  operador: string;
  numeroPedido?: string;
  painelId?: number;
  painelSlug?: string;
  usuarioId?: number;
  tags: NovaTagEntrada[];
}

export interface ResumoProjeto extends Projeto {
  id: number;
  quantidadeTags: number;
}

/**
 * Grava a TAG e os preenchimentos com que ela nasce. Só é chamada de dentro de
 * uma transação 'rw' sobre `tags` e `preenchimentos`.
 */
async function gravarTagEmTransacao(
  projetoId: number,
  entrada: NovaTagEntrada,
  ordem: number,
): Promise<number> {
  const agora = Date.now();
  const tagId = await db.tags.add({
    projetoId,
    nome: entrada.nome.trim() || `TAG ${ordem + 1}`,
    ordem,
    formIds: entrada.formIds ? [...entrada.formIds] : undefined,
  });
  if (entrada.preenchimentos?.length) {
    await db.preenchimentos.bulkAdd(
      entrada.preenchimentos.map((p) => ({
        tagId,
        formId: p.formId,
        formRevisao: p.formRevisao,
        cabecalho: { ...p.cabecalho },
        respostas: {},
        atualizadoEm: agora,
      })),
    );
  }
  return tagId;
}

/**
 * Grava o projeto e as suas TAGs. Só é chamada de dentro de uma transação
 * 'rw' sobre `projetos`, `tags` e `preenchimentos` — quem chama abre a
 * transação.
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
  for (const [i, tag] of entrada.tags.entries()) {
    await gravarTagEmTransacao(projetoId, tag, i);
  }
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

  /** Projetos do usuário num painel, do alterado por último ao mais antigo. */
  async listarDoPainel(usuarioId: number, painelId: number): Promise<ResumoProjeto[]> {
    const projetos = await db.projetos
      .where('[usuarioId+painelId]')
      .equals([usuarioId, painelId])
      .toArray();
    projetos.sort((a, b) => b.atualizadoEm - a.atualizadoEm);
    return Promise.all(
      projetos.map(async (p) => ({
        ...(p as Projeto & { id: number }),
        quantidadeTags: await db.tags.where('projetoId').equals(p.id!).count(),
      })),
    );
  },

  async criar(entrada: NovoProjetoEntrada): Promise<number> {
    const id = await db.transaction('rw', db.projetos, db.tags, db.preenchimentos, async () => {
      return criarEmTransacao(entrada);
    });
    avisarAlteracao();
    return id;
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

  async adicionarTag(projetoId: number, entrada: NovaTagEntrada): Promise<number> {
    const id = await db.transaction('rw', db.tags, db.preenchimentos, async () => {
      // A ordem segue a maior existente: contar repetiria a de uma TAG depois
      // que outra do meio fosse removida.
      const tags = await db.tags.where('projetoId').equals(projetoId).toArray();
      const ordem = tags.reduce((maior, t) => Math.max(maior, t.ordem + 1), 0);
      return gravarTagEmTransacao(projetoId, entrada, ordem);
    });
    await this.marcarAlteracao(projetoId);
    return id;
  },

  /**
   * Troca os checklists da TAG. Desmarcar não apaga nada: o que já foi
   * respondido fica guardado e volta se o checklist for marcado de novo.
   * `novos` são os preenchimentos dos checklists que entram, já com o
   * cabeçalho — só são gravados se o checklist ainda não tiver preenchimento.
   */
  async definirChecklistsDaTag(
    tagId: number,
    formIds: string[],
    novos: NonNullable<NovaTagEntrada['preenchimentos']> = [],
  ): Promise<void> {
    const tag = await db.tags.get(tagId);
    if (!tag) return;
    await db.transaction('rw', db.tags, db.preenchimentos, async () => {
      await db.tags.update(tagId, { formIds: [...formIds] });
      for (const p of novos) {
        const existe = await db.preenchimentos.where('[tagId+formId]').equals([tagId, p.formId]).first();
        if (existe) continue;
        await db.preenchimentos.add({
          tagId,
          formId: p.formId,
          formRevisao: p.formRevisao,
          cabecalho: { ...p.cabecalho },
          respostas: {},
          atualizadoEm: Date.now(),
        });
      }
    });
    await this.marcarAlteracao(tag.projetoId);
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
