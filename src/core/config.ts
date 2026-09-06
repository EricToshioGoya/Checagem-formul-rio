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
 * Administrador padrão dos painéis.
 *
 * Cada painel (entrada do catálogo em `public/forms/index.json`) pode declarar
 * a própria lista `administradores`. Quando não declara, vale este e-mail.
 * Pode ser sobrescrito no build com `VITE_ADMIN_PADRAO`.
 *
 * Valor de teste — trocar antes de publicar para os parceiros.
 */
export const ADMIN_PADRAO =
  import.meta.env.VITE_ADMIN_PADRAO ?? 'ericg10456@gmail.com';
