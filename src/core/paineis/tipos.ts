import type { z } from 'zod';
import type { catalogoPaineisSchema, responsavelSchema } from './schema';

/** Quem assina o certificado (ABB). */
export type ResponsavelAbb = z.output<typeof responsavelSchema>;
export type CatalogoPaineis = z.output<typeof catalogoPaineisSchema>;

/** Painel como as telas de certificação o usam; `id` é o `slug` do painel. */
export interface Painel {
  id: string;
  nome: string;
  descricao: string;
  /** Modelo do certificado, em `/public/certificados`. */
  certificado?: string;
  /** Quem assina o certificado. */
  responsavel?: ResponsavelAbb;
}
