/**
 * Número de identificação de cada PDF emitido (dossiê, checklist ou
 * certificado), impresso no próprio documento e guardado no Arquivo de PDFs.
 *
 * Nasce no aparelho, na hora em que o PDF é gerado: o montador gera PDF sem
 * rede, dentro do galpão, e o número tem de sair impresso mesmo assim. Por
 * isso não é sequencial — é o ano mais 12 caracteres sorteados (32¹² ≈ 10¹⁸
 * combinações por ano), e o servidor ainda recusa um número já arquivado.
 *
 * Formato: `VM-2026-K7Q4-9XRA-3MZD`. O alfabeto deixa de fora 0/O e 1/I, que
 * se confundem ao ler em voz alta ou digitar na busca.
 */

const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const PADRAO_CODIGO_PDF = /^VM-\d{4}(?:-[2-9A-HJ-NP-Z]{4}){3}$/;

export function gerarCodigoPdf(emitidoEm: Date = new Date()): string {
  // 256 é múltiplo de 32: o resto da divisão não favorece nenhum caractere.
  const sorteio = crypto.getRandomValues(new Uint8Array(12));
  const caracteres = Array.from(sorteio, (b) => ALFABETO[b % ALFABETO.length]).join('');
  const grupos = caracteres.match(/.{4}/g)!;
  return ['VM', String(emitidoEm.getFullYear()).padStart(4, '0'), ...grupos].join('-');
}

/** Normaliza o que foi digitado (minúsculas, espaços) para comparar com o padrão. */
export function normalizarCodigoPdf(texto: string): string {
  return texto.trim().toUpperCase().replace(/\s+/g, '');
}
