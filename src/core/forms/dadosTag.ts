import {
  PreenchimentoRepository,
  ProjetoRepository,
  type NovaTagEntrada,
} from '../db/repositorios';
import { carregarFormulario } from './catalogo';
import type { CampoCabecalho, DefinicaoFormulario, ValoresCabecalho } from './tipos';

/**
 * Dados do painel de uma TAG: fabricante, cliente final, tensões, norma…
 *
 * Cada checklist declara os campos do seu cabeçalho, e vários se repetem de
 * um checklist para outro. Para o montador eles são uma coisa só — os dados
 * daquele painel —, informados uma vez ao cadastrar a TAG e gravados no
 * cabeçalho de cada checklist escolhido.
 */

/** Campos dos checklists, cada id uma vez, na ordem em que aparecem. */
export function camposDaTag(definicoes: readonly DefinicaoFormulario[]): CampoCabecalho[] {
  const campos = new Map<string, CampoCabecalho>();
  for (const d of definicoes) {
    for (const c of d.cabecalho) if (!campos.has(c.id)) campos.set(c.id, c);
  }
  return [...campos.values()];
}

/** Ids dos campos ainda vazios: no cadastro da TAG, todos são obrigatórios. */
export function camposVazios(
  campos: readonly CampoCabecalho[],
  dados: ValoresCabecalho,
): string[] {
  return campos.filter((c) => !(dados[c.id] ?? '').trim()).map((c) => c.id);
}

/** O que dos dados do painel cabe no cabeçalho deste checklist. */
function cabecalhoDo(definicao: DefinicaoFormulario, dados: ValoresCabecalho): ValoresCabecalho {
  const cabecalho: ValoresCabecalho = {};
  for (const c of definicao.cabecalho) {
    const valor = dados[c.id]?.trim();
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

/**
 * Troca os checklists da TAG. O checklist que entra herda os dados do painel
 * já informados nos outros checklists dela.
 */
export async function trocarChecklistsDaTag(tagId: number, formIds: string[]): Promise<void> {
  const existentes = await PreenchimentoRepository.listarPorTags([tagId]);
  const dados: ValoresCabecalho = {};
  for (const p of existentes) Object.assign(dados, p.cabecalho ?? {});
  const novos: NonNullable<NovaTagEntrada['preenchimentos']> = [];
  for (const formId of formIds) {
    if (existentes.some((p) => p.formId === formId)) continue;
    const definicao = await carregarFormulario(formId);
    novos.push({ formId, formRevisao: definicao.revisao, cabecalho: cabecalhoDo(definicao, dados) });
  }
  await ProjetoRepository.definirChecklistsDaTag(tagId, formIds, novos);
}
