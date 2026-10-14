import type { DefinicaoFormulario, Etapa } from './formulario';
import { ehMimeDeVideo } from './midias';

/**
 * Respostas e andamento de um checklist. Fica aqui, e não só no aplicativo,
 * porque o servidor também calcula o andamento — do que os montadores
 * sincronizam — com exatamente a mesma regra que o aparelho mostra.
 */

/** Valor de uma grade numérica: linha → coluna → número informado. */
export type ValorGrade = Record<string, Record<string, number | null>>;

export type ValorResposta = boolean | number | string | ValorGrade | null;

export interface Resposta {
  valor: ValorResposta;
  observacao?: string;
}

/** `etapaId` → resposta. Etapas não respondidas simplesmente não existem no mapa. */
export type MapaRespostas = Record<string, Resposta>;

/** Arquivos anexados a uma etapa: o total e, dentre eles, quantos são vídeo. */
export interface ContagemMidias {
  arquivos: number;
  videos: number;
}

/** `etapaId` → arquivos anexados. Etapa sem arquivo não precisa constar. */
export type MapaMidias = Record<string, ContagemMidias>;

export const SEM_MIDIAS: ContagemMidias = Object.freeze({ arquivos: 0, videos: 0 });

/** Conta, por etapa, os arquivos e os vídeos de uma lista de mídias. */
export function contarMidias(midias: Iterable<{ etapaId: string; mime: string }>): MapaMidias {
  const mapa: MapaMidias = {};
  for (const m of midias) {
    const atual = (mapa[m.etapaId] ??= { arquivos: 0, videos: 0 });
    atual.arquivos += 1;
    if (ehMimeDeVideo(m.mime)) atual.videos += 1;
  }
  return mapa;
}

/**
 * A etapa tem a foto e o vídeo que exige. Nas etapas de foto e vídeo não há
 * PDF, então o que não é vídeo é foto.
 */
function temMidiasExigidas(etapa: Etapa, midias: ContagemMidias): boolean {
  const fotos = midias.arquivos - midias.videos;
  return (!etapa.fotoObrigatoria || fotos > 0) && (!etapa.videoObrigatorio || midias.videos > 0);
}

export interface Progresso {
  total: number;
  respondidas: number;
  pendentes: number;
  percentual: number;
}

/**
 * Uma etapa é exibida quando está ativa e, havendo `exibirSe`, quando a etapa
 * apontada foi respondida com um dos valores esperados. Etapa sem `exibirSe`
 * segue sempre visível: os formulários já publicados não mudam.
 */
export function etapaVisivel(etapa: Etapa, respostas: MapaRespostas = {}): boolean {
  if (etapa.ativa === false) return false;
  const condicao = etapa.exibirSe;
  if (!condicao) return true;
  const valor = respostas[condicao.etapaId]?.valor;
  return typeof valor === 'string' && condicao.igualA.includes(valor);
}

/** Etapas visíveis de todas as seções, na ordem de exibição. */
export function etapasAtivas(
  definicao: DefinicaoFormulario,
  respostas: MapaRespostas = {},
): Etapa[] {
  return definicao.secoes.flatMap((s) => s.etapas.filter((e) => etapaVisivel(e, respostas)));
}

function gradePreenchida(valor: ValorGrade): boolean {
  return Object.values(valor).some((linha) =>
    Object.values(linha ?? {}).some((v) => typeof v === 'number' && Number.isFinite(v)),
  );
}

/**
 * Uma etapa conta como respondida quando tem registro próprio do seu tipo.
 * Não existe julgamento de conformidade: só "respondida" ou "em branco".
 */
export function etapaRespondida(
  etapa: Etapa,
  resposta: Resposta | undefined,
  midias: ContagemMidias = SEM_MIDIAS,
): boolean {
  switch (etapa.tipoResposta) {
    case 'foto':
      return midias.arquivos > 0 && temMidiasExigidas(etapa, midias);
    case 'anexo_pdf':
      return midias.arquivos > 0;
    case 'check':
      return resposta?.valor === true;
    case 'check_com_foto':
      return resposta?.valor === true && temMidiasExigidas(etapa, midias);
    case 'numero':
      return typeof resposta?.valor === 'number' && Number.isFinite(resposta.valor);
    case 'texto':
    case 'selecao':
      return typeof resposta?.valor === 'string' && resposta.valor.trim().length > 0;
    case 'grade_numerica':
      return (
        !!resposta &&
        typeof resposta.valor === 'object' &&
        resposta.valor !== null &&
        gradePreenchida(resposta.valor as ValorGrade)
      );
    default:
      return false;
  }
}

/** Percentual inteiro; zero quando não há etapas. */
export function percentualDe(respondidas: number, total: number): number {
  return total === 0 ? 0 : Math.round((respondidas / total) * 100);
}

/** Monta o progresso a partir das etapas respondidas e do total. */
export function progressoDe(respondidas: number, total: number): Progresso {
  return { total, respondidas, pendentes: total - respondidas, percentual: percentualDe(respondidas, total) };
}

/** Soma o andamento de vários checklists. */
export function somarProgresso(partes: readonly Progresso[]): Progresso {
  return progressoDe(
    partes.reduce((s, p) => s + p.respondidas, 0),
    partes.reduce((s, p) => s + p.total, 0),
  );
}

export function calcularProgresso(
  definicao: DefinicaoFormulario,
  respostas: MapaRespostas,
  midiasPorEtapa: MapaMidias = {},
): Progresso {
  const etapas = etapasAtivas(definicao, respostas);
  const respondidas = etapas.filter((e) =>
    etapaRespondida(e, respostas[e.id], midiasPorEtapa[e.id]),
  ).length;
  return progressoDe(respondidas, etapas.length);
}

export function idsPendentes(
  definicao: DefinicaoFormulario,
  respostas: MapaRespostas,
  midiasPorEtapa: MapaMidias = {},
): string[] {
  return etapasAtivas(definicao, respostas)
    .filter((e) => !etapaRespondida(e, respostas[e.id], midiasPorEtapa[e.id]))
    .map((e) => e.id);
}

/**
 * Checklists que valem para uma TAG. Nem toda TAG passa por todos os
 * checklists do painel: o montador escolhe, ao cadastrar a TAG, quais vai
 * preencher. TAG sem escolha gravada (anterior a esta regra, ou vinda de um
 * aparelho desatualizado) segue com todos — nada já preenchido some.
 */
export function checklistsDaTag<T extends { id: string }>(
  formIds: readonly string[] | undefined,
  checklists: readonly T[],
): T[] {
  if (!formIds) return [...checklists];
  return checklists.filter((c) => formIds.includes(c.id));
}
