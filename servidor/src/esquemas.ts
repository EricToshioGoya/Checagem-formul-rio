import { UID } from './midias';
import { ehMimeDeVideo, MIMES_VIDEO, TAMANHO_MAXIMO_VIDEO } from '../../compartilhado/midias';
import { PADRAO_ID_TIPO } from '../../compartilhado/tiposChecklist';
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
/** Quem assina o certificado (ABB), nos checklists que emitem certificado. */
export const signatarioSchema = z.object({
  nome: linha(2, 120, 'Informe o nome de quem assina.', 'Nome longo demais.'),
  cargo: linha(2, 160, 'Informe o cargo de quem assina.', 'Cargo longo demais.'),
  area: z.string().transform(limparLinha).pipe(z.string().max(120)).optional().default(''),
  empresa: z.string().transform(limparLinha).pipe(z.string().max(120)).optional().default(''),
  email: z.string().transform(limparLinha).pipe(z.string().max(160)).optional().default(''),
});

export const painelSchema = z
  .object({
    nome: linha(2, 120, 'Informe o nome do painel.', 'Nome do painel longo demais.'),
    descricao: z.string().transform(limparLinha).pipe(z.string().max(500)).optional(),
    responsaveis: z
      .array(emailSchema)
      .min(1, 'Escolha ao menos um administrador responsável.')
      .max(50, 'São no máximo 50 responsáveis por painel.')
      .transform((lista) => [...new Set(lista)]),
    /**
     * Modelo do certificado (`public/certificados/<id>.json`) e quem o assina.
     * Opcionais: só os checklists marcados com "Emite certificado" os usam.
     */
    certificado: z.string().regex(/^[a-z0-9-]{1,60}$/, 'Modelo de certificado inválido.').optional(),
    signatario: signatarioSchema.optional(),
  })
  .refine((p) => !!p.certificado === !!p.signatario, {
    message: 'Para emitir certificado, informe o modelo e quem assina.',
    path: ['certificado'],
  });

export const solicitarSchema = z.object({
  mensagem: z.string().transform(limparLinha).pipe(z.string().max(500)).optional(),
});

/** Criação de um checklist: o conteúdo vem depois, pelo editor. */
export const formularioNovoSchema = z.object({
  tipo: z.string().regex(PADRAO_ID_TIPO, 'Tipo de checklist inválido.'),
  nome: linha(2, 200, 'Informe o nome do checklist.', 'Nome do checklist longo demais.').optional(),
});

/** Tipo de checklist criado ou renomeado pela administração. */
export const tipoChecklistSchema = z.object({
  rotulo: linha(2, 60, 'Informe o nome do tipo de verificação.', 'Nome do tipo longo demais.').refine(
    (r) => /[\p{L}\p{N}]/u.test(r),
    'O nome do tipo precisa ter letras ou números.',
  ),
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

const uidSchema = z.string().regex(UID, 'Identificador inválido.');

/** Tipos de arquivo que o aparelho grava: foto comprimida em JPEG, anexo em PDF e vídeo. */
export const MIMES_MIDIA = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  ...MIMES_VIDEO,
] as const;

/** 25 MB: um anexo PDF de laudo cabe; uma foto comprimida fica bem abaixo. */
export const TAMANHO_MAXIMO_MIDIA = 25 * 1024 * 1024;

/** Limite do arquivo pelo tipo: o vídeo tem o seu, maior. */
export function tamanhoMaximoDe(mime: string): number {
  return ehMimeDeVideo(mime) ? TAMANHO_MAXIMO_VIDEO : TAMANHO_MAXIMO_MIDIA;
}

/** O tamanho declarado de uma mídia cabe no limite do tipo dela. */
const dentroDoLimite = (m: { mime: string; tamanho: number }) => m.tamanho <= tamanhoMaximoDe(m.mime);
const MENSAGEM_LIMITE = { message: 'Arquivo grande demais para o tipo.', path: ['tamanho'] };

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
        tamanho: z.number().int().min(0).max(TAMANHO_MAXIMO_VIDEO),
        nomeOriginal: textoCurto.optional(),
        criadoEm: z.number(),
        ordem: z.number().int(),
      }).refine(dentroDoLimite, MENSAGEM_LIMITE),
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
  /**
   * Painel do projeto: decide o acesso e o checklist do andamento. Ausente no
   * envio do aplicativo anterior, que põe o painel na URL.
   */
  painelId: z.number().int().positive().optional(),
  documento: documentoProjetoSchema,
});

