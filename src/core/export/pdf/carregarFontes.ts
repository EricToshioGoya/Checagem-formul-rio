import regular from './fontes/Inter-Regular.ttf?url';
import medio from './fontes/Inter-Medium.ttf?url';
import seminegrito from './fontes/Inter-SemiBold.ttf?url';
import negrito from './fontes/Inter-Bold.ttf?url';
import type { BytesFontes } from './tema';

async function baixar(url: string): Promise<Uint8Array> {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`Fonte indisponível: ${url}`);
  return new Uint8Array(await resposta.arrayBuffer());
}

/**
 * Busca a Inter empacotada com a aplicação (entra no precache do service
 * worker, então funciona offline). Se falhar, o PDF sai em Helvetica.
 */
export async function carregarFontesPdf(): Promise<BytesFontes | undefined> {
  try {
    const [r, m, s, n] = await Promise.all([regular, medio, seminegrito, negrito].map(baixar));
    return { regular: r, medio: m, seminegrito: s, negrito: n };
  } catch {
    return undefined;
  }
}
