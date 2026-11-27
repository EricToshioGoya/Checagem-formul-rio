/**
 * Número de identificação de um PDF emitido: `VM-AAAA-XXXX-XXXX-XXXX` — o ano
 * da emissão e doze caracteres sorteados. Cada PDF leva o seu, impresso no
 * rodapé, nos metadados e no registro do arquivo no servidor, onde é único.
 *
 * O aparelho gera o número na hora de montar o PDF (que pode ser offline); o
 * servidor confere o formato e recusa um número já usado.
 */

/** 32 caracteres, sem 0/O e 1/I: o número se lê e se digita sem confusão. */
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const PADRAO_CODIGO_PDF = /^VM-\d{4}(?:-[2-9A-HJ-NP-Z]{4}){3}$/;

/**
 * Gera um número novo. 256 é múltiplo de 32: o resto da divisão não favorece
 * nenhum caractere. São 60 bits sorteados; repetir um número é desprezível, e
 * o servidor ainda confere.
 */
export function gerarCodigoPdf(emitidoEm: Date = new Date()): string {
  const sorteio = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const caracteres = Array.from(sorteio, (b) => ALFABETO[b % ALFABETO.length]).join('');
  const grupos = caracteres.match(/.{4}/g)!;
  // Data inválida ou fora de quatro dígitos (relógio do aparelho): vale o ano de hoje.
  const ano = emitidoEm.getFullYear();
  const anoImpresso = Number.isInteger(ano) && ano >= 1000 && ano <= 9999 ? ano : new Date().getFullYear();
  return ['VM', String(anoImpresso), ...grupos].join('-');
}

/** Normaliza o que foi digitado (minúsculas, espaços) para comparar com o padrão. */
export function normalizarCodigoPdf(texto: string): string {
  return texto.trim().toUpperCase().replace(/\s+/g, '');
}

export function codigoPdfValido(texto: string): boolean {
  return PADRAO_CODIGO_PDF.test(texto);
}
