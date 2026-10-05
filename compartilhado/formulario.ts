import { z } from 'zod';

/**
 * Contrato do formulário, compartilhado entre o cliente e o servidor.
 *
 * A definição nasce na aba de administração, é gravada no servidor e é lida
 * pelo aparelho do montador. Como as duas pontas validam o mesmo JSON, o
 * schema mora aqui em vez de ter uma cópia de cada lado — cópias divergem, e
 * uma divergência aqui é um formulário que grava mas não abre.
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

export type TipoResposta = (typeof tiposResposta)[number];

/** Como cada tipo é oferecido a quem monta o checklist. */
export const ROTULOS_TIPO_RESPOSTA: Record<TipoResposta, string> = {
  check: 'Apenas conferir',
  check_com_foto: 'Conferir e exigir foto',
  foto: 'Somente foto',
  numero: 'Valor numérico',
  texto: 'Texto livre',
  selecao: 'Escolha entre opções',
  anexo_pdf: 'Anexar PDF',
  grade_numerica: 'Grade de medições',
};

/** O que cada tipo exige do montador, dito para quem monta o checklist. */
export const DESCRICOES_TIPO_RESPOSTA: Record<TipoResposta, string> = {
  check: 'O montador só marca "verificado". Sem foto.',
  check_com_foto:
    'O montador marca "verificado" e anexa pelo menos uma foto. Sem a foto, a etapa fica pendente.',
  foto: 'O montador só envia fotos — pelo menos uma. Sem a foto, a etapa fica pendente.',
  numero: 'O montador digita o valor medido, na unidade abaixo.',
  texto: 'O montador escreve a resposta.',
  selecao: 'O montador escolhe uma das opções abaixo.',
  anexo_pdf: 'O montador anexa um arquivo PDF (laudo, relatório).',
  grade_numerica: 'O montador preenche uma tabela de medições.',
};

/** Tipos que exigem foto para a etapa contar como respondida. */
export const TIPOS_COM_FOTO: readonly TipoResposta[] = ['check_com_foto', 'foto'];

/**
 * Caminho de conteúdo de apoio, sempre relativo à própria aplicação.
 *
 * Um JSON importado pela administração podia apontar para outro domínio, e a
 * aplicação buscava o arquivo: a operação deixava de ser offline, o endereço e
 * o horário de cada consulta vazavam para um terceiro, e a instrução visual da
 * etapa passava a ser servida por quem controlasse aquele domínio.
 */
const caminhoRelativo = z
  .string()
  .min(1)
  .refine((s) => !/^[a-z][a-z0-9+.-]*:/i.test(s), {
    message: 'informe um caminho dentro da aplicação, sem "https:" nem outro esquema',
  })
  .refine((s) => !s.startsWith('//'), {
    message: 'informe um caminho dentro da aplicação, sem "//" no início',
  })
  .refine((s) => !s.split('/').includes('..'), {
    message: 'o caminho não pode subir de diretório com ".."',
  });

export const midiaApoioSchema = z.object({
  tipo: z.enum(['imagem', 'video', 'pdf']),
  src: caminhoRelativo,
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

export type TipoCampo = (typeof tiposCampo)[number];

export const campoCabecalhoSchema = z.object({
  id: z.string().min(1),
  rotulo: z.string().min(1),
  tipo: z.enum(tiposCampo),
  unidade: z.string().optional(),
  opcoes: z.array(z.string()).optional(),
  ajuda: z.string().optional(),
  /** Campo sem valor bloqueia o avanço da solicitação de certificação. */
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

/**
 * Seção sem etapas é válida: é o estado de uma seção recém-criada na aba de
 * administração, antes de quem monta escrever o primeiro check.
 */
export const secaoSchema = z.object({
  id: z.string().min(1),
  titulo: z.string().min(1),
  descricao: z.string().optional(),
  etapas: z.array(etapaSchema).default([]),
});

/**
 * Formulário sem seções também é válido: é exatamente o que nasce junto com
 * um painel novo, para ser construído do zero.
 */
export const definicaoFormularioSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  linhaProduto: z.string().min(1),
  tipo: z.enum(['montagem', 'rotina']),
  revisao: z.string().min(1),
  dataRevisao: z.string().min(1),
  emitidoPor: z.string().optional().default(''),
  cabecalho: z.array(campoCabecalhoSchema).default([]),
  secoes: z.array(secaoSchema).default([]),
});

/**
 * Como o formulário aparece nas listas. Cada formulário pertence a um painel:
 * as etapas de um SEN Plus não valem para um MNS, então o vínculo é único e
 * mora na própria linha do formulário, não numa lista à parte.
 */
export const entradaCatalogoSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  tipo: z.enum(['montagem', 'rotina']),
  linhaProduto: z.string().min(1),
  painelSlug: z.string().min(1),
  ativo: z.boolean().optional().default(true),
  /** Etapas ativas; zero significa checklist ainda em construção. */
  etapas: z.number().optional().default(0),
  atualizadoEm: z.number().optional().default(0),
});

