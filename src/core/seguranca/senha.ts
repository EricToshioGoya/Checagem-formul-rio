/**
 * Verificação da senha da aba de administração.
 *
 * O bundle publicado carrega apenas o hash PBKDF2-SHA256 da senha, nunca a
 * senha em texto claro. Formato (gerado por `npm run gerar-hash-senha`):
 *
 *   pbkdf2-sha256:<iterações>:<sal em hex>:<hash em hex>
 *
 * Limite conhecido: toda a verificação roda no aparelho. O hash impede ler a
 * senha no código publicado e encarece a tentativa por força bruta, mas a aba
 * de administração continua sem ser uma fronteira de segurança — ela só edita
 * os modelos de formulário guardados no próprio aparelho.
 */

const PREFIXO = 'pbkdf2-sha256';
const ITERACOES_MINIMAS = 100_000;
const BYTES_HASH = 32;
const BYTES_SAL_MINIMO = 16;

export interface HashSenha {
  iteracoes: number;
  sal: Uint8Array<ArrayBuffer>;
  hash: Uint8Array<ArrayBuffer>;
}

function hexParaBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Interpreta o valor configurado. Devolve `null` se estiver ausente ou malformado. */
export function interpretarHash(valor: string | undefined): HashSenha | null {
  if (!valor) return null;
  const partes = valor.trim().split(':');
  if (partes.length !== 4 || partes[0] !== PREFIXO) return null;
  const iteracoes = Number(partes[1]);
  if (!Number.isInteger(iteracoes) || iteracoes < ITERACOES_MINIMAS) return null;
  const sal = hexParaBytes(partes[2]);
  const hash = hexParaBytes(partes[3]);
  if (!sal || sal.length < BYTES_SAL_MINIMO || !hash || hash.length !== BYTES_HASH) return null;
  return { iteracoes, sal, hash };
}

/** Comparação que não encerra no primeiro byte diferente. */
function iguaisTempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i += 1) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

export async function conferirSenha(senha: string, esperado: HashSenha): Promise<boolean> {
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(senha),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: esperado.sal, iterations: esperado.iteracoes },
    chave,
    BYTES_HASH * 8,
  );
  return iguaisTempoConstante(new Uint8Array(bits), esperado.hash);
}
