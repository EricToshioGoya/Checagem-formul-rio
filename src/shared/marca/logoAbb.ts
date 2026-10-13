/**
 * Logotipo ABB: as letras cortadas por uma linha branca horizontal no meio e
 * por linhas verticais que separam as metades do A e a haste de cada B.
 *
 * Geometria do "ABB logo.svg" do Wikimedia Commons — formas simples, em
 * domínio público. A marca continua sendo da ABB.
 *
 * Um caminho SVG fechado por bloco, para servir aos dois lados: a tela
 * desenha com `<path>`, e o PDF com `drawSvgPath` do pdf-lib.
 */
export const LOGO_ABB = {
  largura: 86.2,
  altura: 33,
  caminhos: [
    // A: metades esquerda e direita, cada uma em cima e embaixo
    'M 5.7 17 L 0 33 L 8.3 33 L 10.7 26 L 16 26 L 16 17 Z',
    'M 16 0 L 11.7 0 L 6 16 L 16 16 Z',
    'M 17 26 L 22.3 26 L 24.7 33 L 33 33 L 27.3 17 L 17 17 Z',
    'M 27 16 L 21.3 0 L 17 0 L 17 16 Z',
    // primeiro B: haste (em cima, embaixo) e as duas curvas
    'M 36 0 L 46 0 L 46 16 L 36 16 Z',
    'M 36 17 L 46 17 L 46 33 L 36 33 Z',
    'M 57.3 16 C 56.3 14.6 54.9 13.5 53.4 12.7 C 55.2 11.4 56.4 9.3 56.4 7 C 56.4 3.1 53.3 0 49.4 0 L 47 0 L 47 16 Z',
    'M 47 33 L 49 33 C 55 32.7 59.2 28 59.2 22.4 C 59.2 20.5 58.8 18.6 57.9 17.1 L 47 17.1 Z',
    // segundo B
    'M 63 0 L 73 0 L 73 16 L 63 16 Z',
    'M 63 17 L 73 17 L 73 33 L 63 33 Z',
    'M 84.3 16 C 83.3 14.6 81.9 13.5 80.4 12.7 C 82.2 11.4 83.4 9.3 83.4 7 C 83.4 3.1 80.3 0 76.4 0 L 74 0 L 74 16 Z',
    'M 74 33 L 76 33 C 82 32.7 86.2 28 86.2 22.4 C 86.2 20.5 85.8 18.6 84.9 17.1 L 74 17.1 Z',
  ],
} as const;
