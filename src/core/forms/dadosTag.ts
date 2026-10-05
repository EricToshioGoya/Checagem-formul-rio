import {
  PreenchimentoRepository,
  ProjetoRepository,
  type NovaTagEntrada,
} from '../db/repositorios';
import type { Preenchimento } from '../db/tipos';
import { carregarFormulario } from './catalogo';
import type { CampoCabecalho, DefinicaoFormulario, ValoresCabecalho } from './tipos';

/**
 * Dados do painel de uma TAG: fabricante, cliente final, tensões, norma…
 *
 * Cada checklist declara os campos do seu cabeçalho, e vários se repetem de
 * um checklist para outro. Para o montador eles são uma coisa só — os dados
 * daquele painel —, informados uma vez ao cadastrar a TAG e gravados no
 * cabeçalho de cada checklist escolhido.
 *
 * Só é o mesmo campo quando é igual nos dois checklists: mesmo id, mesmo tipo
 * e, numa seleção, as mesmas opções. "Norma atendida" com listas diferentes
 * na montagem e na rotina são duas perguntas, e cada uma tem o seu campo.
 */

/** Dois campos de checklists diferentes que valem como um só. */
function compativeis(a: CampoCabecalho, b: CampoCabecalho): boolean {
  if (a.tipo !== b.tipo) return false;
  if (a.tipo !== 'selecao') return true;
  const opcoes = (c: CampoCabecalho) => [...(c.opcoes ?? [])].sort().join('\n');
  return opcoes(a) === opcoes(b);
}

/** Chave, nos dados da TAG, do campo que é só deste checklist. */
function chaveSeparada(formId: string, campoId: string): string {
  return `${formId}::${campoId}`;
}

/**
 * Campos dos checklists, na ordem em que aparecem. O campo igual em todos
 * aparece uma vez; o que diverge aparece uma vez por checklist, com o tipo
 * do checklist no rótulo.
 */
export function camposDaTag(definicoes: readonly DefinicaoFormulario[]): CampoCabecalho[] {
  const grupos = new Map<string, Array<{ definicao: DefinicaoFormulario; campo: CampoCabecalho }>>();
  for (const definicao of definicoes) {
    for (const campo of definicao.cabecalho) {
      const grupo = grupos.get(campo.id) ?? [];
      grupo.push({ definicao, campo });
      grupos.set(campo.id, grupo);
    }
  }
  const campos: CampoCabecalho[] = [];
  for (const grupo of grupos.values()) {
    if (grupo.every((g) => compativeis(grupo[0].campo, g.campo))) {
      campos.push(grupo[0].campo);
      continue;
    }
    for (const { definicao, campo } of grupo) {
      campos.push({
        ...campo,
        id: chaveSeparada(definicao.id, campo.id),
        rotulo: `${campo.rotulo} — ${definicao.tipo === 'montagem' ? 'Montagem' : 'Rotina'}`,
      });
    }
  }
  return campos;
}

/** Ids dos campos ainda vazios: no cadastro da TAG, todos são obrigatórios. */
export function camposVazios(
  campos: readonly CampoCabecalho[],
  dados: ValoresCabecalho,
): string[] {
  return campos.filter((c) => !(dados[c.id] ?? '').trim()).map((c) => c.id);
}

/** Valor que o campo aceita: numa seleção, só uma das opções dele. */
function valorAceito(campo: CampoCabecalho, valor: string | undefined): string | null {
  const v = valor?.trim();
  if (!v) return null;
  if (campo.tipo === 'selecao' && !(campo.opcoes ?? []).includes(v)) return null;
  return v;
}

/** O que dos dados do painel cabe no cabeçalho deste checklist. */
function cabecalhoDo(definicao: DefinicaoFormulario, dados: ValoresCabecalho): ValoresCabecalho {
  const cabecalho: ValoresCabecalho = {};
  for (const c of definicao.cabecalho) {
    const valor = valorAceito(c, dados[chaveSeparada(definicao.id, c.id)] ?? dados[c.id]);
    if (valor) cabecalho[c.id] = valor;
  }
  return cabecalho;
}

