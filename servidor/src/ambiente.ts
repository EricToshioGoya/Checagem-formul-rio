import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Lê `servidor/.env`, se existir: é onde ficam as credenciais do e-mail e o
 * resto da configuração da máquina, fora do Git. Uma variável já definida no
 * ambiente (segredo do Codespaces, serviço do sistema) vale mais que o arquivo.
 *
 * Importado antes de tudo em `index.ts` e `cli-admin.ts`: os outros módulos
 * leem `process.env` ao carregar.
 */
const ARQUIVO = fileURLToPath(new URL('../.env', import.meta.url));

if (existsSync(ARQUIVO)) process.loadEnvFile(ARQUIVO);
