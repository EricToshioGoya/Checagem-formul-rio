import { defineConfig, loadEnv, type Plugin, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// `VITE_BASE` permite publicar em subdiretório (modalidade A).
// O padrão "/" atende a raiz do servidor e o binário Go (modalidade B).
const base = process.env.VITE_BASE ?? '/';

/**
 * Política de conteúdo da aplicação: só recursos da própria origem, sem
 * script inline. Manter em sincronia com `politicaConteudo` em
 * cmd/servidor/main.go.
 *
 * `style-src` aceita estilo inline porque anexos PDF abrem em aba `blob:`,
 * que herda esta política, e o visualizador de PDF do navegador depende de
 * estilo inline para ocupar a tela.
 */
const POLITICA_CONTEUDO = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/**
 * A política entra só no build: o servidor de desenvolvimento injeta script
 * inline (React Refresh), que ela bloquearia.
 */
function politicaDeSeguranca(): Plugin {
  return {
    name: 'politica-de-seguranca',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: POLITICA_CONTEUDO },
        injectTo: 'head-prepend',
      },
    ],
  };
}

const FORMATO_HASH_SENHA = /^pbkdf2-sha256:\d{6,}:(?:[0-9a-f]{2}){16,}:[0-9a-f]{64}$/i;

/** O build publicado nunca sai sem senha da administração, nem com ela em texto claro. */
function conferirSenhaAdmin(env: Record<string, string>): void {
  if (env.VITE_SENHA_ADMIN) {
    throw new Error(
      'VITE_SENHA_ADMIN não é mais aceita: a senha ficaria em texto claro no código publicado. ' +
        'Gere o hash com `npm run gerar-hash-senha` e informe VITE_SENHA_ADMIN_HASH.',
    );
  }
  if (!FORMATO_HASH_SENHA.test(env.VITE_SENHA_ADMIN_HASH ?? '')) {
    throw new Error(
      'Defina VITE_SENHA_ADMIN_HASH antes do build (gere com `npm run gerar-hash-senha`).',
    );
  }
}

const configuracao = {
  base,
  plugins: [
    react(),
    tailwindcss(),
    politicaDeSeguranca(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Verificação de Montagem de Painéis',
        short_name: 'Verificação',
        description:
          'Registro das verificações de montagem de painéis conforme protocolos ABB.',
        lang: 'pt-BR',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#ff000f',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Formulários e mídias entram no precache: o aplicativo abre offline
        // já com o conteúdo de apoio disponível.
        globPatterns: [
          '**/*.{js,css,html,svg,png,ico,woff2}',
          'forms/**/*.json',
          'media/**/*',
        ],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
} satisfies UserConfig;

export default defineConfig(({ command, mode }) => {
  if (command === 'build') conferirSenhaAdmin(loadEnv(mode, process.cwd(), 'VITE_'));
  return configuracao;
});
