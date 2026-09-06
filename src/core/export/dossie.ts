import {
  MidiaRepository,
  PreenchimentoRepository,
  ProjetoRepository,
} from '../db/repositorios';
import { carregarFormulario, formulariosDoPainel } from '../forms/catalogo';
import { calcularProgresso, idsPendentes } from '../forms/progresso';
import type { Progresso } from '../forms/progresso';
import type { DefinicaoFormulario, MapaRespostas, ValoresCabecalho } from '../forms/tipos';
import type { Midia, Projeto, Tag } from '../db/tipos';

export interface FormularioDoDossie {
  definicao: DefinicaoFormulario;
  cabecalho: ValoresCabecalho;
  respostas: MapaRespostas;
  midiasPorEtapa: Record<string, Midia[]>;
  atualizadoEm?: number;
  formRevisao: string;
  /** Replicado do projeto: a coluna "Operador" repete o mesmo nome em todas as etapas. */
  operador: string;
  progresso: Progresso;
  pendentes: string[];
}

export interface TagDoDossie {
  tag: Tag;
  formularios: FormularioDoDossie[];
}

export interface Dossie {
  projeto: Projeto;
  geradoEm: Date;
  tags: TagDoDossie[];
  progressoGeral: Progresso;
}

/**
 * Reúne, em uma estrutura única e agnóstica de formato, tudo que um destino de
 * exportação precisa. PDF e ZIP consomem o mesmo dossiê.
 */
export async function montarDossie(
  projetoId: number,
  formIds?: string[],
): Promise<Dossie> {
  const projeto = await ProjetoRepository.obter(projetoId);
  if (!projeto) throw new Error('Projeto não encontrado.');

  const entradas = (await formulariosDoPainel(projeto.painel)).filter(
    (e) => !formIds?.length || formIds.includes(e.id),
  );
  const tags = await ProjetoRepository.listarTags(projetoId);

  const resultado: TagDoDossie[] = [];
  let total = 0;
  let respondidas = 0;

  for (const tag of tags) {
    const formularios: FormularioDoDossie[] = [];
    for (const entrada of entradas) {
      const definicao = await carregarFormulario(entrada.id);
      const preenchimento = await PreenchimentoRepository.obter(tag.id!, entrada.id);
      const midiasPorEtapa: Record<string, Midia[]> = {};
      if (preenchimento?.id) {
        for (const midia of await MidiaRepository.listarPorPreenchimento(preenchimento.id)) {
          (midiasPorEtapa[midia.etapaId] ??= []).push(midia);
        }
      }
      const contagem = Object.fromEntries(
        Object.entries(midiasPorEtapa).map(([k, v]) => [k, v.length]),
      );
      const respostas = preenchimento?.respostas ?? {};
      const progresso = calcularProgresso(definicao, respostas, contagem);
      total += progresso.total;
      respondidas += progresso.respondidas;
      formularios.push({
        definicao,
        cabecalho: preenchimento?.cabecalho ?? {},
        respostas,
        midiasPorEtapa,
        atualizadoEm: preenchimento?.atualizadoEm,
        formRevisao: preenchimento?.formRevisao ?? definicao.revisao,
        operador: projeto.operador,
        progresso,
        pendentes: idsPendentes(definicao, respostas, contagem),
      });
    }
    resultado.push({ tag, formularios });
  }

  return {
    projeto,
    geradoEm: new Date(),
    tags: resultado,
    progressoGeral: {
      total,
      respondidas,
      pendentes: total - respondidas,
      percentual: total === 0 ? 0 : Math.round((respondidas / total) * 100),
    },
  };
}