/**
 * Solicitação de certificação enviada pelo montador para validação. O estado
 * não vem daqui: quem muda é o servidor, pelas rotas de enviar, aprovar e
 * devolver.
 */
export const envioCertificacaoSchema = z.object({
  versaoBase: z.number().int().min(0),
  painelId: z.number().int().positive(),
  formId: textoCurto,
  criadoEm: z.number(),
  dados: z.record(z.string().max(200), z.string().max(5000)),
  preenchimento: z.object({
    formRevisao: textoCurto,
    cabecalho: z.record(z.string().max(200), z.string().max(5000)),
    respostas: z.record(
      z.string().max(200),
      z.object({ valor: z.unknown(), observacao: z.string().max(10_000).optional() }),
    ),
  }),
  midias: z
    .array(
      z.object({
        uid: uidSchema,
        etapaId: textoCurto,
        mime: z.enum(MIMES_MIDIA),
        largura: z.number(),
        altura: z.number(),
        tamanho: z.number().int().min(0).max(TAMANHO_MAXIMO_VIDEO),
        nomeOriginal: textoCurto.optional(),
        criadoEm: z.number(),
        ordem: z.number().int(),
      }).refine(dentroDoLimite, MENSAGEM_LIMITE),
    )
    .max(2000),
});

export type EnvioCertificacao = z.output<typeof envioCertificacaoSchema>;

// ------------------------------------------------- aprovação e devolução

/**
 * Etapa marcada como não conforme pela administração. `etapaId` é o id da
 * etapa no checklist, ou `__cabecalho__` para os dados do painel. O nome da
 * TAG e o texto da etapa são completados pelo servidor, a partir do envio.
 */
export const ID_CABECALHO = '__cabecalho__';

export const itemNaoConformeSchema = z.object({
  tagUid: uidSchema.optional(),
  formId: textoCurto,
  etapaId: z.string().min(1).max(200),
  motivo: z
    .string()
    .trim()
    .min(1, 'Descreva o problema de cada etapa marcada.')
    .max(2000, 'Descrição longa demais.'),
});

export type ItemNaoConforme = z.output<typeof itemNaoConformeSchema>;

const listaDeItens = z
  .array(itemNaoConformeSchema)
  .max(2000, 'Itens demais numa só decisão.')
  .optional()
  .default([]);

const comentarioSchema = z.string().trim().max(4000, 'Comentário longo demais.').optional().default('');

/** Devolução de uma certificação: etapas marcadas e/ou comentário geral. */
export const devolucaoSchema = z
  .object({
    apontamentos: comentarioSchema,
    itens: listaDeItens,
    /** Versão que a administração analisou; outra versão no servidor recusa a decisão. */
    versao: z.number().int().min(0).optional(),
  })
  .refine((d) => d.apontamentos.length > 0 || d.itens.length > 0, {
    message: 'Marque ao menos uma etapa não conforme ou escreva um comentário.',
  });

/** Envio do PDF de um projeto (um tipo de verificação) para aprovação. */
export const envioVerificacaoSchema = z.object({
  uid: uidSchema,
  pdfUid: uidSchema,
  painelId: z.number().int().positive(),
  projetoUid: uidSchema,
  tipo: z.string().regex(PADRAO_ID_TIPO, 'Tipo de verificação inválido.'),
  geradoEm: z.number().int().positive(),
  documento: documentoProjetoSchema,
});

/** Fim do envio: as fotos que não existem mais no aparelho vão como ausentes. */
export const conclusaoVerificacaoSchema = z.object({
  ausentes: z.array(uidSchema).max(50_000).optional().default([]),
});

/** Decisão da administração sobre um envio de verificação. */
export const decisaoVerificacaoSchema = z
  .object({
    decisao: z.enum(['aprovada', 'reprovada']),
    comentario: comentarioSchema,
    itens: listaDeItens,
  })
  .refine((d) => d.decisao === 'reprovada' || d.itens.length === 0, {
    message: 'Um envio aprovado não pode ter etapas marcadas como não conformes.',
  })
  .refine((d) => d.decisao === 'aprovada' || d.comentario.length > 0 || d.itens.length > 0, {
    message: 'Para reprovar, marque ao menos uma etapa não conforme ou escreva um comentário.',
  });

/** Primeira mensagem de erro, em texto que cabe na tela do montador. */
export function primeiroErro(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? 'Dados inválidos.';
}
