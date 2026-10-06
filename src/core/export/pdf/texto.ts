import type { PDFFont } from 'pdf-lib';

/** Símbolos usados nos protocolos que não existem na codificação WinAnsi. */
const SUBSTITUICOES: Record<string, string> = {
  'Ω': 'ohm',
  '\u2126': 'ohm', // sinal de ohm, distinto do ômega
  'ω': 'ohm',
  'μ': 'µ',
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

/** O caractere tem desenho nas fontes padrão (WinAnsi). */
function desenhavel(c: string): boolean {
  const cp = c.codePointAt(0)!;
  return (cp >= 0x20 && cp < 0x7f) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.has(c);
}

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
      // Quebras de linha e qualquer outro caractere de controle (que chega
      // colado de outros programas) viram espaço: o WinAnsi não tem desenho
      // para eles e abortaria a geração do PDF inteiro.
      if (cp < 0x20 || cp === 0x7f) return ' ';
      if (desenhavel(c)) return c;
      // Sem o acento (e na forma de compatibilidade: "ﬁ" vira "fi") o
      // caractere pode ter desenho — mas só vale se tiver mesmo: "й" vira
      // "и", que continua fora da tabela.
      const simples = c.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      const trocaSimples = SUBSTITUICOES[simples];
      if (trocaSimples !== undefined) return trocaSimples;
      if (simples && simples !== c && Array.from(simples).every(desenhavel)) return simples;
      return '?';
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
