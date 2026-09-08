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
 * Segredo que deriva o código de aprovação de acesso à montagem (seção
 * "Permissão de acesso" do README). Precisa ser o mesmo no aparelho do
 * montador e no do responsável — ou seja, o mesmo build. Trocar no build com
 * `VITE_SEGREDO_APROVACAO`.
 */
export const SEGREDO_APROVACAO =
  import.meta.env.VITE_SEGREDO_APROVACAO ?? 'abb-montagem-2026';
/** Painel atendido pelo fluxo de verificação da v1. */
export const PAINEL_PADRAO = 'sen-plus';

/**
 * Numeração dos certificados. O número é sequencial global, único e imutável;
 * estas constantes definem apenas a sua apresentação.
 */
export const NUMERO_CERTIFICADO_DIGITOS = 4;
export const PREFIXO_NUMERO_CERTIFICADO = import.meta.env.VITE_PREFIXO_CERTIFICADO ?? '';

/** Caminho do PDF de instruções, exibido logo abaixo do cabeçalho. */
export const PDF_INSTRUCOES = 'docs/instrucoes-solicitacao-certificacao.pdf';
export const TITULO_PDF_INSTRUCOES =
  'Instruções de envio de informações para solicitação de certificação';
