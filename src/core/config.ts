/**
 * Configuração da aplicação.
 *
 * Não há mais senha de administração no cliente: administrador é papel da
 * conta, conferido pelo servidor.
 */

/** Nome do produto exibido nas telas e no PDF. */
export const NOME_APLICACAO = 'Verificação de Montagem de Painéis';

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
