import type { z } from 'zod';
import type {
  catalogoPaineisSchema,
  fluxosPainel,
  painelSchema,
  responsavelSchema,
} from './schema';

export type FluxoPainel = (typeof fluxosPainel)[number];
export type ResponsavelAbb = z.output<typeof responsavelSchema>;
export type Painel = z.output<typeof painelSchema>;
export type CatalogoPaineis = z.output<typeof catalogoPaineisSchema>;
