import { z } from 'zod';

/**
 * Schema do catálogo de painéis (`/public/paineis.json`). Como os
 * formulários, o arquivo é lido em tempo de execução: trocar o responsável
 * de um painel não exige recompilar a aplicação.
 */
export const painelSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  responsavelEmail: z.email(),
  responsavelNome: z.string().optional(),
  ativo: z.boolean().default(true),
});

export const catalogoPaineisSchema = z.object({
  urlAplicacao: z.string().optional(),
  paineis: z.array(painelSchema).min(1),
});
