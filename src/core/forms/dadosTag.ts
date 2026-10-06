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

/**
 * Campos que descrevem o projeto inteiro, e não uma TAG: o fabricante do
 * conjunto e o cliente final são os mesmos em todos os painéis do projeto.
 * São informados uma vez, no cadastro do projeto, e valem para o cabeçalho
 * de todo checklist de toda TAG dele.
 */
export const CAMPOS_DO_PROJETO: readonly string[] = ['fabricante', 'clienteFinal'];

export function campoDoProjeto(campoId: string): boolean {
  return CAMPOS_DO_PROJETO.includes(campoId);
}

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

type ComDefinicao = Array<{ preenchimento: Preenchimento; definicao: DefinicaoFormulario }>;

/** Preenchimentos das TAGs com a definição de cada um; checklist que sumiu fica de fora. */
async function comDefinicao(tagIds: number[]): Promise<ComDefinicao> {
  const lista: ComDefinicao = [];
  for (const preenchimento of await PreenchimentoRepository.listarPorTags(tagIds)) {
    try {
      lista.push({ preenchimento, definicao: await carregarFormulario(preenchimento.formId) });
    } catch {
      // Checklist retirado do painel: não empresta nem recebe dados.
    }
  }
  return lista;
}

/** TAGs do projeto, na ordem do cadastro. */
async function tagsDoProjeto(projetoId: number): Promise<number[]> {
  return (await ProjetoRepository.listarTags(projetoId)).map((t) => t.id!);
}

/** Valor do campo já informado em algum dos preenchimentos, se for compatível. */
function valorExistente(campo: CampoCabecalho, existentes: ComDefinicao): string | null {
  for (const { preenchimento, definicao } of existentes) {
    const igual = definicao.cabecalho.find((c) => c.id === campo.id);
    const valor = valorAceito(campo, preenchimento.cabecalho?.[campo.id]);
    if (igual && valor && compativeis(igual, campo)) return valor;
  }
  return null;
}

/**
 * Campos do projeto já informados em alguma TAG dele — é o que uma TAG nova
 * herda sem perguntar de novo.
 */
export async function valoresDoProjeto(projetoId: number): Promise<ValoresCabecalho> {
  const valores: ValoresCabecalho = {};
  for (const { preenchimento } of await comDefinicao(await tagsDoProjeto(projetoId))) {
    for (const campoId of CAMPOS_DO_PROJETO) {
      const valor = preenchimento.cabecalho?.[campoId]?.trim();
      if (valor && !valores[campoId]) valores[campoId] = valor;
    }
  }
  return valores;
}

/**
 * Troca os checklists da TAG. O checklist que entra herda os dados do painel
 * já informados nos campos iguais dos outros checklists dela — e os campos do
 * projeto, de qualquer TAG do projeto.
 */
export async function trocarChecklistsDaTag(tagId: number, formIds: string[]): Promise<void> {
  const existentes = await comDefinicao([tagId]);
  const tag = await ProjetoRepository.obterTag(tagId);
  const doProjeto = tag ? await comDefinicao(await tagsDoProjeto(tag.projetoId)) : existentes;
  const novos: NonNullable<NovaTagEntrada['preenchimentos']> = [];
  for (const formId of formIds) {
    if (existentes.some((e) => e.preenchimento.formId === formId)) continue;
    const definicao = await carregarFormulario(formId);
    const cabecalho: ValoresCabecalho = {};
    for (const campo of definicao.cabecalho) {
      const valor = valorExistente(campo, campoDoProjeto(campo.id) ? doProjeto : existentes);
      if (valor) cabecalho[campo.id] = valor;
    }
    novos.push({ formId, formRevisao: definicao.revisao, cabecalho });
  }
  await ProjetoRepository.definirChecklistsDaTag(tagId, formIds, novos);
}

/**
 * Os dados do painel são da TAG, não de um checklist: o campo alterado num
 * checklist muda também nos outros checklists da TAG que têm o mesmo campo.
 * Os campos do projeto mudam em todos os checklists de todas as TAGs dele.
 * Assim os PDFs não saem com o mesmo painel descrito de dois jeitos.
 */
export async function propagarCabecalho(
  preenchimentoId: number,
  mudancas: Record<string, string | null>,
): Promise<void> {
  const origem = await PreenchimentoRepository.obterPorId(preenchimentoId);
  if (origem?.tagId === undefined) return;
  const tag = await ProjetoRepository.obterTag(origem.tagId);
  const tocaProjeto = Object.keys(mudancas).some(campoDoProjeto);
  const alvos = await comDefinicao(
    tag && tocaProjeto ? await tagsDoProjeto(tag.projetoId) : [origem.tagId],
  );
  const definicaoOrigem = alvos.find((e) => e.preenchimento.id === preenchimentoId)?.definicao;
  if (!definicaoOrigem) return;

  for (const { preenchimento, definicao } of alvos) {
    if (preenchimento.id === preenchimentoId) continue;
    const mesmaTag = preenchimento.tagId === origem.tagId;
    const aqui: Record<string, string | null> = {};
    for (const [campoId, valor] of Object.entries(mudancas)) {
      if (!mesmaTag && !campoDoProjeto(campoId)) continue;
      const de = definicaoOrigem.cabecalho.find((c) => c.id === campoId);
      const para = definicao.cabecalho.find((c) => c.id === campoId);
      if (de && para && compativeis(de, para)) aqui[campoId] = valor;
    }
    if (Object.keys(aqui).length) {
      await PreenchimentoRepository.aplicarMudancasCabecalho(preenchimento.id!, aqui);
    }
  }
}
