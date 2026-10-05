import { z } from 'zod';

/**
 * Validação de tudo que chega pela rede. Nenhum handler lê `body` cru:
 * o corpo passa por um destes esquemas antes de virar SQL.
 */

// As mensagens padrão do zod, que aparecem quando não há uma própria, em
// português — antes chegavam à tela como "Invalid input: expected object".
z.config(z.locales.ptBR());

/**
 * Texto de uma linha: sem caracteres de controle, que chegam colados de
 * outros programas e derrubavam a geração do PDF, nem espaços repetidos.
 */
function limparLinha(valor: string): string {
  return valor
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto de uma linha com tamanho mínimo e máximo, já limpo. */
function linha(minimo: number, maximo: number, faltando: string, sobrando: string) {
  return z.string().transform(limparLinha).pipe(z.string().min(minimo, faltando).max(maximo, sobrando));
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Informe o e-mail.')
  .max(200, 'E-mail longo demais.')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'E-mail inválido.');

/**
 * Mínimo de 8 caracteres. Sem exigência de símbolo: regra decorada vira
 * senha anotada no capacete, e aqui quem protege o acesso é a aprovação
 * do dono, não a força da senha.
 */
export const senhaSchema = z
  .string()
  .min(8, 'A senha precisa de pelo menos 8 caracteres.')
  .max(200, 'Senha longa demais.');

/**
 * Como a pessoa entra: montador (o padrão) ou administrador. É a escolha da
 * tela de login, e decide o tipo de sessão aberta.
 */
const perfilSchema = z.enum(['montador', 'admin']).optional().default('montador');

export const entrarSchema = z.object({
  email: emailSchema,
  senha: senhaSchema,
  perfil: perfilSchema,
});

export const cadastrarSchema = z.object({
  email: emailSchema,
  senha: senhaSchema,
  nome: linha(2, 120, 'Informe o seu nome.', 'Nome longo demais.'),
  perfil: perfilSchema,
});

/** Conta existente pedindo para virar administrador: prova quem é com a senha. */
export const pedidoAdminSchema = z.object({
  email: emailSchema,
  senha: senhaSchema,
});

/**
 * Painel cadastrado pela administração. `responsaveis` é a lista de e-mails
 * que podem aprovar montadores naquele painel — pelo menos um, sem limite
 * acima disso, sem repetição.
 */
export const painelSchema = z.object({
  nome: linha(2, 120, 'Informe o nome do painel.', 'Nome do painel longo demais.'),
  descricao: z.string().transform(limparLinha).pipe(z.string().max(500)).optional(),
  responsaveis: z
    .array(emailSchema)
    .min(1, 'Informe ao menos um e-mail de responsável.')
    .max(50, 'São no máximo 50 responsáveis por painel.')
    .transform((lista) => [...new Set(lista)]),
});

export const solicitarSchema = z.object({
  mensagem: z.string().transform(limparLinha).pipe(z.string().max(500)).optional(),
});

/** Criação de um checklist: o conteúdo vem depois, pelo editor. */
export const formularioNovoSchema = z.object({
  tipo: z.enum(['montagem', 'rotina']),
  nome: linha(2, 200, 'Informe o nome do checklist.', 'Nome do checklist longo demais.').optional(),
});

/**
 * Gravação de um checklist. `definicao` não é detalhada aqui: ela passa pelo
 * esquema compartilhado com o cliente em `formularios.validar`, que é a
 * autoridade sobre a forma de seções e etapas.
 */
export const formularioSchema = z.object({
  nome: linha(2, 200, 'Informe o nome do checklist.', 'Nome do checklist longo demais.'),
  ativo: z.boolean().optional().default(true),
  definicao: z.unknown(),
});

export const decisaoSchema = z.object({
  aprovar: z.boolean(),
});

/** Cinco anos: acima disso, "sem prazo" diz a mesma coisa com mais clareza. */
export const HORAS_MAXIMAS = 5 * 366 * 24;

/**
 * Por quanto tempo o acesso vale. `horas` conta a partir do relógio do
 * servidor; `ate` é uma data escolhida pelo administrador, já absoluta.
 */
export const validadeSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('indeterminado') }),
  z.object({
    tipo: z.literal('horas'),
    horas: z
      .number()
      .min(1 / 60, 'O prazo mínimo é de 1 minuto.')
      .max(HORAS_MAXIMAS, 'Prazo longo demais — use "sem prazo".'),
  }),
  z.object({ tipo: z.literal('ate'), ate: z.number().int().positive() }),
]);

