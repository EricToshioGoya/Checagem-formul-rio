import {
  LineCapStyle,
  PDFDocument,
  StandardFonts,
  rgb,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { quebrarLinhas, sanitizar, truncar } from './texto';
import { etapaRespondida, etapaVisivel, type Progresso } from '../../forms/progresso';
import {
  etapasForaDoChecklist,
  etapasImpressas,
  valorDeCampo,
  type Dossie,
  type FormularioDoDossie,
  type TagDoDossie,
} from '../dossie';
import type { Midia } from '../../db/tipos';
import type { Etapa, Resposta, Secao, ValorGrade } from '../../forms/tipos';
import {
  dataBr,
  dataHoraBr,
  formatarBytes,
  nomeSemRepetir,
  normalizarParaArquivo,
} from '../../../shared/utils/texto';
import { LOGO_ABB } from '../../../shared/marca/logoAbb';

/**
 * PDF do dossiê, no leiaute dos protocolos ABB.
 *
 * Nada aqui conhece um checklist ou um painel específico: seções, etapas,
 * tipos de resposta, campos do cabeçalho e da identificação vêm do dossiê.
 * Um checklist montado amanhã na administração sai no mesmo padrão.
 */

const PAGINA = { largura: 595.28, altura: 841.89 };
const MARGEM = 36;
const LARGURA_UTIL = PAGINA.largura - MARGEM * 2;
const DIREITA = PAGINA.largura - MARGEM;
/** Onde o corpo da página termina: abaixo daqui é o rodapé. */
const LIMITE_INFERIOR = MARGEM + 30;

const COR = {
  marca: rgb(1, 0, 0.06),
  texto: rgb(0.13, 0.13, 0.13),
  suave: rgb(0.4, 0.4, 0.4),
  claro: rgb(0.62, 0.62, 0.62),
  linha: rgb(0.85, 0.85, 0.85),
  divisoria: rgb(0.91, 0.91, 0.91),
  fundo: rgb(0.958, 0.958, 0.958),
  zebra: rgb(0.978, 0.978, 0.978),
  escuro: rgb(0.2, 0.2, 0.2),
  trilho: rgb(0.89, 0.89, 0.89),
  branco: rgb(1, 1, 1),
};

const VERDE = { cor: rgb(0.05, 0.5, 0.22), fundo: rgb(0.88, 0.96, 0.9) };
const AMBAR = { cor: rgb(0.74, 0.42, 0), fundo: rgb(1, 0.94, 0.8) };
const VERMELHO = { cor: rgb(0.8, 0.06, 0.12), fundo: rgb(0.99, 0.9, 0.9) };
const NEUTRO = { cor: rgb(0.45, 0.45, 0.45), fundo: rgb(0.92, 0.92, 0.92) };

type Icone = 'check' | 'x' | 'alerta' | 'traco';

/** Selo colorido de situação: cor, fundo, ícone e rótulo. */
interface Selo {
  rotulo: string;
  cor: Color;
  fundo: Color;
  icone: Icone;
}

type Situacao = 'verificado' | 'faltaFoto' | 'naoVerificado';

const SITUACOES: Record<Situacao, Selo> = {
  verificado: { rotulo: 'Verificado', icone: 'check', ...VERDE },
  faltaFoto: { rotulo: 'Falta foto', icone: 'alerta', ...AMBAR },
  naoVerificado: { rotulo: 'Não verificado', icone: 'x', ...VERMELHO },
};

/** Situação de um conjunto de etapas: checklist, seção ou o documento todo. */
function seloDoAndamento(p: Progresso): Selo {
  if (p.total === 0) return { rotulo: 'Sem etapas', icone: 'traco', ...NEUTRO };
  if (p.pendentes === 0) return { rotulo: 'Completo', icone: 'check', ...VERDE };
  if (p.respondidas === 0) return { rotulo: 'Não iniciado', icone: 'x', ...VERMELHO };
  return { rotulo: 'Pendente', icone: 'alerta', ...AMBAR };
}

/** Colunas do formulário impresso ABB. A soma fecha a largura útil da folha. */
const COLUNAS = [
  { titulo: 'Etapa', largura: 44 },
  { titulo: 'Descrição', largura: 213 },
  { titulo: 'Aferido', largura: 84 },
  { titulo: 'Status', largura: 76 },
  { titulo: 'Data', largura: 50 },
  { titulo: 'Operador', largura: LARGURA_UTIL - 467 },
] as const;

/** Borda esquerda de cada coluna da tabela de etapas. */
const X_COLUNAS = COLUNAS.map((_, i) =>
  COLUNAS.slice(0, i).reduce((x, c) => x + c.largura, MARGEM),
);

const PAD_X = 5;
const PAD_TOPO = 6;
const PAD_BASE = 6;
const ALTURA_SELO = 13;

interface Fontes {
  normal: PDFFont;
  negrito: PDFFont;
  italico: PDFFont;
}

/** Linha de texto já quebrada, com o passo vertical que ela ocupa. */
interface Linha {
  texto: string;
  tamanho: number;
  passo: number;
  fonte: PDFFont;
  cor: Color;
}

/* ----------------------------------------------------------------------- */
/* Primitivas de desenho                                                    */
/* ----------------------------------------------------------------------- */

function caminhoArredondado(largura: number, altura: number, raio: number): string {
  const r = Math.max(0, Math.min(raio, largura / 2, altura / 2));
  if (r === 0) return `M 0 0 H ${largura} V ${altura} H 0 Z`;
  return [
    `M ${r} 0`,
    `H ${largura - r}`,
    `A ${r} ${r} 0 0 1 ${largura} ${r}`,
    `V ${altura - r}`,
    `A ${r} ${r} 0 0 1 ${largura - r} ${altura}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${altura - r}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
}

/** Retângulo de cantos arredondados com o canto superior esquerdo em (x, topo). */
function caixa(
  pagina: PDFPage,
  x: number,
  topo: number,
  largura: number,
  altura: number,
  estilo: { raio?: number; cor?: Color; borda?: Color; espessura?: number },
): void {
  pagina.drawSvgPath(caminhoArredondado(largura, altura, estilo.raio ?? 4), {
    x,
    y: topo,
    ...(estilo.cor ? { color: estilo.cor } : {}),
    ...(estilo.borda ? { borderColor: estilo.borda, borderWidth: estilo.espessura ?? 0.7 } : {}),
  });
}

const CAMINHOS_ICONE: Record<Exclude<Icone, 'traco'>, string> = {
  check: 'M 2.7 5.3 L 4.4 7 L 7.5 3.4',
  x: 'M 3.3 3.3 L 6.7 6.7 M 6.7 3.3 L 3.3 6.7',
  alerta: 'M 5 2.5 L 5 5.6',
};

/** Ícone em círculo cheio, com o sinal em branco. `topo` é o alto do círculo. */
function icone(pagina: PDFPage, tipo: Icone, x: number, topo: number, tamanho: number, cor: Color) {
  const raio = tamanho / 2;
  pagina.drawCircle({ x: x + raio, y: topo - raio, size: raio, color: cor });
  if (tipo === 'traco') {
    pagina.drawLine({
      start: { x: x + tamanho * 0.3, y: topo - raio },
      end: { x: x + tamanho * 0.7, y: topo - raio },
      thickness: tamanho * 0.13,
      color: COR.branco,
    });
    return;
  }
  pagina.drawSvgPath(CAMINHOS_ICONE[tipo], {
    x,
    y: topo,
    scale: tamanho / 10,
    borderColor: COR.branco,
    borderWidth: 1.35,
    borderLineCap: LineCapStyle.Round,
  });
  if (tipo === 'alerta') {
    pagina.drawCircle({ x: x + raio, y: topo - tamanho * 0.73, size: tamanho * 0.075, color: COR.branco });
  }
}

/** Corta a lista de linhas em `maximo`, marcando com reticências o que sobrou. */
function limitarLinhas(
  linhas: string[],
  maximo: number,
  fonte: PDFFont,
  tamanho: number,
  largura: number,
): string[] {
  if (linhas.length <= maximo) return linhas;
  const mantidas = linhas.slice(0, maximo);
  let corte = mantidas[maximo - 1];
  while (corte.length > 1 && fonte.widthOfTextAtSize(`${corte}...`, tamanho) > largura) {
    corte = corte.slice(0, -1);
  }
  mantidas[maximo - 1] = `${corte.trimEnd()}...`;
  return mantidas;
}

function plural(n: number, singular: string, pluralTexto: string): string {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

/* ----------------------------------------------------------------------- */
/* Folha                                                                    */
/* ----------------------------------------------------------------------- */

class Folha {
  pagina!: PDFPage;
  y = 0;
  /**
   * Redesenha, no alto da página nova, o que precisa continuar — o título da
   * seção e o cabeçalho da tabela de etapas.
   */
  aoQuebrar: (() => void) | null = null;
  /** Nomes dos PDFs já anexados ao documento: nenhum se repete. */
  readonly anexosUsados = new Set<string>();

  constructor(
    readonly doc: PDFDocument,
    readonly fontes: Fontes,
    private readonly topo: { titulo: string; subtitulo: string },
  ) {
    this.novaPagina();
  }

  novaPagina(): void {
    this.pagina = this.doc.addPage([PAGINA.largura, PAGINA.altura]);
    this.y = PAGINA.altura - MARGEM;
    this.desenharTopo();
  }

  /** Marca à esquerda, título do documento à direita e o fio vermelho. */
  private desenharTopo(): void {
    const alturaLogo = 15;
    const escala = alturaLogo / LOGO_ABB.altura;
    // O logotipo em vetor, e não a palavra "ABB" na fonte do documento.
    for (const caminho of LOGO_ABB.caminhos) {
      this.pagina.drawSvgPath(caminho, { x: MARGEM, y: this.y, scale: escala, color: COR.marca });
    }
    const largura = LARGURA_UTIL - 90;
    const { negrito, normal } = this.fontes;
    this.textoDireita(truncar(this.topo.titulo, negrito, 8.5, largura), DIREITA, this.y - 7, 8.5, negrito, COR.texto);
    this.textoDireita(truncar(this.topo.subtitulo, normal, 7.5, largura), DIREITA, this.y - 16.5, 7.5, normal, COR.suave);
    this.pagina.drawRectangle({ x: MARGEM, y: this.y - 25, width: LARGURA_UTIL, height: 1.4, color: COR.marca });
    this.y -= 40;
  }

  /** Espaço livre até o rodapé. */
  get livre(): number {
    return this.y - LIMITE_INFERIOR;
  }

  /** Garante `altura` livre, quebrando a página se preciso. Diz se quebrou. */
  garantir(altura: number): boolean {
    if (this.y - altura >= LIMITE_INFERIOR) return false;
    this.novaPagina();
    this.aoQuebrar?.();
    return true;
  }

  escrever(texto: string, x: number, y: number, tamanho: number, fonte: PDFFont, cor: Color): void {
    this.pagina.drawText(sanitizar(texto), { x, y, size: tamanho, font: fonte, color: cor });
  }

  textoDireita(texto: string, direita: number, y: number, tamanho: number, fonte: PDFFont, cor: Color): void {
    const limpo = sanitizar(texto);
    this.pagina.drawText(limpo, {
      x: direita - fonte.widthOfTextAtSize(limpo, tamanho),
      y,
      size: tamanho,
      font: fonte,
      color: cor,
    });
  }

  /** Parágrafo com quebra de linha e de página. */
  paragrafo(
    valor: string,
    estilo: { tamanho?: number; fonte?: PDFFont; cor?: Color; x?: number; largura?: number } = {},
  ): void {
    const tamanho = estilo.tamanho ?? 9;
    const fonte = estilo.fonte ?? this.fontes.normal;
    const passo = tamanho * 1.35;
    for (const linha of quebrarLinhas(valor, fonte, tamanho, estilo.largura ?? LARGURA_UTIL)) {
      this.garantir(passo);
      this.pagina.drawText(linha, {
        x: estilo.x ?? MARGEM,
        y: this.y - tamanho,
        size: tamanho,
        font: fonte,
        color: estilo.cor ?? COR.texto,
      });
      this.y -= passo;
    }
  }
}

/* ----------------------------------------------------------------------- */
/* Componentes                                                              */
/* ----------------------------------------------------------------------- */

const TAMANHO_SELO = 7;

function larguraSelo(fontes: Fontes, selo: Selo): number {
  return 3.5 + 8 + 3 + fontes.negrito.widthOfTextAtSize(sanitizar(selo.rotulo), TAMANHO_SELO) + 6;
}

/** Desenha o selo com o alto em `topo`; devolve a largura ocupada. */
function desenharSelo(folha: Folha, selo: Selo, x: number, topo: number): number {
  const largura = larguraSelo(folha.fontes, selo);
  caixa(folha.pagina, x, topo, largura, ALTURA_SELO, { raio: ALTURA_SELO / 2, cor: selo.fundo });
  icone(folha.pagina, selo.icone, x + 3.5, topo - 2.5, 8, selo.cor);
  folha.escrever(
    selo.rotulo,
    x + 3.5 + 8 + 3,
    topo - ALTURA_SELO / 2 - TAMANHO_SELO * 0.35,
    TAMANHO_SELO,
    folha.fontes.negrito,
    selo.cor,
  );
  return largura;
}

function barra(pagina: PDFPage, x: number, topo: number, largura: number, altura: number, p: Progresso) {
  caixa(pagina, x, topo, largura, altura, { raio: altura / 2, cor: COR.trilho });
  const fracao = p.total === 0 ? 0 : p.respondidas / p.total;
  if (fracao <= 0) return;
  caixa(pagina, x, topo, Math.max(altura, largura * fracao), altura, {
    raio: altura / 2,
    cor: seloDoAndamento(p).cor,
  });
}

/**
 * Título de bloco: fio vermelho à esquerda e, opcionalmente, um texto à
 * direita. `conteudo` é o mínimo do bloco que precisa caber junto: o título
 * nunca fica sozinho no pé da página.
 */
function tituloBloco(folha: Folha, texto: string, conteudo: number, direita?: string): void {
  folha.garantir(20 + conteudo);
  folha.pagina.drawRectangle({ x: MARGEM, y: folha.y - 12, width: 3, height: 12, color: COR.marca });
  const { negrito, normal } = folha.fontes;
  const larguraDireita = direita ? normal.widthOfTextAtSize(sanitizar(direita), 8) + 12 : 0;
  folha.escrever(
    truncar(texto, negrito, 10.5, LARGURA_UTIL - 10 - larguraDireita),
    MARGEM + 9,
    folha.y - 10,
    10.5,
    negrito,
    COR.texto,
  );
  if (direita) folha.textoDireita(direita, DIREITA, folha.y - 10, 8, normal, COR.suave);
  folha.y -= 20;
}

/**
 * Pares rótulo/valor em duas colunas, cada um num ladrilho. Vale para a
 * identificação do documento e para os dados do painel do checklist —
 * quantos campos o painel tiver.
 */
function gradeCampos(folha: Folha, titulo: string, pares: Array<[string, string]>): void {
  if (!pares.length) return;
  const { negrito, italico } = folha.fontes;
  const vao = 6;
  const larguraCelula = (LARGURA_UTIL - vao) / 2;
  const larguraTexto = larguraCelula - 16;

  const celulas = pares.map(([rotulo, valor]) => {
    const preenchido = valor.trim().length > 0;
    return {
      rotulo: truncar(rotulo.toUpperCase(), negrito, 6.4, larguraTexto),
      linhas: preenchido
        ? limitarLinhas(quebrarLinhas(valor, negrito, 9, larguraTexto), 4, negrito, 9, larguraTexto)
        : ['Não informado'],
      preenchido,
    };
  });

  const alturaDoPar = (i: number) =>
    Math.max(...celulas.slice(i, i + 2).map((c) => 16 + c.linhas.length * 11));
  tituloBloco(folha, titulo, alturaDoPar(0) + vao);

  for (let i = 0; i < celulas.length; i += 2) {
    const par = celulas.slice(i, i + 2);
    const altura = alturaDoPar(i);
    folha.garantir(altura + vao);
    par.forEach((c, j) => {
      const x = MARGEM + j * (larguraCelula + vao);
      caixa(folha.pagina, x, folha.y, larguraCelula, altura, { raio: 4, cor: COR.fundo });
      folha.escrever(c.rotulo, x + 8, folha.y - 9.5, 6.4, negrito, COR.suave);
      c.linhas.forEach((linha, k) => {
        folha.escrever(
          linha,
          x + 8,
          folha.y - 20.5 - k * 11,
          9,
          c.preenchido ? negrito : italico,
          c.preenchido ? COR.texto : COR.claro,
        );
      });
    });
    folha.y -= altura + vao;
  }
  folha.y -= 6;
}

/* ----------------------------------------------------------------------- */
/* Andamento                                                                */
/* ----------------------------------------------------------------------- */

function etapasVisiveis(secao: Secao, formulario: FormularioDoDossie): Etapa[] {
  return secao.etapas.filter((e) => etapaVisivel(e, formulario.respostas));
}

function fotosDa(formulario: FormularioDoDossie, etapaId: string): number {
  return formulario.midiasPorEtapa[etapaId]?.length ?? 0;
}

function situacaoDaEtapa(etapa: Etapa, formulario: FormularioDoDossie): Situacao {
  const resposta = formulario.respostas[etapa.id];
  if (etapaRespondida(etapa, resposta, fotosDa(formulario, etapa.id))) return 'verificado';
  // Marcada, mas sem a foto que a etapa exige.
  if (etapa.tipoResposta === 'check_com_foto' && resposta?.valor === true) return 'faltaFoto';
  return 'naoVerificado';
}

function progressoDe(etapas: readonly Etapa[], formulario: FormularioDoDossie): Progresso {
  const total = etapas.length;
  const respondidas = etapas.filter((e) => situacaoDaEtapa(e, formulario) === 'verificado').length;
  return {
    total,
    respondidas,
    pendentes: total - respondidas,
    percentual: total === 0 ? 0 : Math.round((respondidas / total) * 100),
  };
}

/** Cartão do andamento: percentual grande, selo, barra e contagens. */
function cartaoAndamento(folha: Folha, p: Progresso, ultimaAlteracao?: number): void {
  const altura = 78;
  folha.garantir(altura + 14);
  const topo = folha.y;
  const { negrito, normal } = folha.fontes;
  const selo = seloDoAndamento(p);

  caixa(folha.pagina, MARGEM, topo, LARGURA_UTIL, altura, { raio: 6, cor: COR.branco, borda: COR.linha, espessura: 0.8 });
  folha.escrever(`${p.percentual}%`, MARGEM + 18, topo - 44, 30, negrito, selo.cor);
  folha.escrever('das etapas respondidas', MARGEM + 18, topo - 60, 7.5, normal, COR.suave);

  const xDivisoria = MARGEM + 150;
  folha.pagina.drawLine({
    start: { x: xDivisoria, y: topo - 14 },
    end: { x: xDivisoria, y: topo - altura + 14 },
    thickness: 0.7,
    color: COR.divisoria,
  });

  const x = xDivisoria + 16;
  const largura = DIREITA - 16 - x;
  desenharSelo(folha, { ...selo, rotulo: selo.rotulo.toUpperCase() }, x, topo - 12);
  if (ultimaAlteracao) {
    folha.textoDireita(`Última alteração em ${dataHoraBr(ultimaAlteracao)}`, x + largura, topo - 21.5, 7.5, normal, COR.suave);
  }
  barra(folha.pagina, x, topo - 33, largura, 8, p);

  const contagens: Array<[number, string]> = [
    [p.respondidas, p.respondidas === 1 ? 'respondida' : 'respondidas'],
    [p.pendentes, p.pendentes === 1 ? 'pendente' : 'pendentes'],
    [p.total, p.total === 1 ? 'etapa no total' : 'etapas no total'],
  ];
  contagens.forEach(([numero, rotulo], i) => {
    const xi = x + (largura / 3) * i;
    const texto = String(numero);
    folha.escrever(texto, xi, topo - 62, 14, negrito, i === 1 && numero > 0 ? AMBAR.cor : COR.texto);
    folha.escrever(rotulo, xi + negrito.widthOfTextAtSize(texto, 14) + 4, topo - 62, 8, normal, COR.suave);
  });

  folha.y -= altura + 16;
}

interface Bloco {
  tag: TagDoDossie;
  formulario: FormularioDoDossie;
}

interface ColunaResumo {
  titulo: string;
  largura: number;
}

/** Cabeçalho escuro de tabela, com os títulos em branco. */
function cabecalhoEscuro(folha: Folha, colunas: readonly ColunaResumo[]): void {
  const altura = 18;
  folha.pagina.drawRectangle({ x: MARGEM, y: folha.y - altura, width: LARGURA_UTIL, height: altura, color: COR.escuro });
  let x = MARGEM;
  for (const coluna of colunas) {
    folha.escrever(coluna.titulo, x + PAD_X, folha.y - 12, 7.5, folha.fontes.negrito, COR.branco);
    x += coluna.largura;
  }
  folha.y -= altura;
}

/** Linha de tabela de resumo: fundo alternado e fio inferior. */
function fundoLinha(folha: Folha, altura: number, zebra: boolean): void {
  if (zebra) {
    folha.pagina.drawRectangle({ x: MARGEM, y: folha.y - altura, width: LARGURA_UTIL, height: altura, color: COR.zebra });
  }
  folha.pagina.drawLine({
    start: { x: MARGEM, y: folha.y - altura },
    end: { x: DIREITA, y: folha.y - altura },
    thickness: 0.5,
    color: COR.linha,
  });
}

/** Barra curta com o percentual ao lado, dentro de uma célula. */
function celulaAndamento(folha: Folha, x: number, largura: number, topoLinha: number, alturaLinha: number, p: Progresso) {
  const texto = `${p.percentual}%`;
  const larguraTexto = 26;
  barra(folha.pagina, x + PAD_X, topoLinha - alturaLinha / 2 + 3, largura - PAD_X * 2 - larguraTexto, 6, p);
  folha.textoDireita(texto, x + largura - PAD_X, topoLinha - alturaLinha / 2 - 2.6, 7.5, folha.fontes.negrito, COR.texto);
}

/**
 * Resumo da capa. Um checklist só: uma linha por seção. Vários (o projeto
 * inteiro): uma linha por TAG e checklist.
 */
function resumo(folha: Folha, blocos: readonly Bloco[]): void {
  const { negrito, normal } = folha.fontes;
  const alturaLinha = 22;

  if (blocos.length === 1) {
    const { formulario } = blocos[0];
    const linhas = formulario.definicao.secoes
      .map((secao) => ({ secao, p: progressoDe(etapasVisiveis(secao, formulario), formulario) }))
      .filter((l) => l.p.total > 0);
    if (!linhas.length) return;
    const colunas = [
      { titulo: 'Seção', largura: 243.28 },
      { titulo: 'Andamento', largura: 120 },
      { titulo: 'Respondidas', largura: 70 },
      { titulo: 'Situação', largura: 90 },
    ];
    tituloBloco(folha, 'Resumo por seção', 18 + alturaLinha, plural(linhas.length, 'seção', 'seções'));
    cabecalhoEscuro(folha, colunas);
    linhas.forEach(({ secao, p }, i) => {
      if (folha.garantir(alturaLinha)) cabecalhoEscuro(folha, colunas);
      fundoLinha(folha, alturaLinha, i % 2 === 1);
      const base = folha.y - alturaLinha / 2 - 2.8;
      folha.escrever(truncar(`${secao.id} — ${secao.titulo}`, normal, 8, colunas[0].largura - PAD_X * 2), MARGEM + PAD_X, base, 8, normal, COR.texto);
      celulaAndamento(folha, MARGEM + colunas[0].largura, colunas[1].largura, folha.y, alturaLinha, p);
      folha.escrever(`${p.respondidas}/${p.total}`, MARGEM + colunas[0].largura + colunas[1].largura + PAD_X, base, 8, negrito, COR.texto);
      const xSituacao = MARGEM + colunas[0].largura + colunas[1].largura + colunas[2].largura;
      desenharSelo(folha, seloDoAndamento(p), xSituacao + PAD_X, folha.y - (alturaLinha - ALTURA_SELO) / 2);
      folha.y -= alturaLinha;
    });
    folha.y -= 16;
    return;
  }

  const colunas = [
    { titulo: 'TAG', largura: 110 },
    { titulo: 'Checklist', largura: 163.28 },
    { titulo: 'Andamento', largura: 110 },
    { titulo: 'Respondidas', largura: 60 },
    { titulo: 'Situação', largura: 80 },
  ];
  tituloBloco(folha, 'Resumo por TAG e checklist', 18 + alturaLinha, plural(blocos.length, 'checklist', 'checklists'));
  cabecalhoEscuro(folha, colunas);
  blocos.forEach(({ tag, formulario }, i) => {
    if (folha.garantir(alturaLinha)) cabecalhoEscuro(folha, colunas);
    fundoLinha(folha, alturaLinha, i % 2 === 1);
    const p = formulario.progresso;
    const base = folha.y - alturaLinha / 2 - 2.8;
    let x = MARGEM;
    folha.escrever(truncar(tag.nome, negrito, 8, colunas[0].largura - PAD_X * 2), x + PAD_X, base, 8, negrito, COR.texto);
    x += colunas[0].largura;
    folha.escrever(truncar(formulario.definicao.nome, normal, 8, colunas[1].largura - PAD_X * 2), x + PAD_X, base, 8, normal, COR.texto);
    x += colunas[1].largura;
    celulaAndamento(folha, x, colunas[2].largura, folha.y, alturaLinha, p);
    x += colunas[2].largura;
    folha.escrever(`${p.respondidas}/${p.total}`, x + PAD_X, base, 8, negrito, COR.texto);
    x += colunas[3].largura;
    desenharSelo(folha, seloDoAndamento(p), x + PAD_X, folha.y - (alturaLinha - ALTURA_SELO) / 2);
    folha.y -= alturaLinha;
  });
  folha.y -= 16;
}

/** Até onde a lista de pendências vai na capa; o resto está nas tabelas. */
const MAXIMO_PENDENCIAS_NA_CAPA = 25;

/** Uma linha da lista de pendências: uma etapa, ou um checklist que nem começou. */
type Pendencia =
  | { tipo: 'etapa'; tag: TagDoDossie; etapa: Etapa; situacao: Situacao }
  | { tipo: 'checklist'; tag: TagDoDossie; formulario: FormularioDoDossie };

/**
 * Lista do que falta. `reservar` é o espaço deixado no pé da página para o
 * que vem depois (a legenda): a lista encurta para a capa caber numa página.
 */
function pendencias(folha: Folha, blocos: readonly Bloco[], reservar: number): void {
  const { negrito, normal } = folha.fontes;
  const varios = blocos.length > 1;
  // Checklist sem nenhuma resposta vira uma linha só: listar todas as etapas
  // dele esconderia as pendências dos que estão quase prontos.
  const lista: Pendencia[] = blocos.flatMap(({ tag, formulario }): Pendencia[] => {
    const p = formulario.progresso;
    if (p.total > 0 && p.respondidas === 0) return [{ tipo: 'checklist', tag, formulario }];
    return formulario.definicao.secoes.flatMap((secao) =>
      etapasVisiveis(secao, formulario)
        .map((etapa) => ({ tipo: 'etapa' as const, tag, etapa, situacao: situacaoDaEtapa(etapa, formulario) }))
        .filter((item) => item.situacao !== 'verificado'),
    );
  });
  const total = blocos.reduce((s, b) => s + b.formulario.progresso.total, 0);
  const pendentes = blocos.reduce((s, b) => s + b.formulario.progresso.pendentes, 0);

  if (!lista.length) {
    if (total === 0) return;
    folha.garantir(40);
    caixa(folha.pagina, MARGEM, folha.y, LARGURA_UTIL, 30, { raio: 5, cor: VERDE.fundo });
    icone(folha.pagina, 'check', MARGEM + 10, folha.y - 8, 14, VERDE.cor);
    folha.escrever(
      total === 1 ? 'A única etapa foi respondida.' : `Todas as ${total} etapas foram respondidas.`,
      MARGEM + 32,
      folha.y - 19,
      10,
      negrito,
      VERDE.cor,
    );
    folha.y -= 44;
    return;
  }

  const alturaLinha = 17;
  tituloBloco(folha, 'Pendências', alturaLinha, plural(pendentes, 'etapa pendente', 'etapas pendentes'));
  const cabem = Math.floor((folha.livre - reservar - 18) / alturaLinha);
  const limite = Math.max(5, Math.min(MAXIMO_PENDENCIAS_NA_CAPA, cabem));
  const mostradas = lista.length > limite ? lista.slice(0, limite - 1) : lista;
  mostradas.forEach((item, i) => {
    folha.garantir(alturaLinha);
    fundoLinha(folha, alturaLinha, i % 2 === 1);
    const selo =
      item.tipo === 'etapa'
        ? SITUACOES[item.situacao]
        : seloDoAndamento(item.formulario.progresso);
    const larguraDoSelo = larguraSelo(folha.fontes, selo);
    const base = folha.y - alturaLinha / 2 - 2.8;
    const id =
      item.tipo === 'etapa'
        ? varios
          ? `${item.tag.nome} · ${item.etapa.id}`
          : item.etapa.id
        : `${item.tag.nome} · ${item.formulario.definicao.nome}`;
    const larguraMaximaId = item.tipo === 'etapa' ? 150 : 260;
    const larguraId = Math.min(negrito.widthOfTextAtSize(sanitizar(id), 8), larguraMaximaId);
    const descricao =
      item.tipo === 'etapa'
        ? item.etapa.descricao
        : `nenhuma etapa respondida (${plural(item.formulario.progresso.total, 'etapa', 'etapas')})`;
    folha.escrever(truncar(id, negrito, 8, larguraMaximaId), MARGEM + PAD_X, base, 8, negrito, COR.texto);
    folha.escrever(
      truncar(descricao, normal, 8, LARGURA_UTIL - larguraId - larguraDoSelo - PAD_X * 4 - 8),
      MARGEM + PAD_X + larguraId + 8,
      base,
      8,
      normal,
      COR.suave,
    );
    desenharSelo(folha, selo, DIREITA - PAD_X - larguraDoSelo, folha.y - (alturaLinha - ALTURA_SELO) / 2);
    folha.y -= alturaLinha;
  });
  if (lista.length > mostradas.length) {
    folha.y -= 4;
    folha.paragrafo(
      `… e mais ${plural(lista.length - mostradas.length, 'pendência', 'pendências')}. A situação de cada etapa está nas tabelas a seguir.`,
      { tamanho: 8, cor: COR.suave, fonte: folha.fontes.italico },
    );
  }
  folha.y -= 14;
}

/** Notas do pé da capa: onde estão as fotos, registros à parte e o julgamento. */
function notasDaCapa(blocos: readonly Bloco[], arquivoFotos?: string): string[] {
  const fora = blocos.reduce((s, b) => s + etapasForaDoChecklist(b.formulario).length, 0);
  return [
    arquivoFotos
      ? `As fotos não estão neste PDF: seguem no arquivo ${arquivoFotos}, nomeadas TAG_ETAPA_N.`
      : 'As fotos de cada checklist estão no registro fotográfico, ao final dele.',
    ...(fora
      ? [
          `${plural(fora, 'registro feito em etapa que saiu', 'registros feitos em etapas que saíram')} do checklist depois do preenchimento: ${
            fora === 1 ? 'aparece' : 'aparecem'
          } à parte, em "Fora do checklist atual", e não ${fora === 1 ? 'conta' : 'contam'} no andamento.`,
        ]
      : []),
    'O julgamento de conformidade é feito pelo inspetor da ABB, fora deste sistema.',
  ];
}

const TAMANHO_NOTA = 7.8;

/** Altura da legenda com as notas: a capa reserva esse espaço no pé. */
function alturaLegenda(folha: Folha, notas: readonly string[]): number {
  const linhas = notas.reduce(
    (s, n) => s + quebrarLinhas(n, folha.fontes.normal, TAMANHO_NOTA, LARGURA_UTIL).length,
    0,
  );
  return 24 + 8 + linhas * TAMANHO_NOTA * 1.35;
}

/** Legenda dos selos numa faixa só, e as notas do documento. */
function legenda(folha: Folha, notas: readonly string[]): void {
  const { negrito, normal } = folha.fontes;
  const itens: Array<[Selo, string]> = [
    [SITUACOES.verificado, 'respondida'],
    [SITUACOES.faltaFoto, 'marcada sem a foto obrigatória'],
    [SITUACOES.naoVerificado, 'sem resposta'],
  ];
  const altura = 24;
  folha.garantir(alturaLegenda(folha, notas));
  caixa(folha.pagina, MARGEM, folha.y, LARGURA_UTIL, altura, { raio: 5, borda: COR.linha, espessura: 0.7 });
  const topoSelo = folha.y - (altura - ALTURA_SELO) / 2;
  const base = folha.y - altura / 2 - 2.6;
  folha.escrever('Legenda', MARGEM + 10, base, 8, negrito, COR.texto);
  let x = MARGEM + 10 + negrito.widthOfTextAtSize('Legenda', 8) + 16;
  for (const [selo, texto] of itens) {
    x += desenharSelo(folha, selo, x, topoSelo) + 5;
    folha.escrever(texto, x, base, 7.5, normal, COR.suave);
    x += normal.widthOfTextAtSize(sanitizar(texto), 7.5) + 18;
  }
  folha.y -= altura + 8;
  for (const nota of notas) folha.paragrafo(nota, { tamanho: TAMANHO_NOTA, cor: COR.suave });
}

function desenharCapa(folha: Folha, dossie: Dossie, blocos: readonly Bloco[], opcoes: OpcoesPdf): void {
  const { negrito, normal } = folha.fontes;
  folha.escrever('PROTOCOLO DE VERIFICAÇÃO', MARGEM, folha.y - 8, 8.5, negrito, COR.marca);
  folha.y -= 16;
  for (const linha of limitarLinhas(quebrarLinhas(opcoes.titulo, negrito, 20, LARGURA_UTIL), 3, negrito, 20, LARGURA_UTIL)) {
    folha.escrever(linha, MARGEM, folha.y - 19, 20, negrito, COR.texto);
    folha.y -= 24;
  }
  const subtitulo = [dossie.painel, dossie.empresa, dossie.nomeProjeto].filter(Boolean).join('  •  ');
  folha.escrever(truncar(subtitulo, normal, 10, LARGURA_UTIL), MARGEM, folha.y - 10, 10, normal, COR.suave);
  folha.y -= 26;

  const alteracoes = blocos
    .map((b) => b.formulario.atualizadoEm)
    .filter((v): v is number => v !== undefined && v > 0);
  cartaoAndamento(folha, dossie.progressoGeral, alteracoes.length ? Math.max(...alteracoes) : undefined);

  gradeCampos(folha, 'Identificação', [
    ...dossie.identificacao,
    ...(dossie.listarTags
      ? [[dossie.tags.length === 1 ? 'TAG' : 'TAGs', dossie.tags.map((t) => t.nome).join(', ')] as [string, string]]
      : []),
    ['Documento gerado em', dataHoraBr(dossie.geradoEm.getTime())],
  ]);

  if (!blocos.length) {
    folha.paragrafo('Nenhum checklist foi escolhido para este documento.', { cor: COR.suave });
    return;
  }
  resumo(folha, blocos);
  const notas = notasDaCapa(blocos, opcoes.arquivoFotos);
  pendencias(folha, blocos, alturaLegenda(folha, notas));
  legenda(folha, notas);
}

/* ----------------------------------------------------------------------- */
/* Tabela de etapas                                                         */
/* ----------------------------------------------------------------------- */

/** Data ISO (aaaa-mm-dd) em dd/mm/aaaa; outro texto passa como está. */
function dataLegivel(texto: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto.trim());
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : texto;
}

function formatarNumero(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

/** O que foi registrado na etapa, como sai na coluna "Aferido". */
function valorAferido(etapa: Etapa, resposta: Resposta | undefined, fotos: number): string {
  const nFotos = plural(fotos, 'foto', 'fotos');
  switch (etapa.tipoResposta) {
    case 'check':
      return resposta?.valor === true ? 'Sim' : '';
    case 'check_com_foto':
      if (resposta?.valor !== true) return fotos ? nFotos : '';
      return fotos ? `Sim · ${nFotos}` : 'Sim · sem foto';
    case 'foto':
      return fotos ? nFotos : '';
    case 'anexo_pdf':
      return fotos ? plural(fotos, 'anexo', 'anexos') : '';
    case 'numero':
      return typeof resposta?.valor === 'number' && Number.isFinite(resposta.valor)
        ? `${formatarNumero(resposta.valor)}${etapa.unidade ? ` ${etapa.unidade}` : ''}`
        : '';
    case 'texto':
    case 'selecao':
      return typeof resposta?.valor === 'string' ? resposta.valor.trim() : '';
    case 'grade_numerica': {
      if (!resposta?.valor || typeof resposta.valor !== 'object') return '';
      const valores = Object.values(resposta.valor as ValorGrade).flatMap((l) => Object.values(l ?? {}));
      const preenchidos = valores.filter((v) => typeof v === 'number' && Number.isFinite(v)).length;
      if (!preenchidos) return '';
      return `${plural(preenchidos, 'valor', 'valores')}${etapa.grade ? ' · tabela abaixo' : ''}`;
    }
    default:
      return '';
  }
}

function cabecalhoTabela(folha: Folha): void {
  cabecalhoEscuro(folha, COLUNAS);
}

/**
 * Faixa de título da seção. À direita vai a contagem e o selo do andamento
 * (`direita.p`) ou um texto (`direita.texto`); sem nada, é a continuação da
 * seção numa página nova.
 */
function faixaSecao(
  folha: Folha,
  titulo: string,
  direita: { p: Progresso } | { texto: string } | null,
  destaque: Color = COR.marca,
): void {
  const altura = 24;
  const topo = folha.y;
  const { negrito, normal } = folha.fontes;
  caixa(folha.pagina, MARGEM, topo, LARGURA_UTIL, altura, { raio: 3, cor: COR.fundo });
  folha.pagina.drawRectangle({ x: MARGEM, y: topo - altura, width: 3.5, height: altura, color: destaque });

  let reservado = 0;
  if (direita && 'p' in direita) {
    const selo = seloDoAndamento(direita.p);
    const largura = larguraSelo(folha.fontes, selo);
    desenharSelo(folha, selo, DIREITA - 8 - largura, topo - (altura - ALTURA_SELO) / 2);
    const contagem = `${direita.p.respondidas}/${direita.p.total}`;
    folha.textoDireita(contagem, DIREITA - 8 - largura - 8, topo - 15.3, 8.5, negrito, COR.suave);
    reservado = largura + 16 + negrito.widthOfTextAtSize(contagem, 8.5) + 8;
  } else if (direita) {
    folha.textoDireita(direita.texto, DIREITA - 8, topo - 15.3, 8.5, negrito, COR.suave);
    reservado = negrito.widthOfTextAtSize(sanitizar(direita.texto), 8.5) + 16;
  }
  folha.escrever(
    truncar(direita ? titulo : `${titulo} (continuação)`, negrito, 10, LARGURA_UTIL - 22 - reservado),
    MARGEM + 12,
    topo - 15.5,
    10,
    direita ? negrito : normal,
    direita ? COR.texto : COR.suave,
  );
  folha.y -= altura + 4;
}

/**
 * Desenha a etapa, continuando na página seguinte quando o conteúdo não cabe.
 * O texto nunca passa do limite do rodapé: o que não couber segue, inteiro,
 * na próxima página, com "(cont.)" na coluna da etapa.
 */
function desenharEtapa(folha: Folha, etapa: Etapa, formulario: FormularioDoDossie, zebra: boolean): void {
  const { normal, negrito, italico } = folha.fontes;
  const resposta = formulario.respostas[etapa.id];
  const fotos = fotosDa(formulario, etapa.id);
  const situacao = situacaoDaEtapa(etapa, formulario);
  const respondida = situacao === 'verificado';
  const larguraDescricao = COLUNAS[1].largura - PAD_X * 2;
  const larguraAferido = COLUNAS[2].largura - PAD_X * 2;

  // Resposta curta fica na coluna "Aferido"; a longa vai, inteira, para baixo
  // da descrição — nada é cortado.
  const aferido = valorAferido(etapa, resposta, fotos);
  let linhasAferido = aferido ? quebrarLinhas(aferido, negrito, 8, larguraAferido) : [];
  let respostaLonga: string | null = null;
  if (linhasAferido.length > 3) {
    respostaLonga = aferido;
    linhasAferido = quebrarLinhas('Ver na descrição', italico, 7.5, larguraAferido);
  }
  const larguraOperador = COLUNAS[5].largura - PAD_X * 2;
  const linhasOperador =
    respondida && formulario.operador
      ? limitarLinhas(quebrarLinhas(formulario.operador, normal, 7.2, larguraOperador), 2, normal, 7.2, larguraOperador)
      : [];

  const linhas: Linha[] = [
    ...quebrarLinhas(etapa.descricao, normal, 8.5, larguraDescricao).map((texto) => ({
      texto, tamanho: 8.5, passo: 10.5, fonte: normal, cor: COR.texto,
    })),
    ...(etapa.detalhes ?? []).flatMap((d) =>
      quebrarLinhas(`• ${d}`, normal, 7.2, larguraDescricao).map((texto) => ({
        texto, tamanho: 7.2, passo: 9, fonte: normal, cor: COR.suave,
      })),
    ),
    ...(respostaLonga
      ? quebrarLinhas(`Resposta: ${respostaLonga}`, negrito, 8, larguraDescricao).map((texto) => ({
          texto, tamanho: 8, passo: 10, fonte: negrito, cor: COR.texto,
        }))
      : []),
    ...(resposta?.observacao?.trim()
      ? quebrarLinhas(`Obs.: ${resposta.observacao}`, italico, 7.6, larguraDescricao).map((texto) => ({
          texto, tamanho: 7.6, passo: 9.6, fonte: italico, cor: COR.texto,
        }))
      : []),
  ];

  // Descrição só de espaços (o schema aceita) não deixa a etapa sem linha.
  if (!linhas.length) {
    linhas.push({ texto: '—', tamanho: 8.5, passo: 10.5, fonte: normal, cor: COR.claro });
  }

  const minimoPrimeira = Math.max(
    PAD_TOPO + Math.max(linhasAferido.length, 1) * 10 + PAD_BASE,
    PAD_TOPO + Math.max(linhasOperador.length, 1) * 9 + PAD_BASE,
    PAD_TOPO + ALTURA_SELO + PAD_BASE,
    PAD_TOPO + linhas[0].passo + PAD_BASE,
    24,
  );

  let indice = 0;
  let primeira = true;
  do {
    folha.garantir(primeira ? minimoPrimeira : PAD_TOPO + linhas[indice].passo + PAD_BASE);
    const disponivel = folha.livre;
    let usado = PAD_TOPO + PAD_BASE;
    let fim = indice;
    while (fim < linhas.length && usado + linhas[fim].passo <= disponivel) {
      usado += linhas[fim].passo;
      fim += 1;
    }
    if (fim === indice) {
      usado += linhas[indice].passo;
      fim += 1;
    }
    const altura = Math.max(usado, primeira ? minimoPrimeira : 0);
    const topo = folha.y;
    const pagina = folha.pagina;

    if (zebra) {
      pagina.drawRectangle({ x: MARGEM, y: topo - altura, width: LARGURA_UTIL, height: altura, color: COR.zebra });
    }
    for (const xColuna of X_COLUNAS.slice(1)) {
      pagina.drawLine({ start: { x: xColuna, y: topo }, end: { x: xColuna, y: topo - altura }, thickness: 0.4, color: COR.divisoria });
    }
    for (const x of [MARGEM, DIREITA]) {
      pagina.drawLine({ start: { x, y: topo }, end: { x, y: topo - altura }, thickness: 0.6, color: COR.linha });
    }
    pagina.drawLine({ start: { x: MARGEM, y: topo - altura }, end: { x: DIREITA, y: topo - altura }, thickness: 0.6, color: COR.linha });

    const base = topo - PAD_TOPO - 7.2;
    if (primeira) {
      folha.escrever(truncar(etapa.id, negrito, 8.5, COLUNAS[0].largura - PAD_X * 2), MARGEM + PAD_X, base, 8.5, negrito, COR.texto);
    } else {
      folha.escrever('(cont.)', MARGEM + PAD_X, base, 7, italico, COR.claro);
    }

    let yLinha = topo - PAD_TOPO;
    const xDescricao = X_COLUNAS[1] + PAD_X;
    for (const linha of linhas.slice(indice, fim)) {
      pagina.drawText(linha.texto, { x: xDescricao, y: yLinha - linha.tamanho * 0.85, size: linha.tamanho, font: linha.fonte, color: linha.cor });
      yLinha -= linha.passo;
    }

    // Aferido, status, data e operador saem uma vez só, na primeira parte.
    if (primeira) {
      const xAferido = X_COLUNAS[2] + PAD_X;
      if (linhasAferido.length) {
        const fonteAferido = respostaLonga ? italico : negrito;
        linhasAferido.forEach((linha, i) => {
          folha.escrever(linha, xAferido, base - i * 10, respostaLonga ? 7.5 : 8, fonteAferido, respostaLonga ? COR.suave : COR.texto);
        });
      } else {
        folha.escrever('—', xAferido, base, 8, normal, COR.claro);
      }

      desenharSelo(folha, SITUACOES[situacao], X_COLUNAS[3] + PAD_X, base + 9.4);

      const xData = X_COLUNAS[4] + PAD_X;
      folha.escrever(respondida ? dataBr(formulario.atualizadoEm) : '—', xData, base, 7.5, normal, respondida ? COR.texto : COR.claro);

      const xOperador = X_COLUNAS[5] + PAD_X;
      if (linhasOperador.length) {
        linhasOperador.forEach((linha, i) => {
          folha.escrever(linha, xOperador, base - i * 9, 7.2, normal, COR.texto);
        });
      } else {
        folha.escrever('—', xOperador, base, 7.5, normal, COR.claro);
      }
    }

    folha.y -= altura;
    indice = fim;
    primeira = false;
  } while (indice < linhas.length);

  if (etapa.tipoResposta === 'grade_numerica' && etapa.grade && resposta?.valor && typeof resposta.valor === 'object') {
    desenharGrade(folha, etapa, resposta.valor as ValorGrade);
  }
}

/** Tabela de medições da etapa `grade_numerica`, logo abaixo da linha dela. */
function desenharGrade(folha: Folha, etapa: Etapa, valor: ValorGrade): void {
  const grade = etapa.grade;
  if (!grade) return;
  const { negrito, normal } = folha.fontes;
  const x0 = X_COLUNAS[1];
  const larguraTotal = DIREITA - x0;
  const larguraRotulo = Math.min(150, larguraTotal * 0.34);
  const larguraColuna = (larguraTotal - larguraRotulo) / grade.colunas.length;
  const alturaLinha = 15;

  const linhaVertical = (altura: number) => {
    for (const x of [MARGEM, DIREITA]) {
      folha.pagina.drawLine({ start: { x, y: folha.y }, end: { x, y: folha.y - altura }, thickness: 0.6, color: COR.linha });
    }
  };

  const cabecalho = () => {
    linhaVertical(alturaLinha);
    folha.pagina.drawRectangle({ x: x0, y: folha.y - alturaLinha, width: larguraTotal, height: alturaLinha, color: COR.fundo });
    folha.escrever('Ponto', x0 + PAD_X, folha.y - 10.3, 7.2, negrito, COR.texto);
    grade.colunas.forEach((coluna, i) => {
      const titulo = `${coluna.rotulo}${coluna.unidade ? ` (${coluna.unidade})` : ''}`;
      const direita = x0 + larguraRotulo + larguraColuna * (i + 1) - PAD_X;
      folha.textoDireita(truncar(titulo, negrito, 7.2, larguraColuna - PAD_X * 2), direita, folha.y - 10.3, 7.2, negrito, COR.texto);
    });
    folha.y -= alturaLinha;
  };

  folha.garantir(alturaLinha * 2);
  cabecalho();
  grade.linhas.forEach((linha, i) => {
    if (folha.garantir(alturaLinha)) cabecalho();
    linhaVertical(alturaLinha);
    if (i % 2 === 1) {
      folha.pagina.drawRectangle({ x: x0, y: folha.y - alturaLinha, width: larguraTotal, height: alturaLinha, color: COR.zebra });
    }
    folha.pagina.drawLine({ start: { x: x0, y: folha.y - alturaLinha }, end: { x: DIREITA, y: folha.y - alturaLinha }, thickness: 0.4, color: COR.divisoria });
    folha.escrever(truncar(linha.rotulo, normal, 7.2, larguraRotulo - PAD_X * 2), x0 + PAD_X, folha.y - 10.3, 7.2, normal, COR.texto);
    grade.colunas.forEach((coluna, j) => {
      const v = valor[linha.id]?.[coluna.id];
      const preenchido = typeof v === 'number' && Number.isFinite(v);
      const direita = x0 + larguraRotulo + larguraColuna * (j + 1) - PAD_X;
      folha.textoDireita(
        truncar(preenchido ? formatarNumero(v) : '—', normal, 7.5, larguraColuna - PAD_X * 2),
        direita,
        folha.y - 10.3,
        7.5,
        preenchido ? negrito : normal,
        preenchido ? COR.texto : COR.claro,
      );
    });
    folha.y -= alturaLinha;
  });
  folha.pagina.drawLine({ start: { x: MARGEM, y: folha.y }, end: { x: DIREITA, y: folha.y }, thickness: 0.6, color: COR.linha });
}

/** Página de abertura do checklist: TAG, nome, revisão, andamento e dados do painel. */
function aberturaChecklist(folha: Folha, tag: TagDoDossie, formulario: FormularioDoDossie): void {
  const { negrito, normal } = folha.fontes;
  const definicao = formulario.definicao;
  folha.escrever('TAG', MARGEM, folha.y - 8, 8.5, negrito, COR.marca);
  folha.y -= 14;
  for (const linha of limitarLinhas(quebrarLinhas(tag.nome, negrito, 18, LARGURA_UTIL), 2, negrito, 18, LARGURA_UTIL)) {
    folha.escrever(linha, MARGEM, folha.y - 17, 18, negrito, COR.texto);
    folha.y -= 22;
  }
  for (const linha of limitarLinhas(quebrarLinhas(definicao.nome, negrito, 11, LARGURA_UTIL), 2, negrito, 11, LARGURA_UTIL)) {
    folha.escrever(linha, MARGEM, folha.y - 11, 11, negrito, COR.suave);
    folha.y -= 15;
  }
  const meta = [
    `Revisão ${formulario.formRevisao}${definicao.dataRevisao ? ` de ${dataLegivel(definicao.dataRevisao)}` : ''}`,
    definicao.linhaProduto,
    definicao.emitidoPor ? `Emitido por ${definicao.emitidoPor}` : '',
  ].filter(Boolean).join('  •  ');
  folha.escrever(truncar(meta, normal, 8, LARGURA_UTIL), MARGEM, folha.y - 9, 8, normal, COR.suave);
  folha.y -= 20;

  // Andamento do checklist numa linha: barra, números e selo.
  const p = formulario.progresso;
  const selo = seloDoAndamento(p);
  const larguraDoSelo = larguraSelo(folha.fontes, selo);
  const texto = `${p.respondidas} de ${plural(p.total, 'etapa respondida', 'etapas respondidas')} (${p.percentual}%)`;
  const larguraTexto = normal.widthOfTextAtSize(sanitizar(texto), 8.5);
  const larguraBarra = LARGURA_UTIL - larguraTexto - larguraDoSelo - 24;
  barra(folha.pagina, MARGEM, folha.y - 3, larguraBarra, 7, p);
  folha.escrever(texto, MARGEM + larguraBarra + 12, folha.y - 9.2, 8.5, normal, COR.texto);
  desenharSelo(folha, selo, DIREITA - larguraDoSelo, folha.y);
  folha.y -= 28;

  gradeCampos(
    folha,
    'Dados do painel',
    definicao.cabecalho.map((campo) => [
      campo.rotulo + (campo.unidade ? ` (${campo.unidade})` : ''),
      valorDeCampo(campo, formulario.cabecalho[campo.id]),
    ]),
  );
}

function desenharChecklist(folha: Folha, tag: TagDoDossie, formulario: FormularioDoDossie): void {
  folha.novaPagina();
  aberturaChecklist(folha, tag, formulario);

  const secoes = formulario.definicao.secoes
    .map((secao) => ({ secao, etapas: etapasVisiveis(secao, formulario) }))
    .filter((s) => s.etapas.length > 0);
  if (!secoes.length) {
    folha.paragrafo('Este checklist ainda não tem etapas ativas.', { cor: COR.suave });
    return;
  }

  for (const { secao, etapas } of secoes) {
    tabelaDeEtapas(folha, `${secao.id} — ${secao.titulo}`, { p: progressoDe(etapas, formulario) }, etapas, formulario);
  }

  const fora = etapasForaDoChecklist(formulario);
  if (fora.length) {
    tabelaDeEtapas(
      folha,
      'Fora do checklist atual',
      { texto: plural(fora.length, 'registro', 'registros') },
      fora,
      formulario,
      'Etapas desativadas ou retiradas do checklist depois do preenchimento. O que foi registrado nelas fica no documento, para rastreabilidade, e não entra no andamento.',
    );
  }
}

/** Faixa da seção, cabeçalho e as etapas — a faixa volta no alto de cada página nova. */
function tabelaDeEtapas(
  folha: Folha,
  titulo: string,
  direita: { p: Progresso } | { texto: string },
  etapas: readonly Etapa[],
  formulario: FormularioDoDossie,
  nota?: string,
): void {
  const destaque = nota ? COR.claro : COR.marca;
  // Faixa, nota, cabeçalho e a primeira linha da tabela: nunca a faixa sozinha
  // no pé da página. 42 é a maior altura mínima da primeira parte de uma etapa.
  folha.garantir(28 + (nota ? 30 : 0) + 18 + 42);
  faixaSecao(folha, titulo, direita, destaque);
  if (nota) {
    folha.paragrafo(nota, { tamanho: 7.8, cor: COR.suave, fonte: folha.fontes.italico });
    folha.y -= 4;
  }
  cabecalhoTabela(folha);
  folha.aoQuebrar = () => {
    faixaSecao(folha, titulo, null, destaque);
    cabecalhoTabela(folha);
  };
  etapas.forEach((etapa, i) => desenharEtapa(folha, etapa, formulario, i % 2 === 1));
  folha.aoQuebrar = null;
  folha.y -= 14;
}

/* ----------------------------------------------------------------------- */
/* Registro fotográfico                                                     */
/* ----------------------------------------------------------------------- */

/** Uma foto no registro fotográfico, já incorporada ao PDF. */
interface CartaoFoto {
  tipo: 'foto';
  id: string;
  descricao: string;
  imagem: PDFImage | null;
  largura: number;
  altura: number;
  numero: number;
  total: number;
}

/** Um PDF anexado pelo montador numa etapa. */
interface LinhaAnexo {
  tipo: 'anexo';
  id: string;
  descricao: string;
  midia: Midia;
  numero: number;
}

const FOTO_LARGURA_CARTAO = (LARGURA_UTIL - 12) / 2;
const FOTO_ALTURA_MAXIMA = 160;

/**
 * Registro fotográfico do checklist: as fotos em cartões, duas por linha, na
 * ordem das etapas — cada cartão diz de que etapa é a foto. Os PDFs anexados
 * vão dentro do documento, no painel de anexos do leitor.
 */
async function desenharFotos(folha: Folha, tag: TagDoDossie, formulario: FormularioDoDossie): Promise<void> {
  // As mesmas etapas que o documento imprime, na mesma ordem: a condicional
  // que não se aplica fica de fora com as fotos dela.
  const etapas = etapasImpressas(formulario).filter((e) => fotosDa(formulario, e.id) > 0);
  if (!etapas.length) return;

  const itens: Array<CartaoFoto | LinhaAnexo> = [];
  for (const { id, descricao } of etapas) {
    const lista = formulario.midiasPorEtapa[id] ?? [];
    const imagens = lista.filter((m) => m.mime !== 'application/pdf');
    lista
      .filter((m) => m.mime === 'application/pdf')
      .forEach((midia, i) => itens.push({ tipo: 'anexo', id, descricao, midia, numero: i + 1 }));
    for (const [i, midia] of imagens.entries()) {
      let imagem: PDFImage | null = null;
      try {
        const bytes = new Uint8Array(await midia.blob.arrayBuffer());
        imagem = midia.mime === 'image/png' ? await folha.doc.embedPng(bytes) : await folha.doc.embedJpg(bytes);
      } catch {
        imagem = null;
      }
      const escala = imagem
        ? Math.min((FOTO_LARGURA_CARTAO - 16) / imagem.width, FOTO_ALTURA_MAXIMA / imagem.height, 1)
        : 0;
      itens.push({
        tipo: 'foto',
        id,
        descricao,
        imagem,
        largura: imagem ? imagem.width * escala : 0,
        altura: imagem ? imagem.height * escala : 60,
        numero: i + 1,
        total: imagens.length,
      });
    }
  }

  const { negrito, normal } = folha.fontes;
  folha.novaPagina();
  folha.escrever('REGISTRO FOTOGRÁFICO', MARGEM, folha.y - 8, 8.5, negrito, COR.marca);
  folha.y -= 14;
  folha.escrever(truncar(`TAG ${tag.nome}`, negrito, 16, LARGURA_UTIL), MARGEM, folha.y - 15, 16, negrito, COR.texto);
  folha.y -= 20;
  const fotos = itens.filter((i) => i.tipo === 'foto').length;
  const anexos = itens.length - fotos;
  const resumoFotos = [
    fotos ? plural(fotos, 'foto', 'fotos') : '',
    anexos ? plural(anexos, 'anexo em PDF', 'anexos em PDF') : '',
  ].filter(Boolean).join(' e ');
  folha.escrever(
    truncar(`${formulario.definicao.nome}  •  ${resumoFotos}`, normal, 9, LARGURA_UTIL),
    MARGEM,
    folha.y - 9,
    9,
    normal,
    COR.suave,
  );
  folha.y -= 22;

  for (let i = 0; i < itens.length; ) {
    const item = itens[i];
    if (item.tipo === 'anexo') {
      await desenharAnexo(folha, tag, item);
      i += 1;
      continue;
    }
    const proximo = itens[i + 1];
    const par: CartaoFoto[] = proximo?.tipo === 'foto' ? [item, proximo] : [item];
    desenharLinhaDeFotos(folha, tag, par);
    i += par.length;
  }
}

/** Maior largura do selo da etapa: id comprido é cortado, não invade o vizinho. */
const LARGURA_MAXIMA_SELO_ETAPA = 90;

function textoSeloEtapa(folha: Folha, id: string): string {
  return truncar(id, folha.fontes.negrito, 7.5, LARGURA_MAXIMA_SELO_ETAPA - 10);
}

function larguraSeloEtapa(folha: Folha, id: string): number {
  return folha.fontes.negrito.widthOfTextAtSize(textoSeloEtapa(folha, id), 7.5) + 10;
}

/** Selo escuro com o id da etapa; devolve a largura. */
function seloEtapa(folha: Folha, id: string, x: number, topo: number): number {
  const largura = larguraSeloEtapa(folha, id);
  caixa(folha.pagina, x, topo, largura, 13, { raio: 3, cor: COR.escuro });
  folha.escrever(textoSeloEtapa(folha, id), x + 5, topo - 9.3, 7.5, folha.fontes.negrito, COR.branco);
  return largura;
}

function desenharLinhaDeFotos(folha: Folha, tag: TagDoDossie, par: CartaoFoto[]): void {
  const { normal, italico } = folha.fontes;
  const cabecalhos = par.map((c) => {
    const largura = FOTO_LARGURA_CARTAO - 16 - larguraSeloEtapa(folha, c.id) - 6;
    return limitarLinhas(quebrarLinhas(c.descricao, normal, 7.8, largura), 2, normal, 7.8, largura);
  });
  const alturaCabecalho = Math.max(...cabecalhos.map((l) => Math.max(13, l.length * 9.5))) + 14;
  const alturaFoto = Math.max(...par.map((c) => c.altura)) + 8;
  const alturaCartao = alturaCabecalho + alturaFoto + 16;
  folha.garantir(alturaCartao + 10);

  par.forEach((cartao, j) => {
    const x = MARGEM + j * (FOTO_LARGURA_CARTAO + 12);
    const topo = folha.y;
    caixa(folha.pagina, x, topo, FOTO_LARGURA_CARTAO, alturaCartao, { raio: 5, cor: COR.branco, borda: COR.linha, espessura: 0.7 });
    const larguraId = seloEtapa(folha, cartao.id, x + 8, topo - 8);
    cabecalhos[j].forEach((linha, k) => {
      folha.escrever(linha, x + 8 + larguraId + 6, topo - 17.3 - k * 9.5, 7.8, normal, COR.texto);
    });
    const topoFoto = topo - alturaCabecalho;
    if (cartao.imagem) {
      folha.pagina.drawImage(cartao.imagem, {
        x: x + (FOTO_LARGURA_CARTAO - cartao.largura) / 2,
        y: topoFoto - (alturaFoto + cartao.altura) / 2,
        width: cartao.largura,
        height: cartao.altura,
      });
    } else {
      folha.escrever('Foto não pôde ser incorporada.', x + 10, topoFoto - alturaFoto / 2, 8, italico, COR.suave);
    }
    folha.escrever(
      `Foto ${cartao.numero} de ${cartao.total}  •  ${tag.nome}  •  ${cartao.id}`,
      x + 8,
      topo - alturaCartao + 6,
      7,
      normal,
      COR.suave,
    );
  });
  folha.y -= alturaCartao + 10;
}

async function desenharAnexo(folha: Folha, tag: TagDoDossie, item: LinhaAnexo): Promise<void> {
  const { negrito, normal } = folha.fontes;
  const { midia } = item;
  const nomeAnexo = nomeSemRepetir(
    folha.anexosUsados,
    `${normalizarParaArquivo(tag.nome)}_${normalizarParaArquivo(item.id)}_${item.numero}`,
    'pdf',
  );
  let incorporado = true;
  try {
    await folha.doc.attach(new Uint8Array(await midia.blob.arrayBuffer()), nomeAnexo, {
      mimeType: 'application/pdf',
      description: `${tag.nome} — ${item.id}${midia.nomeOriginal ? ` — ${midia.nomeOriginal}` : ''}`,
      creationDate: new Date(midia.criadoEm),
      modificationDate: new Date(midia.criadoEm),
    });
  } catch {
    incorporado = false;
  }

  const altura = 36;
  folha.garantir(altura + 10);
  const topo = folha.y;
  caixa(folha.pagina, MARGEM, topo, LARGURA_UTIL, altura, { raio: 5, cor: COR.fundo });
  const larguraId = seloEtapa(folha, item.id, MARGEM + 8, topo - 6);
  folha.escrever(
    truncar(item.descricao, normal, 7.8, LARGURA_UTIL - larguraId - 30),
    MARGEM + 8 + larguraId + 6,
    topo - 14.3,
    7.8,
    normal,
    COR.texto,
  );
  caixa(folha.pagina, MARGEM + 8, topo - 21, 9, 11, { raio: 1.5, borda: COR.suave, espessura: 0.8 });
  folha.escrever('PDF', MARGEM + 21, topo - 29.5, 7, negrito, COR.marca);
  folha.escrever(
    truncar(
      `${midia.nomeOriginal ?? 'documento.pdf'}  •  ${formatarBytes(midia.tamanho)}  •  ${
        incorporado ? `anexado a este PDF como ${nomeAnexo}` : 'não pôde ser anexado a este PDF'
      }`,
      normal,
      7.8,
      LARGURA_UTIL - 50,
    ),
    MARGEM + 40,
    topo - 29.5,
    7.8,
    normal,
    incorporado ? COR.texto : VERMELHO.cor,
  );
  folha.y -= altura + 10;
}

/* ----------------------------------------------------------------------- */
/* Documento                                                                */
/* ----------------------------------------------------------------------- */

function rodape(doc: PDFDocument, fontes: Fontes, texto: string): void {
  const paginas = doc.getPages();
  paginas.forEach((pagina, i) => {
    pagina.drawLine({
      start: { x: MARGEM, y: MARGEM + 13 },
      end: { x: DIREITA, y: MARGEM + 13 },
      thickness: 0.6,
      color: COR.linha,
    });
    pagina.drawText(truncar(texto, fontes.normal, 7, LARGURA_UTIL - 80), {
      x: MARGEM,
      y: MARGEM + 3,
      size: 7,
      font: fontes.normal,
      color: COR.suave,
    });
    const numero = `Página ${i + 1} de ${paginas.length}`;
    pagina.drawText(numero, {
      x: DIREITA - fontes.negrito.widthOfTextAtSize(numero, 7),
      y: MARGEM + 3,
      size: 7,
      font: fontes.negrito,
      color: COR.texto,
    });
  });
}

export interface OpcoesPdf {
  incluirFotos: boolean;
  /** Título do documento: o tipo de verificação ou o nome do checklist. */
  titulo: string;
  /** ZIP que leva as fotos quando elas não vão embutidas. */
  arquivoFotos?: string;
}

/**
 * Monta um PDF com a capa (andamento, identificação, resumo e pendências) e,
 * para cada TAG e checklist, a abertura, as seções com as etapas e o registro
 * fotográfico.
 */
export async function gerarPdf(dossie: Dossie, opcoes: OpcoesPdf): Promise<Blob> {
  const doc = await PDFDocument.create();
  const fontes: Fontes = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrito: await doc.embedFont(StandardFonts.HelveticaBold),
    italico: await doc.embedFont(StandardFonts.HelveticaOblique),
  };

  doc.setTitle(`${opcoes.titulo} — ${dossie.empresa} — ${dossie.nomeProjeto}`);
  doc.setSubject(opcoes.titulo);
  doc.setAuthor(dossie.empresa);
  doc.setCreator('Sistema de Verificação de Montagem de Painéis');
  doc.setProducer('Sistema de Verificação de Montagem de Painéis');
  doc.setLanguage('pt-BR');
  doc.setCreationDate(dossie.geradoEm);

  const blocos: Bloco[] = dossie.tags.flatMap((tag) =>
    tag.formularios.map((formulario) => ({ tag, formulario })),
  );

  const folha = new Folha(doc, fontes, {
    titulo: opcoes.titulo,
    subtitulo: [dossie.painel, dossie.empresa, dossie.nomeProjeto].filter(Boolean).join(' • '),
  });
  desenharCapa(folha, dossie, blocos, opcoes);

  for (const { tag, formulario } of blocos) {
    desenharChecklist(folha, tag, formulario);
    if (opcoes.incluirFotos) await desenharFotos(folha, tag, formulario);
  }

  rodape(
    doc,
    fontes,
    `${dossie.empresa} • ${dossie.nomeProjeto} • gerado em ${dataHoraBr(dossie.geradoEm.getTime())}`,
  );

  const bytes = await doc.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}
