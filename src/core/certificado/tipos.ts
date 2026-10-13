import type { z } from 'zod';
import type { blocoSchema, templateCertificadoSchema } from './schema';

export type BlocoCertificado = z.output<typeof blocoSchema>;
export type TemplateCertificado = z.output<typeof templateCertificadoSchema>;

/** Valores que substituem os marcadores `{{campo}}` do template. */
export type ContextoCertificado = Record<string, string>;
