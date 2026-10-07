import {
  LineCapStyle,
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setLineCap,
  setLineWidth,
  setStrokingColor,
  stroke,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
  type Color,
} from 'pdf-lib';
import { sanitizar } from './texto';

/** Constante da aproximação de um quarto de círculo por curva de Bézier. */
const KAPPA = 0.5523;

/** Raios por canto: superior esquerdo, superior direito, inferior direito, inferior esquerdo. */
export type Raios = number | [number, number, number, number];

export interface Caixa {
  x: number;
  /** Borda superior, em coordenadas da página. */
  topo: number;
  largura: number;
  altura: number;
}

function caminhoRetangulo({ x, topo, largura, altura }: Caixa, raios: Raios): PDFOperator[] {
  const limite = Math.min(largura, altura) / 2;
  const [se, sd, id, ie] = (typeof raios === 'number' ? [raios, raios, raios, raios] : raios).map(
    (r) => Math.max(0, Math.min(r, limite)),
  );
  const base = topo - altura;
  const direita = x + largura;
  return [
    moveTo(x + se, topo),
    lineTo(direita - sd, topo),
    appendBezierCurve(
      direita - sd + sd * KAPPA,
      topo,
      direita,
      topo - sd + sd * KAPPA,
      direita,
      topo - sd,
    ),
    lineTo(direita, base + id),
    appendBezierCurve(
      direita,
      base + id - id * KAPPA,
      direita - id + id * KAPPA,
      base,
      direita - id,
      base,
    ),
    lineTo(x + ie, base),
    appendBezierCurve(x + ie - ie * KAPPA, base, x, base + ie - ie * KAPPA, x, base + ie),
    lineTo(x, topo - se),
    appendBezierCurve(x, topo - se + se * KAPPA, x + se - se * KAPPA, topo, x + se, topo),
    closePath(),
  ];
}

export function retangulo(
  pagina: PDFPage,
  caixa: Caixa,
  estilo: { raio?: Raios; cor?: Color; borda?: Color; espessura?: number },
): void {
  const { raio = 0, cor, borda, espessura = 0.75 } = estilo;
  if (!cor && !borda) return;
  const pintura = cor && borda ? fillAndStroke() : cor ? fill() : stroke();
  pagina.pushOperators(
    pushGraphicsState(),
    ...(cor ? [setFillingColor(cor)] : []),
    ...(borda ? [setStrokingColor(borda), setLineWidth(espessura)] : []),
    ...caminhoRetangulo(caixa, raio),
    pintura,
    popGraphicsState(),
  );
}

/** Desenha dentro de uma máscara de cantos arredondados (fotos). */
export function comRecorte(pagina: PDFPage, caixa: Caixa, raio: Raios, desenhar: () => void): void {
  pagina.pushOperators(pushGraphicsState(), ...caminhoRetangulo(caixa, raio), clip(), endPath());
  desenhar();
  pagina.pushOperators(popGraphicsState());
}

export interface EstiloTexto {
  fonte: PDFFont;
  tamanho: number;
  cor: Color;
  /** Espaçamento adicional entre letras, em pontos. */
  espacamento?: number;
}

export function larguraTexto(
  valor: string,
  estilo: Pick<EstiloTexto, 'fonte' | 'tamanho' | 'espacamento'>,
): number {
  const limpo = sanitizar(valor, estilo.fonte);
  const extra = (estilo.espacamento ?? 0) * Math.max(0, Array.from(limpo).length - 1);
  return estilo.fonte.widthOfTextAtSize(limpo, estilo.tamanho) + extra;
}

/** Texto em uma linha com a linha de base em `y`. Devolve a largura desenhada. */
export function escrever(
  pagina: PDFPage,
  valor: string,
  x: number,
  y: number,
  estilo: EstiloTexto,
): number {
  const limpo = sanitizar(valor, estilo.fonte);
  if (!limpo) return 0;
  const { fonte, tamanho, cor, espacamento = 0 } = estilo;
  if (!espacamento) {
    pagina.drawText(limpo, { x, y, size: tamanho, font: fonte, color: cor });
    return fonte.widthOfTextAtSize(limpo, tamanho);
  }
  let cx = x;
  for (const letra of Array.from(limpo)) {
    pagina.drawText(letra, { x: cx, y, size: tamanho, font: fonte, color: cor });
    cx += fonte.widthOfTextAtSize(letra, tamanho) + espacamento;
  }
  return cx - x - espacamento;
}

export function escreverDireita(
  pagina: PDFPage,
  valor: string,
  xDireita: number,
  y: number,
  estilo: EstiloTexto,
): void {
  escrever(pagina, valor, xDireita - larguraTexto(valor, estilo), y, estilo);
}

/** Altura das maiúsculas: centraliza o texto verticalmente em faixas e selos. */
export function alturaMaiuscula(estilo: Pick<EstiloTexto, 'tamanho'>): number {
  return estilo.tamanho * 0.72;
}

export interface EstiloSelo {
  fundo: Color;
  texto: Color;
  ponto?: Color;
  borda?: Color;
}

