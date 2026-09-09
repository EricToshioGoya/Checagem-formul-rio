/**
 * Leitura e verificação da credencial de acesso.
 *
 * A verificação acontece no aparelho, sem rede: é o que permite abrir o
 * aplicativo no meio de uma montagem sem sinal. A chave pública ES256 vem
 * embutida no build; a privada só existe no servidor, então uma credencial
 * editada no armazenamento do navegador não passa daqui.
 */
import { CHAVE_PUBLICA_SESSAO } from '../config';
import type { Claims } from './tipos';

/** Margem de tolerância para relógio adiantado no aparelho. */
const TOLERANCIA_RELOGIO_MS = 60_000;

function base64UrlParaBytes(texto: string) {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const preenchido = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binario = atob(preenchido);

  // O ArrayBuffer explícito mantém o tipo aceito por crypto.subtle, que não
  // recebe visões sobre SharedArrayBuffer.
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

let chaveImportada: Promise<CryptoKey> | null = null;

/**
 * Importa a chave pública uma vez só e reaproveita a promessa — a tela de
 * abertura chega a verificar a credencial mais de uma vez.
 */
function chavePublica(): Promise<CryptoKey> {
  chaveImportada ??= (async () => {
    if (!CHAVE_PUBLICA_SESSAO) {
      throw new Error(
        'Build sem VITE_AUTH_CHAVE_PUBLICA: o aplicativo não consegue conferir ' +
          'a credencial de acesso. Gere a chave no servidor com "-gerar-chave".',
      );
    }
    return crypto.subtle.importKey(
      'jwk',
      JSON.parse(CHAVE_PUBLICA_SESSAO) as JsonWebKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  })();
  return chaveImportada;
}

/**
 * Confere assinatura e validade. Devolve os claims quando a credencial é
 * autêntica e ainda vale, e null em qualquer outro caso.
 */
export async function verificarCredencial(bruta: string): Promise<Claims | null> {
  const partes = bruta.split('.');
  if (partes.length !== 3) return null;

  try {
    const assinada = new Uint8Array(
      new TextEncoder().encode(`${partes[0]}.${partes[1]}`),
    );
    const assinatura = base64UrlParaBytes(partes[2]);

    const autentica = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await chavePublica(),
      assinatura,
      assinada,
    );
    if (!autentica) return null;

    const claims = JSON.parse(
      new TextDecoder().decode(base64UrlParaBytes(partes[1])),
    ) as Claims;

    if (Date.now() - TOLERANCIA_RELOGIO_MS >= claims.exp * 1000) return null;
    return claims;
  } catch {
    // Credencial malformada, chave ausente ou WebCrypto indisponível:
    // qualquer um desses casos significa "não autorizado".
    return null;
  }
}

/** Quantos dias faltam para a credencial expirar, para avisar o usuário. */
export function diasAteExpirar(claims: Claims): number {
  return Math.max(0, Math.ceil((claims.exp * 1000 - Date.now()) / 86_400_000));
}
