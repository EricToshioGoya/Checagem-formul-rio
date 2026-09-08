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

/**
 * Administrador padrão dos painéis.
 *
 * Cada painel do catálogo (`public/paineis/index.json`) pode declarar a
 * própria lista `administradores`. Quando não declara, vale este e-mail.
 * Pode ser sobrescrito no build com `VITE_ADMIN_PADRAO`.
 *
 * Valor de teste — trocar antes de publicar para os parceiros.
 */
export const ADMIN_PADRAO =
  import.meta.env.VITE_ADMIN_PADRAO ?? 'ericg10456@gmail.com';

/**
 * Responsável que aprova o acesso do montador quando o painel não declara
 * `responsavelMontagem` no catálogo. Valor de teste — trocar antes de
 * publicar. Sobrescrevível no build com `VITE_RESPONSAVEL_MONTAGEM`.
 */
export const RESPONSAVEL_MONTAGEM_PADRAO =
  import.meta.env.VITE_RESPONSAVEL_MONTAGEM ?? 'ericg10456@gmail.com';

/**
 * Endereço que recebe o pedido de aprovação e envia o e-mail ao responsável.
 *
 * O padrão é a própria origem: o binário portátil atende `/api/aprovacao`
 * (veja `cmd/servidor/aprovacao.go`). Publicando o aplicativo em lugar sem
 * servidor — SharePoint, por exemplo —, aponte `VITE_URL_APROVACAO` para o
 * fluxo do Power Automate ou para a função na nuvem que faz o envio. String
 * vazia desliga o envio pelo servidor e mantém apenas o rascunho manual.
 */
export const URL_APROVACAO =
  import.meta.env.VITE_URL_APROVACAO ?? `${import.meta.env.BASE_URL}api/aprovacao`;
