/**
 * Configuração da aplicação.
 *
 * A ferramenta não tem login nem controle de usuários: quem abre o endereço
 * usa. A senha da aba de administração é uma constante de build — ela separa
 * quem edita o conteúdo dos formulários de quem apenas preenche. Trocar antes
 * de publicar para os parceiros, com `VITE_SENHA_ADMIN`.
 */
export const SENHA_ADMIN = import.meta.env.VITE_SENHA_ADMIN ?? 'abb-admin';

/** Nome do produto exibido nas telas e no PDF. */
export const NOME_APLICACAO = 'Verificação de Montagem de Painéis';

/** Painel atendido pelo fluxo de verificação da v1. */
export const PAINEL_PADRAO = 'sen-plus';

/**
 * Numeração dos certificados. O número é sequencial global, único e imutável;
 * estas constantes definem apenas a sua apresentação.
 */
export const NUMERO_CERTIFICADO_DIGITOS = 4;
export const PREFIXO_NUMERO_CERTIFICADO = import.meta.env.VITE_PREFIXO_CERTIFICADO ?? '';

/**
 * Endereço do servidor que guarda a fila de liberação de acesso.
 *
 * O padrão é `/api` na mesma origem — como o binário de `cmd/servidor` serve.
 * Aplicação e servidor em endereços diferentes: informe o endereço completo no
 * build com `VITE_API_URL` e libere a origem no servidor com `-origem`.
 */
export const API_BASE = (
  import.meta.env.VITE_API_URL ?? `${import.meta.env.BASE_URL}api`
).replace(/\/+$/, '');

/** De quanto em quanto tempo a tela de espera pergunta ao servidor. */
export const INTERVALO_CONSULTA_ACESSO_MS = 5000;

/** Caminho do PDF de instruções, exibido logo abaixo do cabeçalho. */
export const PDF_INSTRUCOES = 'docs/instrucoes-solicitacao-certificacao.pdf';
export const TITULO_PDF_INSTRUCOES =
  'Instruções de envio de informações para solicitação de certificação';
