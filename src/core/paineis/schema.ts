import { z } from 'zod';
import { campoCabecalhoSchema, descreverErro } from '../../../compartilhado/formulario';

/**
 * Catálogo dos fluxos por painel (`/public/paineis/index.json`).
 *
 * Os painéis em si — nome, responsáveis que aprovam o acesso e checklists —
 * moram no servidor e são cadastrados na administração. Este arquivo só
 * acrescenta, pelo `slug` do painel, o que é dado de publicação: o fluxo
 * (verificação ou certificação), o template do certificado e o responsável ABB
 * que assina. Painel do servidor sem entrada aqui segue o fluxo de verificação.
 */

export const fluxosPainel = ['verificacao', 'certificacao'] as const;

export const responsavelSchema = z.object({
  nome: z.string().min(1),
  cargo: z.string().min(1),
  area: z.string().optional().default(''),
  empresa: z.string().optional().default(''),
  email: z.string().optional().default(''),
});

export const painelSchema = z
  .object({
    /** `slug` do painel no servidor (`sen-plus`, `system-pro-e-energy`…). */
    id: z.string().min(1),
    nome: z.string().min(1),
    descricao: z.string().optional().default(''),
    /**
     * `verificacao` — dossiê em PDF enviado ao inspetor (SEN Plus).
     * `certificacao` — solicitação, validação ABB e emissão de certificado.
     */
    fluxo: z.enum(fluxosPainel),
    /** Id do template em `/public/certificados`. Exigido no fluxo de certificação. */
    certificado: z.string().min(1).optional(),
    responsavel: responsavelSchema.optional(),
    /** Sobrescreve `camposPadrao` do catálogo, quando este painel pedir outros campos. */
    campos: z.array(campoCabecalhoSchema).optional(),
    ativo: z.boolean().optional().default(true),
  })
  .refine((p) => p.fluxo !== 'certificacao' || (!!p.certificado && !!p.responsavel), {
    message: 'Painel de certificação exige "certificado" e "responsavel".',
  });

export const catalogoPaineisSchema = z.object({
  camposPadrao: z.array(campoCabecalhoSchema).default([]),
  paineis: z.array(painelSchema).min(1),
});

export { descreverErro };
