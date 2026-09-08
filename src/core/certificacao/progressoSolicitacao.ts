import { MidiaRepository, PreenchimentoRepository } from '../db/repositorios';
import { carregarFormulario } from '../forms/catalogo';
import { camposDoPainel, obterPainel } from '../paineis/catalogo';
import { calcularProgresso, idsPendentes, type Progresso } from '../forms/progresso';
import { camposObrigatoriosVazios, rotulosDe } from '../forms/validacaoCampos';
import type { Solicitacao } from '../db/tipos';
import type { CampoCabecalho, DefinicaoFormulario } from '../forms/tipos';
import type { Painel } from '../paineis/tipos';

export interface SituacaoSolicitacao {
  painel: Painel;
  campos: CampoCabecalho[];
  definicao: DefinicaoFormulario;
  preenchimentoId: number;
  progresso: Progresso;
  /** Ids das etapas do checklist ainda sem resposta. */
  etapasPendentes: string[];
  /** Rótulos dos campos obrigatórios ainda vazios. */
  camposPendentes: string[];
  /** Só uma solicitação completa pode ser enviada para validação. */
  completa: boolean;
}

/**
 * Reúne, para uma solicitação, o que falta antes do envio: campos obrigatórios
 * e etapas do checklist. É o mesmo cálculo usado pela tela do montador e pela
 * validação ABB, para que os dois lados vejam a mesma pendência.
 */
export async function situacaoDaSolicitacao(
  solicitacao: Solicitacao,
): Promise<SituacaoSolicitacao> {
  const [painel, campos, definicao] = await Promise.all([
    obterPainel(solicitacao.tipoPainel),
    camposDoPainel(solicitacao.tipoPainel),
    carregarFormulario(solicitacao.formId),
  ]);

  const preenchimento = await PreenchimentoRepository.obterOuCriarPorSolicitacao(
    solicitacao.id!,
    definicao.id,
    definicao.revisao,
  );
  const fotos = await MidiaRepository.mapaContagem(preenchimento.id);
  const respostas = preenchimento.respostas ?? {};

  const progresso = calcularProgresso(definicao, respostas, fotos);
  const etapasPendentes = idsPendentes(definicao, respostas, fotos);
  const camposPendentes = rotulosDe(
    campos,
    camposObrigatoriosVazios(campos, solicitacao.dados),
  );

  return {
    painel,
    campos,
    definicao,
    preenchimentoId: preenchimento.id,
    progresso,
    etapasPendentes,
    camposPendentes,
    completa: etapasPendentes.length === 0 && camposPendentes.length === 0,
  };
}
