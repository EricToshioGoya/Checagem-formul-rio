import type { PDFFont } from 'pdf-lib';

/** Símbolos usados nos protocolos, trocados quando a fonte não os possui. */
const SUBSTITUICOES: Record<string, string> = {
  '\u03a9': 'ohm', // letra grega ômega
  '\u2126': 'ohm', // símbolo de ohm
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
};

/**
 * Caracteres do WinAnsi que ficam fora do intervalo Latin-1 (0xA0–0xFF).
 * As fontes padrão do pdf-lib os desenham normalmente.
 */
const WINANSI_EXTRA = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ•–—˜™š›œžŸ'));

const caracteresPorFonte = new WeakMap<PDFFont, Set<number>>();

function suportados(fonte: PDFFont): Set<number> {
  let conjunto = caracteresPorFonte.get(fonte);
  if (!conjunto) {
    conjunto = new Set(fonte.getCharacterSet());
    caracteresPorFonte.set(fonte, conjunto);
  }
  return conjunto;
}

/**
 * Caractere fora da fonte aborta a geração (fontes padrão, WinAnsi) ou sai
 * em branco (fontes incorporadas), então todo texto passa por aqui antes de ir
 * para a página. Sem fonte, o filtro é o WinAnsi.
 */
export function sanitizar(valor: string, fonte?: PDFFont): string {
  const conjunto = fonte ? suportados(fonte) : undefined;
  return Array.from(valor ?? '')
    .map((c) => {
      const cp = c.codePointAt(0)!;
      if (cp === 10 || cp === 13) return ' ';
      if (cp === 9) return '  ';
      if (cp === 0xa0 || cp === 0x202f) return ' ';
      if (conjunto?.has(cp)) return c;
      const troca = SUBSTITUICOES[c];
      if (troca !== undefined) return troca;
      if (cp < 0x80) return c;
      if (!conjunto && cp >= 0xa0 && cp <= 0xff) return c;
      if (!conjunto && WINANSI_EXTRA.has(c)) return c;
      const semAcento = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
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
  const limpo = sanitizar(texto, fonte).replace(/\s+/g, ' ').trim();
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

export function truncar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string {
  const limpo = sanitizar(texto, fonte);
  if (fonte.widthOfTextAtSize(limpo, tamanho) <= largura) return limpo;
  let corte = limpo;
  while (corte.length > 1 && fonte.widthOfTextAtSize(`${corte}…`, tamanho) > largura) {
    corte = corte.slice(0, -1);
  }
  return `${corte.trimEnd()}…`;
}

/** Quebra em linhas e corta o excedente com reticências na última linha. */
export function quebrarLimitado(
  texto: string,
  fonte: PDFFont,
  tamanho: number,
  largura: number,
  maximoLinhas: number,
): string[] {
  const linhas = quebrarLinhas(texto, fonte, tamanho, largura);
  if (linhas.length <= maximoLinhas) return linhas;
  const visiveis = linhas.slice(0, maximoLinhas);
  visiveis[maximoLinhas - 1] = truncar(
    `${visiveis[maximoLinhas - 1]} ${linhas[maximoLinhas]}`,
    fonte,
    tamanho,
    largura,
  );
  return visiveis;
}
