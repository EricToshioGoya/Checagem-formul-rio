import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { PASTA_APP } from './configuracao';

/**
 * Entrega do aplicativo compilado (`npm run build`) pelo próprio servidor.
 * Aplicativo e API no mesmo endereço é o que o cliente assume em produção, e
 * assim não é preciso um proxy só para juntar os dois.
 */

const RAIZ = resolve(PASTA_APP);

/** Lido a cada pedido: um `npm run build` com o servidor no ar passa a valer na hora. */
export function aplicativoDisponivel(): boolean {
  return existsSync(join(RAIZ, 'index.html'));
}

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Política de segurança do aplicativo: código, estilos e chamadas só do
 * próprio endereço. Se um dia entrar texto malicioso na tela, ele não consegue
 * carregar script de fora nem mandar a sessão para outro lugar.
 */
export const POLITICA_SEGURANCA = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Arquivos que mudam a cada versão sem mudar de nome: o navegador sempre confere. */
const SEM_CACHE = new Set(['/index.html', '/sw.js', '/registerSW.js', '/manifest.webmanifest']);

/**
 * Entrega um arquivo do aplicativo; `false` se não houver. O caminho é
 * resolvido dentro da pasta do aplicativo e nada fora dela sai daqui.
 */
export function servirArquivo(
  caminhoUrl: string,
  res: ServerResponse,
  cabecalhos: Record<string, string>,
): boolean {
  if (!aplicativoDisponivel()) return false;
  const relativo = caminhoUrl === '/' ? '/index.html' : caminhoUrl;
  const arquivo = resolve(RAIZ, `.${relativo}`);
  if (!arquivo.startsWith(RAIZ + sep)) return false;
  if (!existsSync(arquivo) || !statSync(arquivo).isFile()) return false;

  const cache = relativo.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : SEM_CACHE.has(relativo)
      ? 'no-cache'
      : 'public, max-age=3600';
  res.writeHead(200, {
    ...cabecalhos,
    'Content-Type': TIPOS[extname(arquivo).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(arquivo).size,
    'Cache-Control': cache,
  });
  createReadStream(arquivo).pipe(res);
  return true;
}
