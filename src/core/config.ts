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
 * Endereço da API de autorização (`cmd/api`). Sem ela o aplicativo não
 * consegue pedir acesso novo — mas continua abrindo offline para quem já
 * tem credencial válida no aparelho.
 */
export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/**
 * Chave pública ES256 (JWK) com que o aplicativo confere a credencial de
 * acesso sem consultar a rede. Gerada no servidor com `api -gerar-chave`.
 */
export const CHAVE_PUBLICA_SESSAO = import.meta.env.VITE_AUTH_CHAVE_PUBLICA ?? '';

/**
 * Desliga a exigência de autorização. Existe para `npm run dev` e para o
 * teste de fumaça, que não sobem a API.
 *
 * A proteção é ligada por padrão: só esta variável, definida de propósito no
 * build, a desliga — e quando desligada o aplicativo exibe uma faixa
 * permanente de aviso, para que nenhum build assim seja publicado sem que
 * alguém perceba.
 */
export const AUTORIZACAO_DESLIGADA = import.meta.env.VITE_SEM_AUTORIZACAO === '1';