/** TAG pronta para gravar: cada checklist escolhido nasce com os dados no cabeçalho. */
export async function prepararTag(
  nome: string,
  formIds: string[] | undefined,
  dados: ValoresCabecalho,
): Promise<NovaTagEntrada> {
  if (!formIds) return { nome };
  const preenchimentos: NonNullable<NovaTagEntrada['preenchimentos']> = [];
  for (const formId of formIds) {
    const definicao = await carregarFormulario(formId);
    preenchimentos.push({
      formId,
      formRevisao: definicao.revisao,
      cabecalho: cabecalhoDo(definicao, dados),
    });
  }
  return { nome, formIds, preenchimentos };
}

/** Preenchimentos da TAG com a definição de cada um; checklist que sumiu fica de fora. */
async function daTagComDefinicao(
  tagId: number,
): Promise<Array<{ preenchimento: Preenchimento; definicao: DefinicaoFormulario }>> {
  const lista = [];
  for (const preenchimento of await PreenchimentoRepository.listarPorTags([tagId])) {
    try {
      lista.push({ preenchimento, definicao: await carregarFormulario(preenchimento.formId) });
    } catch {
      // Checklist retirado do painel: não empresta nem recebe dados.
    }
  }
  return lista;
}

/**
 * Troca os checklists da TAG. O checklist que entra herda os dados do painel
 * já informados nos campos iguais dos outros checklists dela.
 */
export async function trocarChecklistsDaTag(tagId: number, formIds: string[]): Promise<void> {
  const existentes = await daTagComDefinicao(tagId);
  const novos: NonNullable<NovaTagEntrada['preenchimentos']> = [];
  for (const formId of formIds) {
    if (existentes.some((e) => e.preenchimento.formId === formId)) continue;
    const definicao = await carregarFormulario(formId);
    const cabecalho: ValoresCabecalho = {};
    for (const campo of definicao.cabecalho) {
      for (const { preenchimento, definicao: outra } of existentes) {
        const igual = outra.cabecalho.find((c) => c.id === campo.id);
        const valor = valorAceito(campo, preenchimento.cabecalho?.[campo.id]);
        if (igual && valor && compativeis(igual, campo)) {
          cabecalho[campo.id] = valor;
          break;
        }
      }
    }
    novos.push({ formId, formRevisao: definicao.revisao, cabecalho });
  }
  await ProjetoRepository.definirChecklistsDaTag(tagId, formIds, novos);
}

/**
 * Os dados do painel são da TAG, não de um checklist: o campo alterado num
 * checklist muda também nos outros checklists da TAG que têm o mesmo campo.
 * Assim os PDFs não saem com o mesmo painel descrito de dois jeitos.
 */
export async function propagarCabecalho(
  preenchimentoId: number,
  mudancas: Record<string, string | null>,
): Promise<void> {
  const origem = await PreenchimentoRepository.obterPorId(preenchimentoId);
  if (origem?.tagId === undefined) return;
  const daTag = await daTagComDefinicao(origem.tagId);
  const definicaoOrigem = daTag.find((e) => e.preenchimento.id === preenchimentoId)?.definicao;
  if (!definicaoOrigem) return;

  for (const { preenchimento, definicao } of daTag) {
    if (preenchimento.id === preenchimentoId) continue;
    const aqui: Record<string, string | null> = {};
    for (const [campoId, valor] of Object.entries(mudancas)) {
      const de = definicaoOrigem.cabecalho.find((c) => c.id === campoId);
      const para = definicao.cabecalho.find((c) => c.id === campoId);
      if (de && para && compativeis(de, para)) aqui[campoId] = valor;
    }
    if (Object.keys(aqui).length) {
      await PreenchimentoRepository.aplicarMudancasCabecalho(preenchimento.id!, aqui);
    }
  }
}
