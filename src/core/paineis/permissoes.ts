import { z } from 'zod';
import { PermissaoRepository } from '../db/repositorios';

/**
 * Permissões de uso, por painel.
 *
 * Cada painel decide se exige identificação e de quais empresas ela é aceita.
 * O que a ABB mantém é a lista de **domínios** — `parceiro.com.br` —, não a
 * lista de pessoas: parceiro entra e sai devagar, montador entra e sai toda
 * hora.
 *
 * Isto é declaração, não autenticação: o montador informa o e-mail e a
 * ferramenta confere o domínio. Barra o uso casual por quem não é do
 * parceiro; não barra quem edita o pacote JavaScript. Barreira dura exige
 * login de verdade (Entra ID) ou servidor, e esta configuração já é a que
 * alimentará os dois.
 *
 * Precedência: o que a aba de administração gravou neste aparelho vence o
 * arquivo publicado em `/public/paineis/permissoes.json`.
 */

export const permissaoPainelSchema = z.object({
  /** Sem isto, o painel abre direto — é o padrão. */
  exigirIdentificacao: z.boolean().optional().default(false),
  /**
   * Com isto, o e-mail informado vira um pedido de acesso no servidor e o
   * painel só abre depois que a administração liberar. É a única trava que
   * não depende do aparelho do montador.
   */
  exigirLiberacao: z.boolean().optional().default(false),
  /**
   * Domínios aceitos, sem `@`. Lista vazia com identificação exigida aceita
   * qualquer domínio: pede o e-mail, mas não restringe a empresa.
   */
  dominios: z.array(z.string().min(1)).optional().default([]),
  /** Texto mostrado a quem é recusado. Vazio, vale a mensagem padrão. */
  aviso: z.string().optional(),
});

export const permissoesSchema = z.object({
  paineis: z.record(z.string(), permissaoPainelSchema).optional().default({}),
});

export type PermissaoPainel = z.output<typeof permissaoPainelSchema>;

export const PERMISSAO_LIVRE: PermissaoPainel = {
  exigirIdentificacao: false,
  exigirLiberacao: false,
  dominios: [],
};

const base = import.meta.env.BASE_URL;
let publicadasCache: Record<string, PermissaoPainel> | null = null;

/** Arquivo publicado. Ausente ou inválido, ninguém fica trancado do lado de fora. */
async function permissoesPublicadas(): Promise<Record<string, PermissaoPainel>> {
  if (publicadasCache) return publicadasCache;
  try {
    const resposta = await fetch(`${base}paineis/permissoes.json`, { cache: 'no-cache' });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    publicadasCache = permissoesSchema.parse(await resposta.json()).paineis;
  } catch {
    publicadasCache = {};
  }
  return publicadasCache;
}

export function limparCachePermissoes(): void {
  publicadasCache = null;
}

export async function permissaoDoPainel(painelId: string): Promise<PermissaoPainel> {
  const local = await PermissaoRepository.obter(painelId);
  if (local) {
    const analise = permissaoPainelSchema.safeParse(local.permissao);
    if (analise.success) return analise.data;
    console.error(`Permissão local do painel "${painelId}" inválida; usando a publicada.`);
  }
  return (await permissoesPublicadas())[painelId] ?? PERMISSAO_LIVRE;
}

/** Normaliza `@Empresa.COM.BR `, ` empresa.com.br` e `x@empresa.com.br` no mesmo domínio. */
export function normalizarDominio(bruto: string): string {
  const limpo = bruto.trim().toLowerCase();
  const depoisDoArroba = limpo.slice(limpo.lastIndexOf('@') + 1);
  return depoisDoArroba.replace(/^\.+|\.+$/g, '');
}

export function dominioDoEmail(email: string): string {
  return normalizarDominio(email);
}

/**
 * O domínio do e-mail está liberado neste painel? Lista vazia libera todos —
 * a identificação vira registro, não restrição.
 */
export function dominioPermitido(email: string, permissao: PermissaoPainel): boolean {
  if (!permissao.dominios.length) return true;
  const dominio = dominioDoEmail(email);
  return permissao.dominios.some((d) => {
    const alvo = normalizarDominio(d);
    return dominio === alvo || dominio.endsWith(`.${alvo}`);
  });
}
