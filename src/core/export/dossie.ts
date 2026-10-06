import {
  MidiaRepository,
  PreenchimentoRepository,
  ProjetoRepository,
} from '../db/repositorios';
import { painelGuardado } from '../api/acessoLocal';
import { solicitacaoStore, ROTULO_ESTADO } from '../certificacao';
import { carregarFormulario, formulariosDoPainel } from '../forms/catalogo';
import { calcularProgresso, checklistsDaTag, idsPendentes } from '../forms/progresso';
import type { Progresso } from '../forms/progresso';
import { camposDoPainel, entradaDoPainel } from '../paineis/catalogo';
import { CAMPOS_DO_PROJETO } from '../forms/dadosTag';
import type {
  CampoCabecalho,
  DefinicaoFormulario,
  MapaRespostas,
  ValoresCabecalho,
} from '../forms/tipos';
import type { Midia, Preenchimento, Projeto } from '../db/tipos';

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
  /** A TAG do projeto, ou o painel/quadro da solicitação de certificação. */
  nome: string;
  formularios: FormularioDoDossie[];
}

/**
 * Tudo que um destino de exportação precisa, numa estrutura única e agnóstica
 * de formato e de painel. PDF e ZIP consomem o mesmo dossiê, venha ele de um
 * projeto, de um checklist de uma TAG ou de uma solicitação de certificação.
 */
export interface Dossie {
  /** Empresa e projeto: capa, rodapé e nome do arquivo. */
  empresa: string;
  nomeProjeto: string;
  /** Nome do painel (SEN Plus, System Pro E Energy…), quando conhecido. */
  painel?: string;
  /** Linhas de identificação da capa, na ordem em que são impressas. */
  identificacao: Array<[string, string]>;
  /**
   * A capa lista as TAGs do documento. Calculado na hora de imprimir: o PDF
   * de um tipo de verificação leva só as TAGs que têm aquele checklist.
   */
  listarTags: boolean;
  geradoEm: Date;
  tags: TagDoDossie[];
  progressoGeral: Progresso;
}

/**
 * Valor de um campo como sai impresso: data em dd/mm/aaaa e número com
 * vírgula decimal, como o resto do documento.
 */
export function valorDeCampo(campo: CampoCabecalho, bruto: string | undefined): string {
  const valor = (bruto ?? '').trim();
  if (campo.tipo === 'data') {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }
  if (campo.tipo === 'numero' && valor !== '' && Number.isFinite(Number(valor))) {
    return Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  }
  return valor;
}

/** Soma o andamento de vários checklists. */
export function somarProgresso(partes: readonly Progresso[]): Progresso {
  const total = partes.reduce((s, p) => s + p.total, 0);
  const respondidas = partes.reduce((s, p) => s + p.respondidas, 0);
  return {
    total,
    respondidas,
    pendentes: total - respondidas,
    percentual: total === 0 ? 0 : Math.round((respondidas / total) * 100),
  };
}

/** Preenchimento com as mídias e o andamento, no formato do dossiê. */
async function formularioDoDossie(
  definicao: DefinicaoFormulario,
  preenchimento: Preenchimento | undefined,
  operador: string,
): Promise<FormularioDoDossie> {
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
  return {
    definicao,
    cabecalho: preenchimento?.cabecalho ?? {},
    respostas,
    midiasPorEtapa,
    atualizadoEm: preenchimento?.atualizadoEm,
    formRevisao: preenchimento?.formRevisao ?? definicao.revisao,
    operador,
    progresso: calcularProgresso(definicao, respostas, contagem),
    pendentes: idsPendentes(definicao, respostas, contagem),
  };
}

/** Nome do painel do projeto: o visto na última conexão, ou o do catálogo de fluxos. */
async function nomeDoPainel(projeto: Projeto): Promise<string | undefined> {
  if (projeto.painelId !== undefined && projeto.usuarioId !== undefined) {
    const guardado = painelGuardado(projeto.usuarioId, projeto.painelId);
    if (guardado) return guardado.nome;
  }
  if (!projeto.painelSlug) return undefined;
  try {
    return (await entradaDoPainel(projeto.painelSlug))?.nome ?? projeto.painelSlug;
  } catch {
    return projeto.painelSlug;
  }
}

export interface FiltroDossie {
  /** Checklists incluídos. Vazio significa todos os ativos do painel. */
  formIds?: string[];
  /** TAGs incluídas. Vazio significa todas as do projeto. */
  tagIds?: number[];
}

/**
 * Dossiê de um projeto: cada TAG × cada checklist escolhido para ela, ou só
 * a parte pedida no filtro (o checklist de uma TAG, na tela de preenchimento).
 */
