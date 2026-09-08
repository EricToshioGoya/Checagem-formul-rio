import { z } from 'zod';
import { campoCabecalhoSchema, descreverErro } from '../forms/schema';

/**
 * Catálogo dos tipos de painel (`/public/paineis/index.json`).
 *
 * É este arquivo que decide, para cada painel, quais checklists aparecem, qual
 * template de certificado é usado e quem é o responsável ABB pela validação.
 * Incluir um painel novo é acrescentar uma entrada aqui — o núcleo não muda.
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
    id: z.string().min(1),
    nome: z.string().min(1),
    descricao: z.string().optional().default(''),
    /**
     * `verificacao` — dossiê em PDF enviado ao inspetor (SEN Plus).
     * `certificacao` — solicitação, validação ABB e emissão de certificado.
     */
    fluxo: z.enum(fluxosPainel),
    formularios: z.array(z.string().min(1)).min(1),
    /** Id do template em `/public/certificados`. Exigido no fluxo de certificação. */
    certificado: z.string().min(1).optional(),
    responsavel: responsavelSchema.optional(),
    /**
     * Quem aprova o acesso do montador a este painel. Sem valor, vale
     * `RESPONSAVEL_MONTAGEM_PADRAO` do build.
     */
    responsavelMontagem: z.email().optional(),
    /** Quem edita os formulários deste painel. Sem lista, vale `ADMIN_PADRAO`. */
    administradores: z.array(z.email()).optional(),
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
