import { SEGREDO_APROVACAO } from '../config';
import { normalizarEmail } from '../auth/acesso';

/**
 * Código de aprovação.
 *
 * A aplicação não tem servidor: o aparelho do montador não consegue saber,
 * por conta própria, que o responsável aprovou o pedido. O código resolve
 * isso sem rede — é derivado de `e-mail + painel + segredo do build`, de modo
 * que o aparelho do responsável (que roda a mesma aplicação, com o mesmo
 * segredo) calcula exatamente o mesmo valor. O responsável abre o link do
 * e-mail, lê o código e o repassa ao montador, que o digita para liberar.
 *
 * Só o responsável vê o código: o e-mail enviado pelo montador leva apenas o
 * link de aprovação, nunca o código.
 */

// Sem 0/O/1/I: o código é lido em voz alta e digitado com luva.
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TAMANHO = 8;

/** Aceita espaços, hífens e minúsculas na digitação do montador. */
export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function formatarCodigo(codigo: string): string {
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

export async function gerarCodigo(email: string, painelId: string): Promise<string> {
  const material = `${normalizarEmail(email)}|${painelId}|${SEGREDO_APROVACAO}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const bytes = new Uint8Array(digest);
  let saida = '';
  for (let i = 0; i < TAMANHO; i += 1) {
    saida += ALFABETO[bytes[i] % ALFABETO.length];
  }
  return saida;
}

export async function codigoConfere(
  email: string,
  painelId: string,
  digitado: string,
): Promise<boolean> {
  const esperado = await gerarCodigo(email, painelId);
  return normalizarCodigo(digitado) === esperado;
}
