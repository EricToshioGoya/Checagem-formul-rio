import {
  contarMidias,
  etapaRespondida,
  etapaVisivel,
  checklistsDaTag,
  type MapaRespostas,
} from '../../compartilhado/progresso';
import { codigoDe, type DefinicaoFormulario } from '../../compartilhado/formulario';
import { infoDoTipo } from '../../compartilhado/tiposChecklist';
import type { DocumentoProjeto } from './esquemas';
import { listarEntradasPorPainelId, obterDefinicao } from './formularios';

/**
 * Andamento de um projeto sincronizado, etapa por etapa. Usa a mesma regra do
 * aparelho (`compartilhado/progresso`): cada TAG vezes cada checklist ativo
 * escolhido para ela, só as etapas visíveis, contando as fotos de cada etapa.
 *
 * O total de etapas da lista de andamento sai daqui também, para o resumo e o
 * detalhe nunca discordarem.
 */

interface Contagem {
  total: number;
  respondidas: number;
}

export interface EtapaDoAndamento {
  id: string;
  codigo: string;
  descricao: string;
  respondida: boolean;
  fotos: number;
}

export interface SecaoDoAndamento extends Contagem {
  id: string;
  codigo: string;
  titulo: string;
  etapas: EtapaDoAndamento[];
}

export interface ChecklistDoAndamento extends Contagem {
  formId: string;
  nome: string;
  tipo: string;
  secoes: SecaoDoAndamento[];
}

export interface TagDoAndamento extends Contagem {
  uid: string;
  nome: string;
  checklists: ChecklistDoAndamento[];
}

function somar(partes: readonly Contagem[]): Contagem {
  return {
    total: partes.reduce((s, p) => s + p.total, 0),
    respondidas: partes.reduce((s, p) => s + p.respondidas, 0),
  };
}

function definicoesAtivas(painelId: number): DefinicaoFormulario[] {
  return listarEntradasPorPainelId(painelId)
    .filter((f) => f.ativo)
    .map((f) => obterDefinicao(f.id))
    .filter((d): d is DefinicaoFormulario => d !== null);
}

export function detalheDoDocumento(
  painelId: number,
  documento: DocumentoProjeto,
): TagDoAndamento[] {
  const definicoes = definicoesAtivas(painelId);
  const tags = [...documento.tags].sort((a, b) => a.ordem - b.ordem);

  return tags.map((tag) => {
    const checklists = checklistsDaTag(tag.formIds, definicoes).map((definicao) => {
      const respostas = (documento.preenchimentos.find(
        (p) => p.tagUid === tag.uid && p.formId === definicao.id,
      )?.respostas ?? {}) as MapaRespostas;
      const midias = contarMidias(
        documento.midias.filter((m) => m.tagUid === tag.uid && m.formId === definicao.id),
      );

      const secoes = definicao.secoes
        .map((secao): SecaoDoAndamento => {
          const etapas = secao.etapas
            .filter((e) => etapaVisivel(e, respostas))
            .map((e) => ({
              id: e.id,
              codigo: codigoDe(e),
              descricao: e.descricao,
              respondida: etapaRespondida(e, respostas[e.id], midias[e.id]),
              fotos: midias[e.id]?.arquivos ?? 0,
            }));
          return {
            id: secao.id,
            codigo: codigoDe(secao),
            titulo: secao.titulo,
            total: etapas.length,
            respondidas: etapas.filter((e) => e.respondida).length,
            etapas,
          };
        })
        .filter((s) => s.total > 0);

      return {
        formId: definicao.id,
        nome: definicao.nome,
        tipo: infoDoTipo(definicao.tipo).rotulo,
        ...somar(secoes),
        secoes,
      };
    });
    return { uid: tag.uid, nome: tag.nome, ...somar(checklists), checklists };
  });
}

/** Totais do projeto, gravados a cada envio para a lista de andamento. */
export function andamentoDoDocumento(painelId: number, documento: DocumentoProjeto): Contagem {
  return somar(detalheDoDocumento(painelId, documento));
}
