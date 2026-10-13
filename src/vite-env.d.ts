/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** Hash PBKDF2 da senha da administração (`npm run gerar-hash-senha`). */
  readonly VITE_SENHA_ADMIN_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
