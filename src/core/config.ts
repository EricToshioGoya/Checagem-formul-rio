/**
 * Configuração da aplicação.
 *
 * A aba de administração é protegida por senha cujo hash PBKDF2 é informado
 * no build pela variável `VITE_SENHA_ADMIN_HASH` (gere com
 * `npm run gerar-hash-senha`). O build de produção falha se ela faltar.
 * Não há senha padrão: sem o hash, a aba fica bloqueada.
 */
export const HASH_SENHA_ADMIN: string | undefined = import.meta.env.VITE_SENHA_ADMIN_HASH;

/** Tempo de liberação da aba de administração após a senha correta. */
export const MINUTOS_SESSAO_ADMIN = 30;

/** Nome do produto exibido nas telas e no PDF. */
export const NOME_APLICACAO = 'Verificação de Montagem de Painéis';
