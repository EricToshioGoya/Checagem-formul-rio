/**
 * Configuração da aplicação.
 *
 * A senha da aba de administração é uma constante de build, conforme a
 * seção 8 da especificação: não há autenticação nem controle de usuários.
 * Pendência registrada na seção 15 — trocar antes de publicar para os
 * parceiros. Pode ser sobrescrita no build com `VITE_SENHA_ADMIN`.
 */
export const SENHA_ADMIN = import.meta.env.VITE_SENHA_ADMIN ?? 'abb-admin';

/** Nome do produto exibido nas telas e no PDF. */
export const NOME_APLICACAO = 'Verificação de Montagem de Painéis';

/**
 * Endereço do servidor do arquivo central de PDFs (`cmd/arquivo`), definido no
 * build com `VITE_URL_ARQUIVO`. Vazio desativa o envio e a aba de consulta.
 */
export const URL_ARQUIVO = String(import.meta.env.VITE_URL_ARQUIVO ?? '').replace(/\/+$/, '');
