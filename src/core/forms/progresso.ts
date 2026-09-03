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

/** Etapas ativas de todas as seções, na ordem de exibição. */
export function etapasAtivas(definicao: DefinicaoFormulario): Etapa[] {
  return definicao.secoes.flatMap((s) => s.etapas.filter((e) => e.ativa !== false));
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
      return resposta?.valor === true;
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
  const etapas = etapasAtivas(definicao);
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
  return etapasAtivas(definicao)
    .filter((e) => !etapaRespondida(e, respostas[e.id], fotosPorEtapa[e.id] ?? 0))
    .map((e) => e.id);
}
