import type { PDFFont } from 'pdf-lib';

/** Símbolos usados nos protocolos que não existem na codificação WinAnsi. */
const SUBSTITUICOES: Record<string, string> = {
  'Ω': 'ohm',
  'ω': 'ohm',
  '≤': '<=',
  '≥': '>=',
  '≈': '~',
  '→': '->',
  '←': '<-',
  '↔': '<->',
  '∅': 'diam.',
  '⌀': 'diam.',
  '−': '-',
  '‐': '-',
  '‑': '-',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  ' ': ' ',
  '\t': '  ',
};

/**
 * Caracteres do WinAnsi que ficam fora do intervalo Latin-1 (0xA0–0xFF).
 * As fontes padrão do pdf-lib os desenham normalmente.
 */
const WINANSI_EXTRA = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ•–—˜™š›œžŸ'));

/**
 * pdf-lib desenha com fontes padrão em WinAnsi. Caracteres fora dessa tabela
 * abortam a geração, então tudo passa por aqui antes de ir para a página.
 */
export function sanitizar(valor: string): string {
  return Array.from(valor ?? '')
    .map((c) => {
      const troca = SUBSTITUICOES[c];
      if (troca !== undefined) return troca;
      const cp = c.codePointAt(0)!;
      if (cp === 10 || cp === 13) return ' ';
      if (cp < 0x80) return c;
      if (cp >= 0xa0 && cp <= 0xff) return c;
      if (WINANSI_EXTRA.has(c)) return c;
      const semAcento = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return semAcento === c ? '?' : semAcento;
    })
    .join('');
}

/** Quebra o texto em linhas que caibam na largura informada. */
export function quebrarLinhas(
  texto: string,
  fonte: PDFFont,
  tamanho: number,
  largura: number,
): string[] {
  const limpo = sanitizar(texto).replace(/\s+/g, ' ').trim();
  if (!limpo) return [];
  const palavras = limpo.split(' ');
  const linhas: string[] = [];
  let atual = '';

  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);
    // Palavra maior que a coluna (códigos de documento): quebra por caractere.
    if (fonte.widthOfTextAtSize(palavra, tamanho) > largura) {
      let pedaco = '';
      for (const letra of palavra) {
        if (fonte.widthOfTextAtSize(pedaco + letra, tamanho) > largura) {
          linhas.push(pedaco);
          pedaco = letra;
        } else {
          pedaco += letra;
        }
      }
      atual = pedaco;
    } else {
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

export function truncar(
  texto: string,
  fonte: PDFFont,
  tamanho: number,
  largura: number,
): string {
  const limpo = sanitizar(texto);
  if (fonte.widthOfTextAtSize(limpo, tamanho) <= largura) return limpo;
  let corte = limpo;
  while (corte.length > 1 && fonte.widthOfTextAtSize(`${corte}...`, tamanho) > largura) {
    corte = corte.slice(0, -1);
  }
  return `${corte}...`;
}