/** Liberação direta pela administração, sem pedido do montador. */
export const liberarAcessoSchema = z.object({
  usuarioId: z.number().int().positive('Escolha o montador.'),
  painelIds: z
    .array(z.number().int().positive())
    .min(1, 'Escolha ao menos um painel.')
    .max(200)
    .transform((lista) => [...new Set(lista)]),
  validade: validadeSchema,
});

export const prazoAcessoSchema = z.object({
  validade: validadeSchema,
});

// ---------------------------------------------------------- sincronização

const uidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Identificador inválido.');

/** Tipos de arquivo que o aparelho grava: foto comprimida em JPEG e anexo em PDF. */
export const MIMES_MIDIA = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

/** 25 MB: um anexo PDF de laudo cabe; uma foto comprimida fica bem abaixo. */
export const TAMANHO_MAXIMO_MIDIA = 25 * 1024 * 1024;

const textoCurto = z.string().max(300);

/**
 * O projeto de um montador num painel, como o aparelho o envia: os dados do
 * projeto, as TAGs, as respostas por TAG e checklist, e a lista das mídias —
 * só a descrição; o arquivo de cada uma vai à parte.
 */
export const documentoProjetoSchema = z.object({
  projeto: z.object({
    empresa: textoCurto,
    nomeProjeto: textoCurto,
    operador: textoCurto,
    numeroPedido: textoCurto.optional(),
    painelSlug: textoCurto.optional(),
    criadoEm: z.number(),
    atualizadoEm: z.number(),
  }),
  tags: z
    .array(
      z.object({
        uid: uidSchema,
        nome: textoCurto,
        ordem: z.number().int(),
        // Checklists escolhidos para a TAG; ausente, ela segue com todos.
        formIds: z.array(textoCurto).max(100).optional(),
      }),
    )
    .max(1000),
  preenchimentos: z
    .array(
      z.object({
        tagUid: uidSchema,
        formId: textoCurto,
        formRevisao: textoCurto,
        cabecalho: z.record(z.string().max(200), z.string().max(5000)),
        respostas: z.record(
          z.string().max(200),
          z.object({ valor: z.unknown(), observacao: z.string().max(10_000).optional() }),
        ),
        atualizadoEm: z.number(),
      }),
    )
    .max(20_000),
  midias: z
    .array(
      z.object({
        uid: uidSchema,
        tagUid: uidSchema,
        formId: textoCurto,
        etapaId: textoCurto,
        mime: z.enum(MIMES_MIDIA),
        largura: z.number(),
        altura: z.number(),
        tamanho: z.number().int().min(0).max(TAMANHO_MAXIMO_MIDIA),
        nomeOriginal: textoCurto.optional(),
        criadoEm: z.number(),
        ordem: z.number().int(),
      }),
    )
    .max(50_000),
});

export type DocumentoProjeto = z.output<typeof documentoProjetoSchema>;

/**
 * `versaoBase` é a versão do servidor da qual o aparelho partiu. Se outro
 * aparelho da mesma conta enviou depois disso, o envio é recusado (409) e o
 * aparelho junta as duas versões antes de mandar de novo.
 */
export const envioProjetoSchema = z.object({
  versaoBase: z.number().int().min(0),
  documento: documentoProjetoSchema,
});

/** Primeira mensagem de erro, em texto que cabe na tela do montador. */
export function primeiroErro(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? 'Dados inválidos.';
}