/** Selo de cantos totalmente arredondados (status). Devolve a largura. */
export function selo(
  pagina: PDFPage,
  rotulo: string,
  x: number,
  topo: number,
  fonte: PDFFont,
  estilo: EstiloSelo,
  tamanho = 6.8,
  altura = 13,
): number {
  const recuo = 6;
  const diametro = estilo.ponto ? 4.4 : 0;
  const largura = larguraSelo(rotulo, fonte, !!estilo.ponto, tamanho);
  retangulo(
    pagina,
    { x, topo, largura, altura },
    {
      raio: altura / 2,
      cor: estilo.fundo,
      borda: estilo.borda,
      espessura: 0.6,
    },
  );
  let cx = x + recuo;
  if (estilo.ponto) {
    pagina.drawCircle({
      x: cx + diametro / 2,
      y: topo - altura / 2,
      size: diametro / 2,
      color: estilo.ponto,
    });
    cx += diametro + 4;
  }
  escrever(pagina, rotulo, cx, topo - altura / 2 - alturaMaiuscula({ tamanho }) / 2, {
    fonte,
    tamanho,
    cor: estilo.texto,
  });
  return largura;
}

export function larguraSelo(
  rotulo: string,
  fonte: PDFFont,
  comPonto: boolean,
  tamanho = 6.8,
): number {
  return 12 + (comPonto ? 8.4 : 0) + larguraTexto(rotulo, { fonte, tamanho });
}

/** Barra de progresso de cantos arredondados, centrada em `yCentro`. */
export function barraProgresso(
  pagina: PDFPage,
  x: number,
  yCentro: number,
  largura: number,
  fracao: number,
  cor: Color,
  trilho: Color,
  altura = 4,
): void {
  const topo = yCentro + altura / 2;
  retangulo(pagina, { x, topo, largura, altura }, { raio: altura / 2, cor: trilho });
  const parcial = Math.max(0, Math.min(1, fracao)) * largura;
  if (parcial > 0) {
    retangulo(
      pagina,
      { x, topo, largura: Math.max(parcial, altura), altura },
      {
        raio: altura / 2,
        cor,
      },
    );
  }
}

/** Anel de progresso, partindo do topo no sentido horário. */
export function anelProgresso(
  pagina: PDFPage,
  cx: number,
  cy: number,
  raio: number,
  espessura: number,
  fracao: number,
  cor: Color,
  trilho: Color,
): void {
  pagina.drawCircle({ x: cx, y: cy, size: raio, borderColor: trilho, borderWidth: espessura });
  const f = Math.max(0, Math.min(1, fracao));
  if (f <= 0) return;
  if (f >= 0.9999) {
    pagina.drawCircle({ x: cx, y: cy, size: raio, borderColor: cor, borderWidth: espessura });
    return;
  }
  const inicio = Math.PI / 2;
  const fim = inicio - f * 2 * Math.PI;
  const passos = Math.ceil((f * 2 * Math.PI) / (Math.PI / 2));
  const ops: PDFOperator[] = [moveTo(cx + raio * Math.cos(inicio), cy + raio * Math.sin(inicio))];
  for (let i = 0; i < passos; i += 1) {
    const a = inicio + ((fim - inicio) * i) / passos;
    const b = inicio + ((fim - inicio) * (i + 1)) / passos;
    const k = (4 / 3) * Math.tan((b - a) / 4);
    ops.push(
      appendBezierCurve(
        cx + raio * (Math.cos(a) - k * Math.sin(a)),
        cy + raio * (Math.sin(a) + k * Math.cos(a)),
        cx + raio * (Math.cos(b) + k * Math.sin(b)),
        cy + raio * (Math.sin(b) - k * Math.cos(b)),
        cx + raio * Math.cos(b),
        cy + raio * Math.sin(b),
      ),
    );
  }
  pagina.pushOperators(
    pushGraphicsState(),
    setStrokingColor(cor),
    setLineWidth(espessura),
    setLineCap(LineCapStyle.Round),
    ...ops,
    stroke(),
    popGraphicsState(),
  );
}

/** Ícone de documento (anexos em PDF), com o canto superior direito dobrado. */
export function iconeDocumento(
  pagina: PDFPage,
  x: number,
  topo: number,
  largura: number,
  cor: Color,
  fundo: Color,
): void {
  const altura = largura * 1.3;
  const dobra = largura * 0.3;
  const base = topo - altura;
  pagina.pushOperators(
    pushGraphicsState(),
    setFillingColor(fundo),
    setStrokingColor(cor),
    setLineWidth(1),
    moveTo(x, topo),
    lineTo(x + largura - dobra, topo),
    lineTo(x + largura, topo - dobra),
    lineTo(x + largura, base),
    lineTo(x, base),
    closePath(),
    fillAndStroke(),
    moveTo(x + largura - dobra, topo),
    lineTo(x + largura - dobra, topo - dobra),
    lineTo(x + largura, topo - dobra),
    stroke(),
    popGraphicsState(),
  );
}
