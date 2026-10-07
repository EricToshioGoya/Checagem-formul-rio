import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// `VITE_BASE` permite publicar em subdiretório (modalidade A).
// O padrão "/" atende a raiz do servidor e o binário Go (modalidade B).
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
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
        theme_color: '#ffffff',
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
        // Formulários, painéis, templates de certificado, instruções e mídias
        // entram no precache: o aplicativo abre offline já com todo o conteúdo
        // de apoio disponível.
        globPatterns: [
          '**/*.{js,css,html,svg,png,ico,woff2,ttf}',
          'forms/**/*.json',
          'paineis/**/*.json',
          'certificados/**/*.json',
          'docs/**/*.pdf',
          'media/**/*',
        ],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        // A API nunca cai no index.html nem entra em cache: uma resposta de
        // sessão ou de aprovação servida do cache mostraria acesso liberado
        // depois de ele ter sido revogado.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Em desenvolvimento a aplicação e a API ficam em portas diferentes;
    // o proxy as coloca na mesma origem, como acontece em produção.
    proxy: {
      '/api': {
        target: process.env.API_ALVO ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
