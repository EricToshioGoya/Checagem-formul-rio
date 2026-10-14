import { z } from 'zod';
import { campoCabecalhoSchema, descreverErro } from '../../../compartilhado/formulario';

/**
 * Campos da solicitação de certificação (`/public/paineis/index.json`).
 *
 * Os painéis em si — nome, modelo do certificado, quem assina e
 * responsáveis — moram no servidor e se cadastram
 * na administração. Este arquivo guarda só o que é dado de publicação: os
 * campos padrão que a solicitação pede.
 */

/** Quem assina o certificado (ABB). */
export const responsavelSchema = z.object({
  nome: z.string().min(1),
  cargo: z.string().min(1),
  area: z.string().optional().default(''),
  empresa: z.string().optional().default(''),
  email: z.string().optional().default(''),
});

export const catalogoPaineisSchema = z.object({
  camposPadrao: z.array(campoCabecalhoSchema).default([]),
});

export { descreverErro };
