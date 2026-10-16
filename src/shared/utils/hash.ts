/**
 * SHA-256 do arquivo em hexadecimal, para o servidor conferir que recebeu
 * exatamente o que saiu do aparelho. Fora de contexto seguro (sem
 * `crypto.subtle`) volta indefinido e o envio segue sem a conferência.
 */
export async function sha256Hex(blob: Blob): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  try {
    const resumo = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(resumo), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}
