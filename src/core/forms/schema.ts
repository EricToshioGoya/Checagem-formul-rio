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

/**
 * Conteúdo de apoio só vem da própria aplicação: caminho relativo, sem
 * esquema (`https:`, `javascript:`, `data:`…), sem host (`//`) e sem `..`.
 */
const caminhoLocalSchema = z
  .string()
  .min(1)
  .regex(
    /^\/?[A-Za-z0-9._\-/]+$/,
    'use um caminho local, como /media/sen-plus/s1-1.png (sem endereço externo)',
  )
  .refine((s) => !s.startsWith('//') && !/(^|\/)\.\.(\/|$)/.test(s), {
    message: 'use um caminho local, sem "//" no início e sem ".."',
  });

export const midiaApoioSchema = z.object({
  tipo: z.enum(['imagem', 'video', 'pdf']),
  src: caminhoLocalSchema,
  legenda: z.string().optional(),
});

export const campoCabecalhoSchema = z.object({
  id: z.string().min(1),
  rotulo: z.string().min(1),
  tipo: z.enum(['texto', 'numero', 'selecao', 'data']),
  unidade: z.string().optional(),
  opcoes: z.array(z.string()).optional(),
  ajuda: z.string().optional(),
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
  arquivo: z
    .string()
    .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.json$/, 'nome de arquivo .json dentro de /forms'),
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