export async function montarDossie(
  projetoId: number,
  filtro: FiltroDossie = {},
): Promise<Dossie> {
  const projeto = await ProjetoRepository.obter(projetoId);
  if (!projeto) throw new Error('Projeto não encontrado.');

  // Só os checklists do painel do projeto: um dossiê de SEN Plus não pode
  // sair com as etapas de um MNS por estarem no mesmo aparelho.
  const entradas = (await formulariosDoPainel(projeto.painelSlug)).filter(
    (e) => !filtro.formIds?.length || filtro.formIds.includes(e.id),
  );
  const tags = (await ProjetoRepository.listarTags(projetoId)).filter(
    (t) => !filtro.tagIds?.length || filtro.tagIds.includes(t.id!),
  );

  const resultado: TagDoDossie[] = [];
  for (const tag of tags) {
    const formularios: FormularioDoDossie[] = [];
    // A TAG só entra com os checklists escolhidos para ela.
    for (const entrada of checklistsDaTag(tag.formIds, entradas)) {
      const definicao = await carregarFormulario(entrada.id);
      const preenchimento = await PreenchimentoRepository.obter(tag.id!, entrada.id);
      formularios.push(await formularioDoDossie(definicao, preenchimento, projeto.operador));
    }
    resultado.push({ nome: tag.nome, formularios });
  }

  // Fabricante e cliente final valem para o projeto inteiro: vão para a capa.
  const doProjeto = (campoId: string): string => {
    for (const t of resultado) {
      for (const f of t.formularios) {
        const valor = f.cabecalho[campoId]?.trim();
        if (valor) return valor;
      }
    }
    return '';
  };
  const rotuloDoCampo = (campoId: string): string => {
    for (const t of resultado) {
      for (const f of t.formularios) {
        const campo = f.definicao.cabecalho.find((c) => c.id === campoId);
        if (campo) return campo.rotulo;
      }
    }
    return campoId;
  };

  const painel = await nomeDoPainel(projeto);
  const geradoEm = new Date();
  const identificacao: Array<[string, string]> = [
    ['Empresa', projeto.empresa],
    ['Projeto', projeto.nomeProjeto],
    ...(painel ? [['Painel', painel] as [string, string]] : []),
    ['Operador', projeto.operador],
    ...CAMPOS_DO_PROJETO.map((id) => [rotuloDoCampo(id), doProjeto(id)] as [string, string])
      .filter(([, valor]) => valor),
    ...(projeto.numeroPedido ? [['Número do pedido', projeto.numeroPedido] as [string, string]] : []),
  ];

  return {
    empresa: projeto.empresa,
    nomeProjeto: projeto.nomeProjeto,
    painel,
    identificacao,
    listarTags: true,
    geradoEm,
    tags: resultado,
    progressoGeral: somarProgresso(resultado.flatMap((t) => t.formularios.map((f) => f.progresso))),
  };
}

/**
 * Dossiê do checklist de uma solicitação de certificação. A identificação são
 * os campos que o próprio painel pede na solicitação, na ordem dele: um painel
 * novo, com outros campos, sai com os dele sem mudar o PDF.
 */
export async function montarDossieSolicitacao(solicitacaoId: number): Promise<Dossie> {
  const solicitacao = await solicitacaoStore.obter(solicitacaoId);
  if (!solicitacao) throw new Error('Solicitação não encontrada.');

  const [definicao, campos, entradaPainel] = await Promise.all([
    carregarFormulario(solicitacao.formId),
    camposDoPainel(solicitacao.tipoPainel),
    entradaDoPainel(solicitacao.tipoPainel),
  ]);
  const preenchimento = await PreenchimentoRepository.obterPorSolicitacao(solicitacaoId);
  const dados = solicitacao.dados;
  const formulario = await formularioDoDossie(definicao, preenchimento, dados.operador ?? '');
  const painel = entradaPainel?.nome ?? solicitacao.tipoPainel;

  const identificacao: Array<[string, string]> = [
    ['Painel', painel],
    ['Situação da solicitação', ROTULO_ESTADO[solicitacao.estado]],
    ...(solicitacao.numeroCertificado
      ? [['Certificado nº', solicitacao.numeroCertificado] as [string, string]]
      : []),
    ...campos.map(
      (c) =>
        [c.rotulo + (c.unidade ? ` (${c.unidade})` : ''), valorDeCampo(c, dados[c.id])] as [
          string,
          string,
        ],
    ),
  ];

  return {
    empresa: dados.empresa || dados.montador || 'Empresa',
    nomeProjeto: dados.projeto || 'Projeto',
    painel,
    identificacao,
    // O painel/quadro já está entre os campos da solicitação.
    listarTags: false,
    geradoEm: new Date(),
    tags: [{ nome: dados.tagPainel || 'Painel', formularios: [formulario] }],
    progressoGeral: formulario.progresso,
  };
}
