import { solicitacaoStore, podeEditar, ROTULO_ESTADO } from '../../core/certificacao';
import { PreenchimentoRepository, ProjetoRepository } from '../../core/db/repositorios';
import { carregarFormulario } from '../../core/forms/catalogo';
import { obterPainel } from '../../core/paineis/catalogo';
import type { DefinicaoFormulario, ValoresCabecalho } from '../../core/forms/tipos';

/**
 * Tudo que a tela de preenchimento precisa, resolvido antes de montar.
 *
 * A mesma tela atende os dois fluxos: o dossiê do SEN Plus (projeto → TAG →
 * formulário) e o checklist de uma solicitação de certificação. Só este módulo
 * conhece a diferença.
 */
export interface ContextoPreenchimento {
  titulo: string;
  subtitulo: string;
  definicao: DefinicaoFormulario;
  preenchimentoId: number;
  cabecalhoInicial: ValoresCabecalho;
  voltarPara: string;
  somenteLeitura: boolean;
  /** Motivo do bloqueio, exibido no topo quando `somenteLeitura`. */
  avisoBloqueio?: string;
  marcarAlteracao: () => Promise<void>;
}

export async function contextoDoProjeto(
  projetoId: number,
  tagId: number,
  formId: string,
): Promise<ContextoPreenchimento> {
  const [projeto, tag] = await Promise.all([
    ProjetoRepository.obter(projetoId),
    ProjetoRepository.obterTag(tagId),
  ]);
  if (!projeto || !tag) throw new Error('Projeto ou TAG não encontrados.');

  const definicao = await carregarFormulario(formId);
  const preenchimento = await PreenchimentoRepository.obterOuCriar(
    tagId,
    definicao.id,
    definicao.revisao,
  );

  return {
    titulo: `${tag.nome} — ${definicao.tipo === 'montagem' ? 'Montagem' : 'Rotina'}`,
    subtitulo: `${definicao.nome} • ${definicao.revisao}`,
    definicao,
    preenchimentoId: preenchimento.id,
    cabecalhoInicial: {
      numeroPedido: projeto.numeroPedido ?? '',
      ...(preenchimento.cabecalho ?? {}),
    },
    voltarPara: `/projetos/${projetoId}`,
    somenteLeitura: false,
    marcarAlteracao: () => ProjetoRepository.marcarAlteracao(projeto.id!),
  };
}

export async function contextoDaSolicitacao(
  solicitacaoId: number,
): Promise<ContextoPreenchimento> {
  const solicitacao = await solicitacaoStore.obter(solicitacaoId);
  if (!solicitacao) throw new Error('Solicitação não encontrada.');

  const painel = await obterPainel(solicitacao.tipoPainel);
  const definicao = await carregarFormulario(solicitacao.formId);
  const preenchimento = await PreenchimentoRepository.obterOuCriarPorSolicitacao(
    solicitacaoId,
    definicao.id,
    definicao.revisao,
  );

  const editavel = podeEditar(solicitacao.estado);
  return {
    titulo: `${solicitacao.dados.tagPainel || 'Painel'} — ${painel.nome}`,
    subtitulo: `${definicao.nome} • ${definicao.revisao}`,
    definicao,
    preenchimentoId: preenchimento.id,
    cabecalhoInicial: preenchimento.cabecalho ?? {},
    voltarPara: `/solicitacoes/${solicitacaoId}`,
    somenteLeitura: !editavel,
    avisoBloqueio: editavel
      ? undefined
      : `Solicitação em “${ROTULO_ESTADO[solicitacao.estado]}”. O checklist está travado para conferência.`,
    marcarAlteracao: () =>
      solicitacaoStore.atualizarDados(solicitacaoId, solicitacao.dados),
  };
}
