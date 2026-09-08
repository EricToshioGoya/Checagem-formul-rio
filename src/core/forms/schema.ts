import { z } from 'zod';

/**
 * Schema das definições de formulário carregadas de `/public/forms`.
 * Todo JSON — de arquivo ou importado pela aba de administração — passa por
 * aqui antes de chegar ao motor. Um formulário inválido nunca é renderizado.
 */

export const tiposResposta = [
  'check',
  'check_com_foto',
  'foto',
  'numero',
  'texto',
  'selecao',
  'anexo_pdf',
  'grade_numerica',
] as const;

export const midiaApoioSchema = z.object({
  tipo: z.enum(['imagem', 'video', 'pdf']),
  src: z.string().min(1),
  legenda: z.string().optional(),
});

export const tiposCampo = [
  'texto',
  'numero',
  'selecao',
  'data',
  'email',
  'telefone',
] as const;

export const campoCabecalhoSchema = z.object({
  id: z.string().min(1),
  rotulo: z.string().min(1),
  tipo: z.enum(tiposCampo),
  unidade: z.string().optional(),
  opcoes: z.array(z.string()).optional(),
  ajuda: z.string().optional(),
  /** Campo sem valor bloqueia o avanço da solicitação. */
  obrigatorio: z.boolean().optional().default(false),
});

export const tabelaReferenciaSchema = z.object({
  colunas: z.array(z.string()).min(1),
  linhas: z.array(z.array(z.string())),
  titulo: z.string().optional(),
});

/** Configuração do tipo `grade_numerica` (ensaios de R3 e R5 da rotina BT). */
export const gradeSchema = z.object({
  linhas: z.array(z.object({ id: z.string().min(1), rotulo: z.string().min(1) })).min(1),
  colunas: z
    .array(
      z.object({
        id: z.string().min(1),
        rotulo: z.string().min(1),
        unidade: z.string().optional(),
      }),
    )
    .min(1),
});

/**
 * Condição de exibição de uma etapa, avaliada contra a resposta de outra.
 * Etapa sem `exibirSe` é sempre exibida — o comportamento dos formulários
 * já publicados não muda.
 */
export const condicaoSchema = z.object({
  etapaId: z.string().min(1),
  igualA: z.array(z.string().min(1)).min(1),
});

export const etapaSchema = z.object({
  id: z.string().min(1),
  descricao: z.string().min(1),
  detalhes: z.array(z.string()).optional(),
  tipoResposta: z.enum(tiposResposta),
  observacao: z.boolean().optional().default(true),
  ativa: z.boolean().optional().default(true),
  unidade: z.string().optional(),
  opcoes: z.array(z.string()).optional(),
  grade: gradeSchema.optional(),
  exibirSe: condicaoSchema.optional(),
  /**
   * Exige pelo menos um arquivo anexado para a etapa contar como respondida.
   * Ausente, vale o comportamento original: a marcação basta.
   */
  fotoObrigatoria: z.boolean().optional().default(false),
  midiaApoio: z.array(midiaApoioSchema).optional().default([]),
  tabelaReferencia: tabelaReferenciaSchema.optional(),
  referencia: z.string().optional(),
  /** Marca conteúdo que ainda precisa ser conferido contra o documento original. */
  pendenteTranscricao: z.boolean().optional(),
});

export const secaoSchema = z.object({
  id: z.string().min(1),
  titulo: z.string().min(1),
  descricao: z.string().optional(),
  etapas: z.array(etapaSchema).min(1),
});

export const definicaoFormularioSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  linhaProduto: z.string().min(1),
  tipo: z.enum(['montagem', 'rotina']),
  revisao: z.string().min(1),
  dataRevisao: z.string().min(1),
  emitidoPor: z.string().optional().default(''),
  cabecalho: z.array(campoCabecalhoSchema).default([]),
  secoes: z.array(secaoSchema).min(1),
});

export const entradaCatalogoSchema = z.object({
  id: z.string().min(1),
  arquivo: z.string().min(1),
  nome: z.string().min(1),
  tipo: z.enum(['montagem', 'rotina']),
  linhaProduto: z.string().min(1),
  /** Um formulário desativado no catálogo não aparece nas telas de TAG. */
  ativo: z.boolean().optional().default(true),
});

export const catalogoSchema = z.object({
  formularios: z.array(entradaCatalogoSchema).min(1),
});

/** Converte um erro do Zod em texto legível para a aba de administração. */
export function descreverErro(erro: z.ZodError): string {
  return erro.issues
    .map((i) => {
      const caminho = i.path.length ? i.path.join(' › ') : 'raiz';
      return `• ${caminho}: ${i.message}`;
    })
    .join('\n');
}
