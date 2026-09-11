import { z } from 'zod';
import { descreverErro } from '../forms/schema';

/**
 * Formato do `.zip` de exportação de projeto.
 *
 * O pacote chega de outro aparelho, por pendrive ou anexo de e-mail, e nada
 * garante que tenha sobrevivido inteiro à viagem. Sem esta validação, um
 * arquivo corrompido era gravado como veio e derrubava a aplicação na abertura
 * seguinte — sem caminho de volta pela interface.
 */

const respostaSchema = z.object({
  // O valor depende do tipo da etapa (booleano, número, texto ou grade), então
  // aqui só se exige que exista; o motor de formulários trata cada tipo.
  valor: z.unknown(),
  observacao: z.string().optional(),
});

export const pacoteSchema = z.object({
  versao: z.number().int(),
  exportadoEm: z.string().optional(),
  projeto: z.object({
    empresa: z.string(),
    nomeProjeto: z.string(),
    operador: z.string(),
    numeroPedido: z.string().optional(),
    criadoEm: z.number(),
    atualizadoEm: z.number(),
  }),
  tags: z.array(
    z.object({
      chave: z.number(),
      nome: z.string(),
      ordem: z.number(),
    }),
  ),
  preenchimentos: z.array(
    z.object({
      chave: z.number(),
      tagChave: z.number(),
      formId: z.string().min(1),
      formRevisao: z.string(),
      cabecalho: z.record(z.string(), z.string()),
      respostas: z.record(z.string(), respostaSchema),
      atualizadoEm: z.number(),
    }),
  ),
  midias: z.array(
    z.object({
      preenchimentoChave: z.number(),
      etapaId: z.string().min(1),
      // Nome dentro da pasta `fotos/` do próprio ZIP: um único segmento, para
      // que o pacote não consiga apontar para fora dela.
      arquivo: z.string().regex(/^[A-Za-z0-9._-]+$/, 'nome de arquivo inválido'),
      mime: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
      largura: z.number(),
      altura: z.number(),
      tamanho: z.number(),
      nomeOriginal: z.string().optional(),
      criadoEm: z.number(),
      ordem: z.number(),
    }),
  ),
});

export type Pacote = z.output<typeof pacoteSchema>;

/** Valida o pacote e descreve o problema em português quando ele não serve. */
export function validarPacote(bruto: unknown): Pacote {
  const analise = pacoteSchema.safeParse(bruto);
  if (!analise.success) {
    throw new Error(
      `O arquivo não está no formato de exportação desta aplicação:\n${descreverErro(analise.error)}`,
    );
  }
  return analise.data;
}
