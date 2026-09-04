import { z } from 'zod';
import { descreverErro } from '../forms/schema';

/**
 * Template de certificado (`/public/certificados/<id>.json`).
 *
 * O corpo é dado, não código: um painel novo entra com um arquivo destes e a
 * respectiva entrada no catálogo de painéis, sem reescrever o gerador de PDF.
 * Os textos aceitam marcadores `{{campo}}`, resolvidos contra os dados da
 * solicitação aprovada e o responsável ABB do painel.
 */

export const blocoSchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('campos'),
    itens: z
      .array(z.object({ rotulo: z.string().min(1), valor: z.string().min(1) }))
      .min(1),
  }),
  z.object({ tipo: z.literal('titulo'), texto: z.string().min(1) }),
  z.object({ tipo: z.literal('paragrafo'), texto: z.string().min(1) }),
  z.object({ tipo: z.literal('lista'), itens: z.array(z.string().min(1)).min(1) }),
  z.object({ tipo: z.literal('nota'), texto: z.string().min(1) }),
  z.object({
    tipo: z.literal('campoLargo'),
    rotulo: z.string().min(1),
    valor: z.string().min(1),
  }),
  z.object({
    tipo: z.literal('assinatura'),
    nome: z.string().min(1),
    linhas: z.array(z.string().min(1)).default([]),
  }),
]);

export const templateCertificadoSchema = z.object({
  id: z.string().min(1),
  painelId: z.string().min(1),
  /** Único texto que difere entre os painéis, junto do bloco de assinatura. */
  tituloProduto: z.string().min(1),
  numero: z.string().min(1).optional().default('Nº {{numeroCertificado}}'),
  rodape: z.string().optional().default(''),
  blocos: z.array(blocoSchema).min(1),
});

export { descreverErro };
