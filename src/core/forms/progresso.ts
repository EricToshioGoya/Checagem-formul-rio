import type {
  DefinicaoFormulario,
  Etapa,
  MapaRespostas,
  Resposta,
  ValorGrade,
} from './tipos';

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
  quantidadeFotos: number,
): boolean {
  switch (etapa.tipoResposta) {
    case 'foto':
    case 'anexo_pdf':
      return quantidadeFotos > 0;
    case 'check':
      return resposta?.valor === true;
    case 'check_com_foto':
      return (
        resposta?.valor === true && (!etapa.fotoObrigatoria || quantidadeFotos > 0)
      );
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

export function calcularProgresso(
  definicao: DefinicaoFormulario,
  respostas: MapaRespostas,
  fotosPorEtapa: Record<string, number> = {},
): Progresso {
  const etapas = etapasAtivas(definicao, respostas);
  const respondidas = etapas.filter((e) =>
    etapaRespondida(e, respostas[e.id], fotosPorEtapa[e.id] ?? 0),
  ).length;
  const total = etapas.length;
  return {
    total,
    respondidas,
    pendentes: total - respondidas,
    percentual: total === 0 ? 0 : Math.round((respondidas / total) * 100),
  };
}

export function idsPendentes(
  definicao: DefinicaoFormulario,
  respostas: MapaRespostas,
  fotosPorEtapa: Record<string, number> = {},
): string[] {
  return etapasAtivas(definicao, respostas)
    .filter((e) => !etapaRespondida(e, respostas[e.id], fotosPorEtapa[e.id] ?? 0))
    .map((e) => e.id);
}
