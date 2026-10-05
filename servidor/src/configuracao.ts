/**
 * Configuração de publicação, por variável de ambiente. Tudo opcional: sem
 * nada definido, o servidor sobe como em desenvolvimento.
 */

/**
 * Quantos proxies confiáveis ficam na frente do servidor (Caddy, nginx). Com
 * 1, o endereço do cliente vem do último item de `X-Forwarded-For`, que é o
 * que o proxy acrescentou — os anteriores o próprio cliente pode inventar.
 * Sem isso, atrás de um proxy todos chegam com o mesmo endereço, e errar a
 * senha 5 vezes bloquearia a conta para todo mundo.
 */
export const CONFIAR_PROXY = Math.max(0, Math.floor(Number(process.env.CONFIAR_PROXY ?? 0) || 0));

/** HTTPS direto no Node, sem proxy: caminhos do certificado e da chave (PEM). */
export const HTTPS_CERTIFICADO = process.env.HTTPS_CERTIFICADO?.trim() || '';
export const HTTPS_CHAVE = process.env.HTTPS_CHAVE?.trim() || '';
export const HTTPS_ATIVO = Boolean(HTTPS_CERTIFICADO && HTTPS_CHAVE);

/**
 * Pasta do aplicativo compilado (`npm run build`). Se existir, o próprio
 * servidor o entrega, e aplicativo e API ficam no mesmo endereço — sem proxy
 * para juntar os dois e sem CORS.
 */
export const PASTA_APP = process.env.APP_PASTA ?? 'dist';

/** Endereço do cliente, respeitando os proxies confiáveis. */
export function enderecoDoCliente(encaminhado: string | string[] | undefined, socket: string): string {
  if (!CONFIAR_PROXY || !encaminhado) return socket;
  const lista = (Array.isArray(encaminhado) ? encaminhado.join(',') : encaminhado)
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean);
  return lista[lista.length - CONFIAR_PROXY] ?? lista[0] ?? socket;
}
