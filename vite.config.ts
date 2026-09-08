import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// `VITE_BASE` permite publicar em subdiretório (modalidade A).
// O padrão "/" atende a raiz do servidor e o binário Go (modalidade B).
const base = process.env.VITE_BASE ?? '/';

// `VITE_ALVO=demo` gera o pacote de página única usado na demonstração
// compartilhável (veja scripts/build-demo.mjs): tudo num arquivo só, sem
// service worker — que não faz sentido dentro de um iframe de terceiro.
const demo = process.env.VITE_ALVO === 'demo';

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
        // Formulários, painéis, templates de certificado, instruções e mídias
        // entram no precache: o aplicativo abre offline já com todo o conteúdo
        // de apoio disponível.
        globPatterns: [
          '**/*.{js,css,html,svg,png,ico,woff2}',
          'forms/**/*.json',
          'paineis/**/*.json',
          'certificados/**/*.json',
          'docs/**/*.pdf',
          'media/**/*',
        ],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
      // Na demonstração o plugin fica só pelos módulos virtuais: service
      // worker dentro de iframe de terceiro não registra.
      disable: demo,
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    // A demonstração precisa caber num arquivo: sem divisão de código e com
    // um único bloco de CSS.
    ...(demo
      ? { cssCodeSplit: false, rollupOptions: { output: { codeSplitting: false } } }
      : {}),
  },
});
