import type { z } from 'zod';
import type {
  campoCabecalhoSchema,
  catalogoSchema,
  condicaoSchema,
  definicaoFormularioSchema,
  entradaCatalogoSchema,
  etapaSchema,
  gradeSchema,
  midiaApoioSchema,
  secaoSchema,
  tabelaReferenciaSchema,
  tiposCampo,
  tiposResposta,
} from './schema';

export type TipoResposta = (typeof tiposResposta)[number];
export type TipoCampo = (typeof tiposCampo)[number];
export type Condicao = z.output<typeof condicaoSchema>;
export type MidiaApoio = z.output<typeof midiaApoioSchema>;
export type CampoCabecalho = z.output<typeof campoCabecalhoSchema>;
export type TabelaReferencia = z.output<typeof tabelaReferenciaSchema>;
export type ConfigGrade = z.output<typeof gradeSchema>;
export type Etapa = z.output<typeof etapaSchema>;
export type Secao = z.output<typeof secaoSchema>;
export type DefinicaoFormulario = z.output<typeof definicaoFormularioSchema>;
export type EntradaCatalogo = z.output<typeof entradaCatalogoSchema>;
export type Catalogo = z.output<typeof catalogoSchema>;

/** Valor de uma grade numérica: linha → coluna → número informado. */
export type ValorGrade = Record<string, Record<string, number | null>>;

export type ValorResposta = boolean | number | string | ValorGrade | null;

export interface Resposta {
  valor: ValorResposta;
  observacao?: string;
}

/** `etapaId` → resposta. Etapas não respondidas simplesmente não existem no mapa. */
export type MapaRespostas = Record<string, Resposta>;

/** `campoId` → valor informado no cabeçalho do formulário, por TAG. */
export type ValoresCabecalho = Record<string, string>;