export type Condicao = z.output<typeof condicaoSchema>;
export type MidiaApoio = z.output<typeof midiaApoioSchema>;
export type CampoCabecalho = z.output<typeof campoCabecalhoSchema>;
export type TabelaReferencia = z.output<typeof tabelaReferenciaSchema>;
export type ConfigGrade = z.output<typeof gradeSchema>;
export type Etapa = z.output<typeof etapaSchema>;
export type Secao = z.output<typeof secaoSchema>;
export type DefinicaoFormulario = z.output<typeof definicaoFormularioSchema>;
export type EntradaCatalogo = z.output<typeof entradaCatalogoSchema>;

/** Converte um erro do Zod em texto legível para a aba de administração. */
export function descreverErro(erro: z.ZodError): string {
  return erro.issues
    .map((i) => {
      const caminho = i.path.length ? i.path.join(' › ') : 'raiz';
      return `• ${caminho}: ${i.message}`;
    })
    .join('\n');
}

export function validarDefinicao(bruto: unknown): DefinicaoFormulario {
  const analise = definicaoFormularioSchema.safeParse(bruto);
  if (!analise.success) throw new Error(descreverErro(analise.error));
  return analise.data;
}

/** Sufixo numérico de "S3" ou de "S3.7"; 0 quando o id não segue o padrão. */
function sufixo(id: string): number {
  const n = Number(id.split('.').pop()?.replace(/^\D+/, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Próximo id livre de seção. Usa o maior em uso mais um, e não a quantidade:
 * apagar S2 de S1..S3 precisa continuar gerando S4, senão o id novo colidiria
 * com o S3 que ficou.
 */
export function proximoIdSecao(secoes: readonly Secao[]): string {
  const maior = secoes.reduce((m, s) => Math.max(m, sufixo(s.id)), 0);
  return `S${maior + 1}`;
}

/** Próximo id livre de etapa dentro da seção, pela mesma regra. */
export function proximoIdEtapa(secao: Secao): string {
  const maior = secao.etapas.reduce((m, e) => Math.max(m, sufixo(e.id)), 0);
  return `${secao.id}.${maior + 1}`;
}

export function novaEtapa(secao: Secao): Etapa {
  return {
    id: proximoIdEtapa(secao),
    descricao: 'Nova verificação',
    tipoResposta: 'check_com_foto',
    observacao: true,
    ativa: true,
    fotoObrigatoria: false,
    midiaApoio: [],
  };
}

export function novaSecao(secoes: readonly Secao[]): Secao {
  return { id: proximoIdSecao(secoes), titulo: 'Nova seção', etapas: [] };
}

/** O formulário que nasce junto com um painel, pronto para ser construído. */
export function formularioEmBranco(entrada: {
  id: string;
  nome: string;
  linhaProduto: string;
  tipo: 'montagem' | 'rotina';
}): DefinicaoFormulario {
  return {
    id: entrada.id,
    nome: entrada.nome,
    linhaProduto: entrada.linhaProduto,
    tipo: entrada.tipo,
    revisao: 'rev00',
    dataRevisao: new Date().toISOString().slice(0, 10),
    emitidoPor: '',
    cabecalho: [],
    secoes: [],
  };
}

/** Etapas ativas do formulário — o que a tela de preenchimento vai exigir. */
export function contarEtapasAtivas(definicao: DefinicaoFormulario): number {
  return definicao.secoes.reduce(
    (total, s) => total + s.etapas.filter((e) => e.ativa !== false).length,
    0,
  );
}
