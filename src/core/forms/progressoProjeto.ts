import {
  MidiaRepository,
  PreenchimentoRepository,
  ProjetoRepository,
} from '../db/repositorios';
import { PAINEL_PADRAO } from '../config';
import { carregarFormulario, formulariosDoPainel } from './catalogo';
import { calcularProgresso, idsPendentes, type Progresso } from './progresso';
import type { DefinicaoFormulario, EntradaCatalogo } from './tipos';

export interface ProgressoDeFormulario {
  formId: string;
  entrada: EntradaCatalogo;
  definicao: DefinicaoFormulario;
  progresso: Progresso;
  pendentes: string[];
  preenchimentoId?: number;
}

export interface ProgressoDeTag {
  tagId: number;
  nome: string;
  formularios: ProgressoDeFormulario[];
  progresso: Progresso;
}

export interface ProgressoDeProjeto {
  tags: ProgressoDeTag[];
  progresso: Progresso;
}

function somar(partes: Progresso[]): Progresso {
  const total = partes.reduce((s, p) => s + p.total, 0);
  const respondidas = partes.reduce((s, p) => s + p.respondidas, 0);
  return {
    total,
    respondidas,
    pendentes: total - respondidas,
    percentual: total === 0 ? 0 : Math.round((respondidas / total) * 100),
  };
}

/**
 * Progresso de um projeto inteiro: cada TAG × cada formulário ativo.
 * Serve à tela do projeto, à lista inicial e ao resumo de pendências do PDF.
 */
export async function progressoDoProjeto(projetoId: number): Promise<ProgressoDeProjeto> {
  const projeto = await ProjetoRepository.obter(projetoId);
  const [tags, entradas] = await Promise.all([
    ProjetoRepository.listarTags(projetoId),
    formulariosDoPainel(projeto?.tipoPainel ?? PAINEL_PADRAO),
  ]);
  const definicoes = new Map<string, DefinicaoFormulario>();
  for (const entrada of entradas) {
    definicoes.set(entrada.id, await carregarFormulario(entrada.id));
  }

  const preenchimentos = await PreenchimentoRepository.listarPorTags(
    tags.map((t) => t.id!),
  );

  const resultado: ProgressoDeTag[] = [];
  for (const tag of tags) {
    const formularios: ProgressoDeFormulario[] = [];
    for (const entrada of entradas) {
      const definicao = definicoes.get(entrada.id)!;
      const preenchimento = preenchimentos.find(
        (p) => p.tagId === tag.id && p.formId === entrada.id,
      );
      const fotos = preenchimento?.id
        ? await MidiaRepository.mapaContagem(preenchimento.id)
        : {};
      const respostas = preenchimento?.respostas ?? {};
      formularios.push({
        formId: entrada.id,
        entrada,
        definicao,
        progresso: calcularProgresso(definicao, respostas, fotos),
        pendentes: idsPendentes(definicao, respostas, fotos),
        preenchimentoId: preenchimento?.id,
      });
    }
    resultado.push({
      tagId: tag.id!,
      nome: tag.nome,
      formularios,
      progresso: somar(formularios.map((f) => f.progresso)),
    });
  }

  return { tags: resultado, progresso: somar(resultado.map((t) => t.progresso)) };
}
