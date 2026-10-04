import { solicitacaoStore, podeEditar, ROTULO_ESTADO } from '../../core/certificacao';
import { PreenchimentoRepository, ProjetoRepository } from '../../core/db/repositorios';
import {
  conferirAcessoPainel,
  conferirAcessoPorSlug,
  type Bloqueio,
} from '../../core/api/acessoLocal';
import { carregarFormulario } from '../../core/forms/catalogo';
import { obterPainel } from '../../core/paineis/catalogo';
import type { DefinicaoFormulario, ValoresCabecalho } from '../../core/forms/tipos';
import type { Preenchimento } from '../../core/db/tipos';

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
  preenchimento: Preenchimento & { id: number };
  cabecalhoInicial: ValoresCabecalho;
  voltarPara: string;
  rotuloVoltar: string;
  somenteLeitura: boolean;
  /** Motivo do bloqueio, exibido no topo quando `somenteLeitura`. */
  avisoBloqueio?: string;
  marcarAlteracao: () => Promise<void>;
}

/** O contexto, ou o motivo de o painel não abrir mais para esta conta. */
export type ResultadoContexto =
  | { contexto: ContextoPreenchimento; bloqueio?: undefined }
  | { bloqueio: Bloqueio; contexto?: undefined };

export async function contextoDoProjeto(
  usuarioId: number,
  projetoId: number,
  tagId: number,
  formId: string,
): Promise<ResultadoContexto> {
  const [projeto, tag] = await Promise.all([
    ProjetoRepository.obterDoUsuario(projetoId, usuarioId),
    ProjetoRepository.obterTag(tagId),
  ]);
  if (!projeto || !tag) throw new Error('Projeto ou TAG não encontrados.');
  if (projeto.painelId !== undefined) {
    const bloqueio = await conferirAcessoPainel(usuarioId, projeto.painelId);
    if (bloqueio) return { bloqueio };
  }

  const definicao = await carregarFormulario(formId);
  const preenchimento = await PreenchimentoRepository.obterOuCriar(
    tagId,
    definicao.id,
    definicao.revisao,
  );

  return {
    contexto: {
      titulo: `${tag.nome} — ${definicao.tipo === 'montagem' ? 'Montagem' : 'Rotina'}`,
      subtitulo: `${definicao.nome} • ${definicao.revisao}`,
      definicao,
      preenchimento,
      // O cabeçalho começa com os dados já conhecidos do projeto.
      cabecalhoInicial: {
        numeroPedido: projeto.numeroPedido ?? '',
        ...(preenchimento.cabecalho ?? {}),
      },
      voltarPara: `/projetos/${projetoId}`,
      rotuloVoltar: 'Voltar ao projeto',
      somenteLeitura: false,
      marcarAlteracao: () => ProjetoRepository.marcarAlteracao(projeto.id!),
    },
  };
}

export async function contextoDaSolicitacao(
  usuarioId: number,
  solicitacaoId: number,
): Promise<ResultadoContexto> {
  const solicitacao = await solicitacaoStore.obter(solicitacaoId);
  if (
    !solicitacao ||
    (solicitacao.usuarioId !== undefined && solicitacao.usuarioId !== usuarioId)
  ) {
    throw new Error('Solicitação não encontrada.');
  }
  const bloqueio = await conferirAcessoPorSlug(usuarioId, solicitacao.tipoPainel);
  if (bloqueio) return { bloqueio };

  const painel = await obterPainel(solicitacao.tipoPainel);
  const definicao = await carregarFormulario(solicitacao.formId);
  const preenchimento = await PreenchimentoRepository.obterOuCriarPorSolicitacao(
    solicitacaoId,
    definicao.id,
    definicao.revisao,
  );

  const editavel = podeEditar(solicitacao.estado);
  return {
    contexto: {
      titulo: `${solicitacao.dados.tagPainel || 'Painel'} — ${painel.nome}`,
      subtitulo: `${definicao.nome} • ${definicao.revisao}`,
      definicao,
      preenchimento,
      cabecalhoInicial: preenchimento.cabecalho ?? {},
      voltarPara: `/solicitacoes/${solicitacaoId}`,
      rotuloVoltar: 'Voltar à solicitação',
      somenteLeitura: !editavel,
      avisoBloqueio: editavel
        ? undefined
        : `Solicitação em “${ROTULO_ESTADO[solicitacao.estado]}”. O checklist está travado para conferência.`,
      marcarAlteracao: async () => {
        // Relê antes de gravar: a tela pode estar aberta há tempo, e os dados
        // da solicitação mudaram em outra tela.
        const atual = await solicitacaoStore.obter(solicitacaoId);
        if (atual) await solicitacaoStore.atualizarDados(solicitacaoId, atual.dados);
      },
    },
  };
}
