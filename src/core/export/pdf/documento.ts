import {
  LineCapStyle,
  PDFDocument,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { quebrarLimitado, quebrarLinhas, truncar } from './texto';
import {
  BASE_CONTEUDO,
  COR,
  DIREITA,
  LARGURA_UTIL,
  MARGEM,
  PAGINA,
  TOPO_CONTEUDO,
  incorporarFontes,
  type BytesFontes,
  type Fontes,
} from './tema';
import {
  alturaMaiuscula,
  anelProgresso,
  barraProgresso,
  comRecorte,
  escrever,
  escreverDireita,
  iconeDocumento,
  larguraTexto,
  retangulo,
  type EstiloTexto,
} from './desenho';
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
 *
 * Cores, medidas e fontes ficam em `tema.ts`; as primitivas de desenho
 * (cantos arredondados, recorte, barra e anel de progresso) em `desenho.ts`.
 */

const X = MARGEM.x;

type Icone = 'check' | 'x' | 'alerta' | 'traco';

/** Selo colorido de situação: cores, ícone e rótulo. */
interface Selo {
  rotulo: string;
  /** Cor do rótulo. */
  cor: Color;
  fundo: Color;
  /** Cor do círculo do ícone. */
  ponto: Color;
  icone: Icone;
}

const VERDE = { cor: COR.sucesso, fundo: COR.sucessoFundo, ponto: COR.sucessoPonto };
const AMBAR = { cor: COR.pendente, fundo: COR.pendenteFundo, ponto: COR.pendentePonto };
const VERMELHO = { cor: COR.erro, fundo: COR.erroFundo, ponto: COR.erroPonto };
const NEUTRO = { cor: COR.suave, fundo: COR.superficieForte, ponto: COR.apagado };

type Situacao = 'verificado' | 'faltaFoto' | 'naoVerificado';

const SITUACOES: Record<Situacao, Selo> = {
  verificado: { rotulo: 'Verificado', icone: 'check', ...VERDE },
  faltaFoto: { rotulo: 'Falta foto', icone: 'alerta', ...AMBAR },
  naoVerificado: { rotulo: 'Não verificado', icone: 'x', ...VERMELHO },
};

/** Fundo da linha da etapa: as pendentes se destacam na leitura. */
const FUNDO_LINHA: Record<Situacao, Color | null> = {
  verificado: null,
  faltaFoto: COR.pendenteLinha,
  naoVerificado: COR.erroLinha,
};

/** Situação de um conjunto de etapas: checklist, seção ou o documento todo. */
function seloDoAndamento(p: Progresso): Selo {
  if (p.total === 0) return { rotulo: 'Sem etapas', icone: 'traco', ...NEUTRO };
  if (p.pendentes === 0) return { rotulo: 'Completo', icone: 'check', ...VERDE };
  if (p.respondidas === 0) return { rotulo: 'Não iniciado', icone: 'x', ...VERMELHO };
  return { rotulo: 'Pendente', icone: 'alerta', ...AMBAR };
}

/** Colunas da tabela de etapas. A soma fecha a largura útil da folha. */
const COLUNAS = [
  { titulo: 'Etapa', largura: 40 },
  { titulo: 'Descrição', largura: 209 },
  { titulo: 'Aferido', largura: 72 },
  { titulo: 'Status', largura: 78 },
  { titulo: 'Data', largura: 54 },
  { titulo: 'Operador', largura: LARGURA_UTIL - 453 },
] as const;

/** Borda esquerda de cada coluna da tabela de etapas. */
const X_COLUNAS = COLUNAS.map((_, i) => COLUNAS.slice(0, i).reduce((x, c) => x + c.largura, X));

const PAD_X = 7;
const PAD_TOPO = 7;
const PAD_BASE = 7;
const ALTURA_SELO = 13;
const ALTURA_CABECALHO_TABELA = 20;

/** Linha de texto já quebrada, com o passo vertical que ela ocupa. */
interface Linha {
  texto: string;
  tamanho: number;
  passo: number;
  fonte: PDFFont;
  cor: Color;
  /** Recuo a partir da borda da coluna. */
  recuo?: number;
  espacamento?: number;
  /** Faz parte do quadro da observação. */
  quadro?: boolean;
}

function plural(n: number, singular: string, pluralTexto: string): string {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

function maiusculas(valor: string): string {
  return valor.toLocaleUpperCase('pt-BR');
}

/** Linha de base que centraliza as maiúsculas do texto na altura `centro`. */
function baseCentrada(centro: number, tamanho: number): number {
  return centro - alturaMaiuscula({ tamanho }) / 2;
}

/* ----------------------------------------------------------------------- */
/* Folha                                                                    */
/* ----------------------------------------------------------------------- */

class Folha {
  pagina!: PDFPage;
  y = 0;
  /**
   * Redesenha, no alto da página nova, o que precisa continuar — o título da
   * seção e o cabeçalho da tabela.
   */
  aoQuebrar: (() => void) | null = null;
  /** Nomes dos PDFs já anexados ao documento: nenhum se repete. */
  readonly anexosUsados = new Set<string>();
  /** Contexto impresso à direita do cabeçalho de cada página. */
  contexto: string;

  constructor(
    readonly doc: PDFDocument,
    readonly fontes: Fontes,
    private readonly titulo: string,
    contexto: string,
  ) {
    this.contexto = contexto;
    this.novaPagina();
  }

  novaPagina(): void {
    this.pagina = this.doc.addPage([PAGINA.largura, PAGINA.altura]);
    this.desenharTopo();
    this.y = TOPO_CONTEUDO;
  }

  /** Filete vermelho no alto, logotipo, título do documento e contexto. */
  private desenharTopo(): void {
    const { pagina, fontes } = this;
    retangulo(pagina, { x: 0, topo: PAGINA.altura, largura: PAGINA.largura, altura: 4 }, {
      cor: COR.marca,
    });

    const alturaLogo = 14;
    const escala = alturaLogo / LOGO_ABB.altura;
    const topoLogo = PAGINA.altura - MARGEM.topo - 4;
    // O logotipo em vetor, e não a palavra "ABB" na fonte do documento.
    for (const caminho of LOGO_ABB.caminhos) {
      pagina.drawSvgPath(caminho, { x: X, y: topoLogo, scale: escala, color: COR.marca });
    }
    const centro = topoLogo - alturaLogo / 2;
    const xDivisor = X + LOGO_ABB.largura * escala + 11;
    pagina.drawLine({
      start: { x: xDivisor, y: centro - 6.5 },
      end: { x: xDivisor, y: centro + 6.5 },
      thickness: 0.75,
      color: COR.linha,
    });

    const titulo: EstiloTexto = { fonte: fontes.seminegrito, tamanho: 8, cor: COR.tinta };
    const espaco = DIREITA - xDivisor - 11;
    const textoTitulo = truncar(this.titulo, titulo.fonte, 8, espaco * 0.55);
    const larguraTitulo = escrever(pagina, textoTitulo, xDivisor + 11, baseCentrada(centro, 8), titulo);
    const contexto: EstiloTexto = { fonte: fontes.regular, tamanho: 7.5, cor: COR.suave };
    escreverDireita(
      pagina,
      truncar(this.contexto, contexto.fonte, 7.5, espaco - larguraTitulo - 20),
      DIREITA,
      baseCentrada(centro, 7.5),
      contexto,
    );

    pagina.drawLine({
      start: { x: X, y: topoLogo - alturaLogo - 12 },
      end: { x: DIREITA, y: topoLogo - alturaLogo - 12 },
      thickness: 0.75,
      color: COR.linha,
    });
  }

  /** Espaço livre até o rodapé. */
  get livre(): number {
    return this.y - BASE_CONTEUDO;
  }

  /** Garante `altura` livre, quebrando a página se preciso. Diz se quebrou. */
  garantir(altura: number): boolean {
    if (this.y - altura >= BASE_CONTEUDO) return false;
    this.novaPagina();
    this.aoQuebrar?.();
    return true;
  }

  escrever(texto: string, x: number, y: number, tamanho: number, fonte: PDFFont, cor: Color): number {
    return escrever(this.pagina, texto, x, y, { fonte, tamanho, cor });
  }

  textoDireita(
    texto: string,
    direita: number,
    y: number,
    tamanho: number,
    fonte: PDFFont,
    cor: Color,
  ): void {
    escreverDireita(this.pagina, texto, direita, y, { fonte, tamanho, cor });
  }

  /** Parágrafo com quebra de linha e de página. */
  paragrafo(
    valor: string,
    estilo: { tamanho?: number; fonte?: PDFFont; cor?: Color; x?: number; largura?: number } = {},
  ): void {
    const tamanho = estilo.tamanho ?? 9;
    const fonte = estilo.fonte ?? this.fontes.regular;
    const passo = tamanho * 1.4;
    for (const linha of quebrarLinhas(valor, fonte, tamanho, estilo.largura ?? LARGURA_UTIL)) {
      this.garantir(passo);
      this.pagina.drawText(linha, {
        x: estilo.x ?? X,
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

const CAMINHOS_ICONE: Record<Exclude<Icone, 'traco'>, string> = {
  check: 'M 2.7 5.3 L 4.4 7 L 7.5 3.4',
  x: 'M 3.4 3.4 L 6.6 6.6 M 6.6 3.4 L 3.4 6.6',
  alerta: 'M 5 2.6 L 5 5.5',
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
    pagina.drawCircle({
      x: x + raio,
      y: topo - tamanho * 0.72,
      size: tamanho * 0.075,
      color: COR.branco,
    });
  }
}

const TAMANHO_SELO = 6.8;
const ICONE_SELO = 7.5;

function larguraSelo(fontes: Fontes, selo: Selo): number {
  return 4 + ICONE_SELO + 3.5 + larguraTexto(selo.rotulo, { fonte: fontes.seminegrito, tamanho: TAMANHO_SELO }) + 6;
}

/** Selo de cantos totalmente arredondados com o alto em `topo`; devolve a largura. */
function desenharSelo(folha: Folha, selo: Selo, x: number, topo: number): number {
  const largura = larguraSelo(folha.fontes, selo);
  retangulo(folha.pagina, { x, topo, largura, altura: ALTURA_SELO }, {
    raio: ALTURA_SELO / 2,
    cor: selo.fundo,
  });
  icone(folha.pagina, selo.icone, x + 3, topo - (ALTURA_SELO - ICONE_SELO) / 2, ICONE_SELO, selo.ponto);
  folha.escrever(
    selo.rotulo,
    x + 4 + ICONE_SELO + 3.5,
    baseCentrada(topo - ALTURA_SELO / 2, TAMANHO_SELO),
    TAMANHO_SELO,
    folha.fontes.seminegrito,
    selo.cor,
  );
  return largura;
}

function fracao(p: Progresso): number {
  return p.total === 0 ? 0 : p.respondidas / p.total;
}

/** Barra de andamento na cor da situação, centrada em `centro`. */
function barra(pagina: PDFPage, x: number, centro: number, largura: number, p: Progresso, altura = 4) {
  barraProgresso(pagina, x, centro, largura, fracao(p), seloDoAndamento(p).ponto, COR.superficieForte, altura);
}

/**
 * Título de bloco, com um texto opcional à direita. `conteudo` é o mínimo do
 * bloco que precisa caber junto: o título nunca fica sozinho no pé da página.
 */
function tituloBloco(folha: Folha, texto: string, conteudo: number, direita?: string): void {
  folha.garantir(22 + conteudo);
  const { seminegrito, regular } = folha.fontes;
  const base = folha.y - 10;
  const larguraDireita = direita ? larguraTexto(direita, { fonte: regular, tamanho: 7.5 }) + 12 : 0;
  folha.escrever(
    truncar(texto, seminegrito, 11, LARGURA_UTIL - larguraDireita),
    X,
    base,
    11,
    seminegrito,
    COR.tinta,
  );
  if (direita) folha.textoDireita(direita, DIREITA, base, 7.5, regular, COR.suave);
  folha.y -= 22;
}

/**
 * Pares rótulo/valor em grade de três colunas sobre um cartão de fundo suave.
 * Vale para a identificação do documento e para os dados do painel do
 * checklist — quantos campos o painel tiver.
 */
function gradeCampos(
  folha: Folha,
  titulo: string,
  pares: Array<[string, string]>,
  colunas = 3,
): void {
  if (!pares.length) return;
  const { regular, medio, italico } = folha.fontes;
  const recuo = 14;
  const larguraColuna = (LARGURA_UTIL - recuo * 2) / colunas;
  const larguraCampo = larguraColuna - 12;
  const passoValor = 12;
  const vao = 10;

  const celulas = pares.map(([rotulo, valor]) => {
    const preenchido = valor.trim().length > 0;
    return {
      rotulo: truncar(rotulo, regular, 7, larguraCampo),
      linhas: preenchido ? quebrarLimitado(valor, medio, 9.5, larguraCampo, 3) : ['Não informado'],
      preenchido,
    };
  });
  const linhas: (typeof celulas)[] = [];
  for (let i = 0; i < celulas.length; i += colunas) linhas.push(celulas.slice(i, i + colunas));
  const alturaLinha = (linha: typeof celulas) =>
    21 + (Math.max(...linha.map((c) => c.linhas.length)) - 1) * passoValor;

  tituloBloco(folha, titulo, recuo * 2 + alturaLinha(linhas[0]));

  // O cartão se divide nas quebras de página: cada pedaço leva as linhas que cabem.
  let indice = 0;
  while (indice < linhas.length) {
    folha.garantir(recuo * 2 + alturaLinha(linhas[indice]));
    let altura = recuo * 2;
    let fim = indice;
    while (fim < linhas.length) {
      const extra = alturaLinha(linhas[fim]) + (fim > indice ? vao : 0);
      if (fim > indice && altura + extra > folha.livre) break;
      altura += extra;
      fim += 1;
    }
    retangulo(folha.pagina, { x: X, topo: folha.y, largura: LARGURA_UTIL, altura }, {
      raio: 8,
      cor: COR.superficie,
    });
    let topoLinha = folha.y - recuo;
    for (const linha of linhas.slice(indice, fim)) {
      linha.forEach((c, j) => {
        const x = X + recuo + j * larguraColuna;
        folha.escrever(c.rotulo, x, topoLinha - 5, 7, regular, COR.suave);
        c.linhas.forEach((texto, k) => {
          folha.escrever(
            texto,
            x,
            topoLinha - 18 - k * passoValor,
            9.5,
            c.preenchido ? medio : italico,
            c.preenchido ? COR.tinta : COR.apagado,
          );
        });
      });
      topoLinha -= alturaLinha(linha) + vao;
    }
    folha.y -= altura;
    indice = fim;
    if (indice < linhas.length) folha.y -= 8;
  }
  folha.y -= 20;
}

/** Faixa de cabeçalho de tabela: fundo suave e rótulos em versalete. */
function cabecalhoTabela(
  folha: Folha,
  colunas: ReadonlyArray<{ titulo: string; largura: number; direita?: boolean }>,
): void {
  retangulo(folha.pagina, { x: X, topo: folha.y, largura: LARGURA_UTIL, altura: ALTURA_CABECALHO_TABELA }, {
    raio: 5,
    cor: COR.superficie,
  });
  const estilo: EstiloTexto = {
    fonte: folha.fontes.seminegrito,
    tamanho: 6.3,
    cor: COR.suave,
    espacamento: 0.5,
  };
  const base = baseCentrada(folha.y - ALTURA_CABECALHO_TABELA / 2, estilo.tamanho);
  let x = X;
  for (const coluna of colunas) {
    const rotulo = maiusculas(coluna.titulo);
    if (coluna.direita) escreverDireita(folha.pagina, rotulo, x + coluna.largura - PAD_X, base, estilo);
    else escrever(folha.pagina, rotulo, x + PAD_X, base, estilo);
    x += coluna.largura;
  }
  folha.y -= ALTURA_CABECALHO_TABELA;
}

function filete(folha: Folha, y: number): void {
  folha.pagina.drawLine({
    start: { x: X, y },
    end: { x: DIREITA, y },
    thickness: 0.6,
    color: COR.linhaSuave,
  });
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

interface Bloco {
  tag: TagDoDossie;
  formulario: FormularioDoDossie;
}

/** Quatro indicadores da capa: etapas, respondidas, pendentes e conclusão. */
function indicadores(folha: Folha, p: Progresso, blocos: readonly Bloco[]) {
  const { negrito, seminegrito, regular } = folha.fontes;
  const altura = 60;
  folha.garantir(altura);
  const vao = 10;
  const largura = (LARGURA_UTIL - vao * 3) / 4;
  const tags = new Set(blocos.map((b) => b.tag.nome)).size;
  const cartoes: Array<{ rotulo: string; valor: string; nota?: string; cor?: Color; barra?: boolean }> = [
    {
      rotulo: 'Etapas',
      valor: String(p.total),
      nota:
        blocos.length > 1
          ? `em ${plural(blocos.length, 'checklist', 'checklists')}${tags > 1 ? ` · ${plural(tags, 'TAG', 'TAGs')}` : ''}`
          : 'no checklist',
    },
    {
      rotulo: 'Respondidas',
      valor: String(p.respondidas),
      nota: `${p.percentual}% do total`,
      cor: p.respondidas ? COR.sucesso : COR.tinta,
    },
    {
      rotulo: 'Pendentes',
      valor: String(p.pendentes),
      nota: p.pendentes ? 'aguardando registro' : 'nenhuma pendência',
      cor: p.pendentes ? COR.pendente : COR.tinta,
    },
    { rotulo: 'Conclusão', valor: `${p.percentual}%`, barra: true },
  ];
  const topo = folha.y;
  cartoes.forEach((c, i) => {
    const x = X + i * (largura + vao);
    retangulo(folha.pagina, { x, topo, largura, altura }, { raio: 8, cor: COR.branco, borda: COR.linha });
    escrever(folha.pagina, maiusculas(c.rotulo), x + 12, topo - 16, {
      fonte: seminegrito,
      tamanho: 6.3,
      cor: COR.suave,
      espacamento: 0.55,
    });
    folha.escrever(c.valor, x + 12, topo - 38, 20, negrito, c.cor ?? COR.tinta);
    if (c.barra) barra(folha.pagina, x + 12, topo - 48, largura - 24, p);
    else if (c.nota) {
      folha.escrever(truncar(c.nota, regular, 7.2, largura - 24), x + 12, topo - 50, 7.2, regular, COR.suave);
    }
  });
  folha.y -= altura + 20;
}

interface ColunaResumo {
  titulo: string;
  largura: number;
  direita?: boolean;
}

/** Barra curta com o percentual ao lado, dentro de uma célula. */
function celulaAndamento(folha: Folha, x: number, largura: number, centro: number, p: Progresso) {
  barra(folha.pagina, x + PAD_X, centro, largura - PAD_X * 2 - 30, p);
  folha.textoDireita(
    `${p.percentual}%`,
    x + largura - PAD_X,
    baseCentrada(centro, 7.5),
    7.5,
    folha.fontes.seminegrito,
    COR.tinta,
  );
}

/**
 * Resumo da capa. Um checklist só: uma linha por seção. Vários (o projeto
 * inteiro): uma linha por TAG e checklist.
 */
function resumo(folha: Folha, blocos: readonly Bloco[]): void {
  const { seminegrito, regular } = folha.fontes;

  if (blocos.length === 1) {
    const { formulario } = blocos[0];
    const linhas = formulario.definicao.secoes
      .map((secao) => ({ secao, p: progressoDe(etapasVisiveis(secao, formulario), formulario) }))
      .filter((l) => l.p.total > 0);
    if (!linhas.length) return;
    const alturaLinha = 20;
    const colunas: ColunaResumo[] = [
      { titulo: 'Seção', largura: 230.28 },
      { titulo: 'Andamento', largura: 125 },
      { titulo: 'Respondidas', largura: 72, direita: true },
      { titulo: 'Situação', largura: 88 },
    ];
    tituloBloco(
      folha,
      'Resumo por seção',
      ALTURA_CABECALHO_TABELA + alturaLinha,
      plural(linhas.length, 'seção', 'seções'),
    );
    cabecalhoTabela(folha, colunas);
    folha.aoQuebrar = () => cabecalhoTabela(folha, colunas);
    for (const { secao, p } of linhas) {
      folha.garantir(alturaLinha);
      const centro = folha.y - alturaLinha / 2;
      const base = baseCentrada(centro, 8.5);
      const larguraId = folha.escrever(
        truncar(secao.id, seminegrito, 8.5, 40),
        X + PAD_X,
        base,
        8.5,
        seminegrito,
        COR.tinta,
      );
      folha.escrever(
        truncar(secao.titulo, regular, 8.5, colunas[0].largura - PAD_X * 2 - larguraId - 8),
        X + PAD_X + larguraId + 8,
        base,
        8.5,
        regular,
        COR.texto,
      );
      let x = X + colunas[0].largura;
      celulaAndamento(folha, x, colunas[1].largura, centro, p);
      x += colunas[1].largura;
      folha.textoDireita(`${p.respondidas}/${p.total}`, x + colunas[2].largura - PAD_X, base, 8.5, regular, COR.tinta);
      x += colunas[2].largura;
      desenharSelo(folha, seloDoAndamento(p), x + PAD_X, centro + ALTURA_SELO / 2);
      filete(folha, folha.y - alturaLinha);
      folha.y -= alturaLinha;
    }
    folha.aoQuebrar = null;
    folha.y -= 20;
    return;
  }

  const larguraNome = 150;
  const colunas: ColunaResumo[] = [
    { titulo: 'TAG', largura: 90 },
    { titulo: 'Checklist', largura: larguraNome },
    { titulo: 'Andamento', largura: 115.28 },
    { titulo: 'Respondidas', largura: 72, direita: true },
    { titulo: 'Situação', largura: 88 },
  ];
  const nomes = blocos.map(({ formulario }) =>
    quebrarLimitado(formulario.definicao.nome, regular, 8, larguraNome - PAD_X * 2, 2),
  );
  const alturaDe = (i: number) => Math.max(24, 12 + nomes[i].length * 10.5);
  tituloBloco(
    folha,
    'Resumo por TAG e checklist',
    ALTURA_CABECALHO_TABELA + alturaDe(0),
    plural(blocos.length, 'checklist', 'checklists'),
  );
  cabecalhoTabela(folha, colunas);
  folha.aoQuebrar = () => cabecalhoTabela(folha, colunas);
  blocos.forEach(({ tag, formulario }, i) => {
    const alturaLinha = alturaDe(i);
    folha.garantir(alturaLinha);
    const p = formulario.progresso;
    const centro = folha.y - alturaLinha / 2;
    let x = X;
    folha.escrever(
      truncar(tag.nome, seminegrito, 8.5, colunas[0].largura - PAD_X * 2),
      x + PAD_X,
      baseCentrada(centro, 8.5),
      8.5,
      seminegrito,
      COR.tinta,
    );
    x += colunas[0].largura;
    const primeira = centro + ((nomes[i].length - 1) * 10.5) / 2;
    nomes[i].forEach((linha, k) => {
      folha.escrever(linha, x + PAD_X, baseCentrada(primeira - k * 10.5, 8), 8, regular, COR.texto);
    });
    x += colunas[1].largura;
    celulaAndamento(folha, x, colunas[2].largura, centro, p);
    x += colunas[2].largura;
    folha.textoDireita(
      `${p.respondidas}/${p.total}`,
      x + colunas[3].largura - PAD_X,
      baseCentrada(centro, 8.5),
      8.5,
      regular,
      COR.tinta,
    );
    x += colunas[3].largura;
    desenharSelo(folha, seloDoAndamento(p), x + PAD_X, centro + ALTURA_SELO / 2);
    filete(folha, folha.y - alturaLinha);
    folha.y -= alturaLinha;
  });
  folha.aoQuebrar = null;
  folha.y -= 20;
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
  const { seminegrito, regular, italico } = folha.fontes;
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
    const altura = 30;
    folha.garantir(altura + 20);
    retangulo(folha.pagina, { x: X, topo: folha.y, largura: LARGURA_UTIL, altura }, {
      raio: 8,
      cor: COR.sucessoFundo,
    });
    icone(folha.pagina, 'check', X + 12, folha.y - (altura - 13) / 2, 13, COR.sucessoPonto);
    folha.escrever(
      total === 1 ? 'A única etapa foi respondida.' : `Todas as ${total} etapas foram respondidas.`,
      X + 33,
      baseCentrada(folha.y - altura / 2, 9.5),
      9.5,
      seminegrito,
      COR.sucesso,
    );
    folha.y -= altura + 20;
    return;
  }

  const alturaLinha = 18;
  tituloBloco(folha, 'Pendências', alturaLinha, plural(pendentes, 'etapa pendente', 'etapas pendentes'));
  // Quantas linhas cabem antes do quadro do pé, contando a linha "… e mais".
  const espaco = folha.livre - reservar - 20;
  let cabem = Math.floor(espaco / alturaLinha);
  if (lista.length > cabem) cabem = Math.floor((espaco - 18) / alturaLinha);
  const limite = Math.max(3, Math.min(MAXIMO_PENDENCIAS_NA_CAPA, cabem));
  const mostradas = lista.slice(0, limite);
  for (const item of mostradas) {
    folha.garantir(alturaLinha);
    const selo =
      item.tipo === 'etapa' ? SITUACOES[item.situacao] : seloDoAndamento(item.formulario.progresso);
    const larguraDoSelo = larguraSelo(folha.fontes, selo);
    const centro = folha.y - alturaLinha / 2;
    const base = baseCentrada(centro, 8);
    const id =
      item.tipo === 'etapa'
        ? varios
          ? `${item.tag.nome} · ${item.etapa.id}`
          : item.etapa.id
        : `${item.tag.nome} · ${item.formulario.definicao.nome}`;
    const larguraMaximaId = item.tipo === 'etapa' ? 150 : 260;
    const textoId = truncar(id, seminegrito, 8, larguraMaximaId);
    const larguraId = folha.escrever(textoId, X + PAD_X, base, 8, seminegrito, COR.tinta);
    const descricao =
      item.tipo === 'etapa'
        ? item.etapa.descricao
        : `nenhuma etapa respondida (${plural(item.formulario.progresso.total, 'etapa', 'etapas')})`;
    folha.escrever(
      truncar(descricao, regular, 8, LARGURA_UTIL - larguraId - larguraDoSelo - PAD_X * 4 - 10),
      X + PAD_X + larguraId + 10,
      base,
      8,
      regular,
      COR.suave,
    );
    desenharSelo(folha, selo, DIREITA - PAD_X - larguraDoSelo, centro + ALTURA_SELO / 2);
    filete(folha, folha.y - alturaLinha);
    folha.y -= alturaLinha;
  }
  if (lista.length > mostradas.length) {
    folha.y -= 6;
    folha.paragrafo(
      `… e mais ${plural(lista.length - mostradas.length, 'pendência', 'pendências')}. A situação de cada etapa está nas tabelas a seguir.`,
      { tamanho: 7.8, cor: COR.suave, fonte: italico },
    );
  }
  folha.y -= 20;
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

const TAMANHO_NOTA = 7.5;
const PASSO_NOTA = 10.5;
const RECUO_LEGENDA = 12;

function linhasDasNotas(folha: Folha, notas: readonly string[]): string[][] {
  return notas.map((n) =>
    quebrarLinhas(n, folha.fontes.regular, TAMANHO_NOTA, LARGURA_UTIL - RECUO_LEGENDA * 2),
  );
}

/** Altura do quadro da legenda com as notas: a capa reserva esse espaço no pé. */
function alturaLegenda(folha: Folha, notas: readonly string[]): number {
  const linhas = linhasDasNotas(folha, notas).reduce((s, l) => s + l.length, 0);
  return RECUO_LEGENDA * 2 + ALTURA_SELO + 10 + linhas * PASSO_NOTA;
}

/** Quadro no pé da capa: legenda dos selos numa linha e, abaixo, as notas. */
function legenda(folha: Folha, notas: readonly string[]): void {
  const { seminegrito, regular } = folha.fontes;
  const itens: Array<[Selo, string]> = [
    [SITUACOES.verificado, 'respondida'],
    [SITUACOES.faltaFoto, 'marcada sem a foto obrigatória'],
    [SITUACOES.naoVerificado, 'sem resposta'],
  ];
  const altura = alturaLegenda(folha, notas);
  folha.garantir(altura);
  // Na capa, o quadro assenta no pé da página.
  folha.y = Math.min(folha.y, BASE_CONTEUDO + altura);

  retangulo(folha.pagina, { x: X, topo: folha.y, largura: LARGURA_UTIL, altura }, {
    raio: 8,
    cor: COR.superficie,
  });
  const centro = folha.y - RECUO_LEGENDA - ALTURA_SELO / 2;
  let x = X + RECUO_LEGENDA;
  x += folha.escrever('Legenda', x, baseCentrada(centro, 8), 8, seminegrito, COR.tinta) + 14;
  for (const [selo, texto] of itens) {
    x += desenharSelo(folha, selo, x, centro + ALTURA_SELO / 2) + 6;
    x += folha.escrever(texto, x, baseCentrada(centro, 7.5), 7.5, regular, COR.suave) + 16;
  }
  let y = folha.y - RECUO_LEGENDA - ALTURA_SELO - 10;
  folha.pagina.drawLine({
    start: { x: X + RECUO_LEGENDA, y: y + 5 },
    end: { x: DIREITA - RECUO_LEGENDA, y: y + 5 },
    thickness: 0.6,
    color: COR.linha,
  });
  for (const linha of linhasDasNotas(folha, notas).flat()) {
    folha.pagina.drawText(linha, {
      x: X + RECUO_LEGENDA,
      y: baseCentrada(y - PASSO_NOTA / 2, TAMANHO_NOTA),
      size: TAMANHO_NOTA,
      font: regular,
      color: COR.texto,
    });
    y -= PASSO_NOTA;
  }
  folha.y -= altura;
}

function desenharCapa(folha: Folha, dossie: Dossie, blocos: readonly Bloco[], opcoes: OpcoesPdf): void {
  const { negrito, regular } = folha.fontes;
  let base = folha.y - 14;
  escrever(folha.pagina, 'PROTOCOLO DE VERIFICAÇÃO', X, base, {
    fonte: folha.fontes.seminegrito,
    tamanho: 7.2,
    cor: COR.marca,
    espacamento: 1.1,
  });
  const alteracoes = blocos
    .map((b) => b.formulario.atualizadoEm)
    .filter((v): v is number => v !== undefined && v > 0);
  if (alteracoes.length) {
    folha.textoDireita(
      `Última alteração em ${dataHoraBr(Math.max(...alteracoes))}`,
      DIREITA,
      base,
      7.5,
      regular,
      COR.suave,
    );
  }
  base -= 30;
  for (const linha of quebrarLimitado(opcoes.titulo, negrito, 26, LARGURA_UTIL, 3)) {
    folha.escrever(linha, X, base, 26, negrito, COR.tinta);
    base -= 30;
  }
  base += 9;
  const subtitulo = [dossie.painel, dossie.empresa, dossie.nomeProjeto].filter(Boolean).join('  ·  ');
  folha.escrever(truncar(subtitulo, regular, 11.5, LARGURA_UTIL), X, base, 11.5, regular, COR.texto);
  folha.y = base - 24;

  indicadores(folha, dossie.progressoGeral, blocos);

  gradeCampos(folha, 'Identificação', [
    ...dossie.identificacao,
    ...(dossie.listarTags
      ? [[dossie.tags.length === 1 ? 'TAG' : 'TAGs', dossie.tags.map((t) => t.nome).join(', ')] as [string, string]]
      : []),
    ['Documento gerado em', dataHoraBr(dossie.geradoEm.getTime())],
  ], 4);

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
      return etapa.grade ? 'Ver tabela' : plural(preenchidos, 'valor', 'valores');
    }
    default:
      return '';
  }
}

function cabecalhoEtapas(folha: Folha): void {
  cabecalhoTabela(folha, COLUNAS);
}

const ALTURA_TITULO_SECAO = 17;

/**
 * Título da seção: selo vermelho com o código e o nome ao lado. À direita vai a
 * contagem do andamento (`direita.p`) ou um texto (`direita.texto`); sem nada,
 * é a continuação da seção numa página nova.
 */
function faixaSecao(
  folha: Folha,
  secao: { id?: string; titulo: string },
  direita: { p: Progresso } | { texto: string } | null,
): void {
  const { negrito, seminegrito, medio, regular } = folha.fontes;
  const topo = folha.y;
  const centro = topo - ALTURA_TITULO_SECAO / 2;

  let xTitulo = X;
  if (secao.id) {
    const larguraId = Math.max(larguraTexto(secao.id, { fonte: negrito, tamanho: 8 }) + 12, ALTURA_TITULO_SECAO + 4);
    retangulo(folha.pagina, { x: X, topo, largura: larguraId, altura: ALTURA_TITULO_SECAO }, {
      raio: 4.5,
      cor: COR.marca,
    });
    const texto = truncar(secao.id, negrito, 8, 80);
    folha.escrever(
      texto,
      X + (larguraId - larguraTexto(texto, { fonte: negrito, tamanho: 8 })) / 2,
      baseCentrada(centro, 8),
      8,
      negrito,
      COR.branco,
    );
    xTitulo += larguraId + 9;
  } else {
    // Registros fora do checklist: fio cinza no lugar do selo da seção.
    retangulo(folha.pagina, { x: X, topo, largura: 3.5, altura: ALTURA_TITULO_SECAO }, {
      raio: 1.75,
      cor: COR.apagado,
    });
    xTitulo += 11;
  }

  let reservado = 0;
  if (direita && 'p' in direita) {
    const p = direita.p;
    const contador = `${p.respondidas} de ${p.total} ${p.total === 1 ? 'respondida' : 'respondidas'}`;
    const largura = larguraTexto(contador, { fonte: medio, tamanho: 7.5 });
    folha.textoDireita(contador, DIREITA, baseCentrada(centro, 7.5), 7.5, medio, COR.suave);
    folha.pagina.drawCircle({ x: DIREITA - largura - 7, y: centro, size: 2.6, color: seloDoAndamento(p).ponto });
    reservado = largura + 24;
  } else if (direita) {
    folha.textoDireita(direita.texto, DIREITA, baseCentrada(centro, 7.5), 7.5, medio, COR.suave);
    reservado = larguraTexto(direita.texto, { fonte: medio, tamanho: 7.5 }) + 16;
  }

  const espaco = DIREITA - reservado - xTitulo;
  const larguraTitulo = folha.escrever(
    truncar(secao.titulo, seminegrito, 11.5, espaco - (direita ? 0 : 70)),
    xTitulo,
    baseCentrada(centro, 11.5),
    11.5,
    seminegrito,
    COR.tinta,
  );
  if (!direita) {
    folha.escrever('(continuação)', xTitulo + larguraTitulo + 6, baseCentrada(centro, 11.5), 8.5, regular, COR.apagado);
  }
  folha.y -= ALTURA_TITULO_SECAO + 10;
}

const PASSO_DESCRICAO = 12;
/** Até esta altura a etapa não se divide entre páginas. */
const ALTURA_MAXIMA_SEM_DIVIDIR = 140;

/**
 * Desenha a etapa, continuando na página seguinte quando o conteúdo não cabe.
 * O texto nunca passa do limite do rodapé: o que não couber segue, inteiro,
 * na próxima página, com "(cont.)" na coluna da etapa.
 */
function desenharEtapa(folha: Folha, etapa: Etapa, formulario: FormularioDoDossie): void {
  const { regular, medio, seminegrito, italico } = folha.fontes;
  const resposta = formulario.respostas[etapa.id];
  const fotos = fotosDa(formulario, etapa.id);
  const situacao = situacaoDaEtapa(etapa, formulario);
  const respondida = situacao === 'verificado';
  const larguraDescricao = COLUNAS[1].largura - PAD_X * 2;
  const larguraAferido = COLUNAS[2].largura - PAD_X * 2;

  // Resposta curta fica na coluna "Aferido"; a longa vai, inteira, para baixo
  // da descrição — nada é cortado.
  const aferido = valorAferido(etapa, resposta, fotos);
  let linhasAferido = aferido ? quebrarLinhas(aferido, medio, 8, larguraAferido) : [];
  let respostaLonga: string | null = null;
  if (linhasAferido.length > 3) {
    respostaLonga = aferido;
    linhasAferido = quebrarLinhas('Ver na descrição', italico, 7.5, larguraAferido);
  }
  const larguraOperador = COLUNAS[5].largura - PAD_X * 2;
  const linhasOperador =
    respondida && formulario.operador
      ? quebrarLimitado(formulario.operador, regular, 8, larguraOperador, 2)
      : [];

  const larguraQuadro = larguraDescricao - 16;
  const observacao = resposta?.observacao?.trim()
    ? quebrarLinhas(resposta.observacao, regular, 7.5, larguraQuadro)
    : [];
  const linhas: Linha[] = [
    ...quebrarLinhas(etapa.descricao, regular, 8.5, larguraDescricao).map((texto) => ({
      texto, tamanho: 8.5, passo: PASSO_DESCRICAO, fonte: regular, cor: COR.tinta,
    })),
    ...(etapa.detalhes ?? []).flatMap((d) =>
      quebrarLinhas(`• ${d}`, regular, 7.5, larguraDescricao - 2).map((texto) => ({
        texto, tamanho: 7.5, passo: 10.5, fonte: regular, cor: COR.suave, recuo: 2,
      })),
    ),
    ...(respostaLonga
      ? [
          { texto: '', tamanho: 4, passo: 3, fonte: regular, cor: COR.tinta },
          ...quebrarLinhas(`Resposta: ${respostaLonga}`, seminegrito, 8, larguraDescricao).map((texto) => ({
            texto, tamanho: 8, passo: 11, fonte: seminegrito, cor: COR.tinta,
          })),
        ]
      : []),
    // Observação num quadro de fundo suave: rótulo em versalete e o texto.
    ...(observacao.length
      ? [
          { texto: '', tamanho: 4, passo: 5, fonte: regular, cor: COR.tinta },
          { texto: '', tamanho: 4, passo: 5, fonte: regular, cor: COR.tinta, quadro: true },
          {
            texto: 'OBSERVAÇÃO', tamanho: 5.8, passo: 9, fonte: seminegrito, cor: COR.suave,
            recuo: 9, espacamento: 0.55, quadro: true,
          },
          ...observacao.map((texto) => ({
            texto, tamanho: 7.5, passo: 10.5, fonte: regular, cor: COR.texto, recuo: 9, quadro: true,
          })),
          { texto: '', tamanho: 4, passo: 5, fonte: regular, cor: COR.tinta, quadro: true },
        ]
      : []),
  ];

  // Descrição só de espaços (o schema aceita) não deixa a etapa sem linha.
  if (!linhas.length) {
    linhas.push({ texto: '—', tamanho: 8.5, passo: PASSO_DESCRICAO, fonte: regular, cor: COR.apagado });
  }

  const minimoPrimeira = Math.max(
    PAD_TOPO + Math.max(linhasAferido.length, 1) * PASSO_DESCRICAO + PAD_BASE,
    PAD_TOPO + Math.max(linhasOperador.length, 1) * PASSO_DESCRICAO + PAD_BASE,
    PAD_TOPO + ALTURA_SELO + PAD_BASE,
    PAD_TOPO + linhas[0].passo + PAD_BASE,
    26,
  );
  const temGrade =
    etapa.tipoResposta === 'grade_numerica' &&
    !!etapa.grade &&
    !!resposta?.valor &&
    typeof resposta.valor === 'object';

  // Etapa curta vai inteira para a página seguinte; só a longa se divide.
  const alturaInteira = Math.max(
    minimoPrimeira,
    PAD_TOPO + linhas.reduce((s, l) => s + l.passo, 0) + PAD_BASE,
  );
  let indice = 0;
  let primeira = true;
  do {
    if (primeira && alturaInteira <= ALTURA_MAXIMA_SEM_DIVIDIR) folha.garantir(alturaInteira);
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
    const fundo = FUNDO_LINHA[situacao];
    if (fundo) {
      retangulo(pagina, { x: X, topo, largura: LARGURA_UTIL, altura }, { cor: fundo });
    }

    // Centro da primeira linha: referência das colunas laterais.
    const centro = topo - PAD_TOPO - PASSO_DESCRICAO / 2;
    const base = baseCentrada(centro, 8);
    if (primeira) {
      folha.escrever(
        truncar(etapa.id, seminegrito, 8, COLUNAS[0].largura - PAD_X - 2),
        X + PAD_X,
        base,
        8,
        seminegrito,
        COR.tinta,
      );
    } else {
      folha.escrever('(cont.)', X + PAD_X, base, 7, italico, COR.apagado);
    }

    let yLinha = topo - PAD_TOPO;
    const xDescricao = X_COLUNAS[1] + PAD_X;
    for (const linha of linhas.slice(indice, fim)) {
      if (linha.quadro) {
        retangulo(pagina, { x: xDescricao, topo: yLinha, largura: larguraDescricao, altura: linha.passo }, {
          cor: COR.superficie,
        });
        retangulo(pagina, { x: xDescricao, topo: yLinha, largura: 2.2, altura: linha.passo }, {
          cor: COR.apagado,
        });
      }
      if (linha.texto) {
        escrever(pagina, linha.texto, xDescricao + (linha.recuo ?? 0), baseCentrada(yLinha - linha.passo / 2, linha.tamanho), {
          fonte: linha.fonte,
          tamanho: linha.tamanho,
          cor: linha.cor,
          espacamento: linha.espacamento,
        });
      }
      yLinha -= linha.passo;
    }

    // Aferido, status, data e operador saem uma vez só, na primeira parte.
    if (primeira) {
      const xAferido = X_COLUNAS[2] + PAD_X;
      if (linhasAferido.length) {
        linhasAferido.forEach((linha, i) => {
          folha.escrever(
            linha,
            xAferido,
            base - i * PASSO_DESCRICAO,
            respostaLonga ? 7.5 : 8,
            respostaLonga ? italico : medio,
            respostaLonga ? COR.suave : COR.tinta,
          );
        });
      } else {
        folha.escrever('—', xAferido, base, 8, regular, COR.apagado);
      }

      desenharSelo(folha, SITUACOES[situacao], X_COLUNAS[3] + PAD_X, centro + ALTURA_SELO / 2);

      const xData = X_COLUNAS[4] + PAD_X;
      folha.escrever(
        respondida ? dataBr(formulario.atualizadoEm) : '—',
        xData,
        base,
        8,
        regular,
        respondida ? COR.texto : COR.apagado,
      );

      const xOperador = X_COLUNAS[5] + PAD_X;
      if (linhasOperador.length) {
        linhasOperador.forEach((linha, i) => {
          folha.escrever(linha, xOperador, base - i * PASSO_DESCRICAO, 8, regular, COR.texto);
        });
      } else {
        folha.escrever('—', xOperador, base, 8, regular, COR.apagado);
      }
    }

    folha.y -= altura;
    indice = fim;
    primeira = false;
    // A tabela de medições fica junto da etapa, antes do filete.
    if (indice < linhas.length || !temGrade) filete(folha, folha.y);
  } while (indice < linhas.length);

  if (temGrade) {
    desenharGrade(folha, etapa, resposta!.valor as ValorGrade, FUNDO_LINHA[situacao]);
    filete(folha, folha.y);
  }
}

/** Tabela de medições da etapa `grade_numerica`, logo abaixo da descrição dela. */
function desenharGrade(folha: Folha, etapa: Etapa, valor: ValorGrade, fundo: Color | null): void {
  const grade = etapa.grade;
  if (!grade) return;
  const { seminegrito, medio, regular } = folha.fontes;
  const x0 = X_COLUNAS[1] + PAD_X;
  const disponivel = DIREITA - PAD_X - x0;
  const larguraRotulo = Math.min(120, disponivel * 0.34);
  const larguraColuna = Math.min(104, (disponivel - larguraRotulo) / grade.colunas.length);
  const larguraTotal = larguraRotulo + larguraColuna * grade.colunas.length;
  const alturaCabecalho = 20;
  const alturaLinha = 15;

  // A faixa da linha da etapa continua por trás da tabela.
  const faixa = (altura: number) => {
    if (fundo) retangulo(folha.pagina, { x: X, topo: folha.y, largura: LARGURA_UTIL, altura }, { cor: fundo });
  };

  const cabecalho = () => {
    faixa(alturaCabecalho);
    retangulo(folha.pagina, { x: x0, topo: folha.y, largura: larguraTotal, altura: alturaCabecalho }, {
      raio: [6, 6, 0, 0],
      cor: COR.superficie,
    });
    const base = baseCentrada(folha.y - alturaCabecalho / 2, 6.8);
    folha.escrever('Ponto', x0 + 9, base, 6.8, seminegrito, COR.suave);
    grade.colunas.forEach((coluna, i) => {
      const titulo = `${coluna.rotulo}${coluna.unidade ? ` (${coluna.unidade})` : ''}`;
      const direita = x0 + larguraRotulo + larguraColuna * (i + 1) - 9;
      folha.textoDireita(truncar(titulo, seminegrito, 6.8, larguraColuna - 14), direita, base, 6.8, seminegrito, COR.suave);
    });
    folha.y -= alturaCabecalho;
  };

  folha.garantir(alturaCabecalho + alturaLinha + 8);
  cabecalho();
  grade.linhas.forEach((linha, i) => {
    if (folha.garantir(alturaLinha + 8)) cabecalho();
    faixa(alturaLinha);
    const ultima = i === grade.linhas.length - 1;
    retangulo(folha.pagina, { x: x0, topo: folha.y, largura: larguraTotal, altura: alturaLinha }, {
      raio: ultima ? [0, 0, 6, 6] : 0,
      cor: i % 2 === 1 ? COR.zebra : COR.branco,
    });
    if (!ultima) {
      folha.pagina.drawLine({
        start: { x: x0, y: folha.y - alturaLinha },
        end: { x: x0 + larguraTotal, y: folha.y - alturaLinha },
        thickness: 0.4,
        color: COR.linhaSuave,
      });
    }
    const centro = folha.y - alturaLinha / 2;
    folha.escrever(
      truncar(linha.rotulo, medio, 7.5, larguraRotulo - 14),
      x0 + 9,
      baseCentrada(centro, 7.5),
      7.5,
      medio,
      COR.texto,
    );
    grade.colunas.forEach((coluna, j) => {
      const v = valor[linha.id]?.[coluna.id];
      const preenchido = typeof v === 'number' && Number.isFinite(v);
      folha.textoDireita(
        truncar(preenchido ? formatarNumero(v) : '—', regular, 7.8, larguraColuna - 14),
        x0 + larguraRotulo + larguraColuna * (j + 1) - 9,
        baseCentrada(centro, 7.8),
        7.8,
        preenchido ? medio : regular,
        preenchido ? COR.tinta : COR.apagado,
      );
    });
    folha.y -= alturaLinha;
  });
  faixa(8);
  folha.y -= 8;
}

/** Abertura do checklist: TAG, nome, revisão, anel de andamento e dados do painel. */
function aberturaChecklist(folha: Folha, tag: TagDoDossie, formulario: FormularioDoDossie): void {
  const { negrito, seminegrito, regular } = folha.fontes;
  const definicao = formulario.definicao;
  const p = formulario.progresso;
  const larguraBloco = LARGURA_UTIL - 175;

  let base = folha.y - 12;
  escrever(folha.pagina, 'TAG', X, base, {
    fonte: seminegrito,
    tamanho: 7.2,
    cor: COR.marca,
    espacamento: 1.1,
  });
  base -= 28;
  const centroAnel = base + 9;
  for (const linha of quebrarLimitado(tag.nome, negrito, 24, larguraBloco, 2)) {
    folha.escrever(linha, X, base, 24, negrito, COR.tinta);
    base -= 28;
  }
  base += 9;
  for (const linha of quebrarLimitado(definicao.nome, regular, 10.5, larguraBloco, 2)) {
    folha.escrever(linha, X, base, 10.5, regular, COR.texto);
    base -= 14;
  }
  const meta = [
    `Revisão ${formulario.formRevisao}${definicao.dataRevisao ? ` de ${dataLegivel(definicao.dataRevisao)}` : ''}`,
    definicao.linhaProduto,
    definicao.emitidoPor ? `Emitido por ${definicao.emitidoPor}` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');
  base -= 2;
  folha.escrever(truncar(meta, regular, 8, larguraBloco), X, base, 8, regular, COR.suave);

  // Andamento: anel à direita, com a contagem e o selo ao lado.
  const raio = 26;
  const cx = DIREITA - raio - 3;
  anelProgresso(folha.pagina, cx, centroAnel, raio, 5.5, fracao(p), seloDoAndamento(p).ponto, COR.superficieForte);
  const pct = `${p.percentual}%`;
  folha.escrever(
    pct,
    cx - larguraTexto(pct, { fonte: negrito, tamanho: 11 }) / 2,
    baseCentrada(centroAnel, 11),
    11,
    negrito,
    COR.tinta,
  );
  const xLegenda = cx - raio - 14;
  folha.textoDireita(`${p.respondidas} de ${p.total}`, xLegenda, centroAnel + 6, 11, seminegrito, COR.tinta);
  folha.textoDireita(
    p.total === 1 ? 'etapa respondida' : 'etapas respondidas',
    xLegenda,
    centroAnel - 6,
    7.5,
    regular,
    COR.suave,
  );
  const selo = seloDoAndamento(p);
  desenharSelo(folha, selo, xLegenda - larguraSelo(folha.fontes, selo), centroAnel - 12);

  folha.y = Math.min(base, centroAnel - raio - 6) - 24;

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
    tabelaDeEtapas(folha, secao, { p: progressoDe(etapas, formulario) }, etapas, formulario);
  }

  const fora = etapasForaDoChecklist(formulario);
  if (fora.length) {
    tabelaDeEtapas(
      folha,
      { titulo: 'Fora do checklist atual' },
      { texto: plural(fora.length, 'registro', 'registros') },
      fora,
      formulario,
      'Etapas desativadas ou retiradas do checklist depois do preenchimento. O que foi registrado nelas fica no documento, para rastreabilidade, e não entra no andamento.',
    );
  }
}

/** Título da seção, cabeçalho e as etapas — o título volta no alto de cada página nova. */
function tabelaDeEtapas(
  folha: Folha,
  secao: { id?: string; titulo: string },
  direita: { p: Progresso } | { texto: string },
  etapas: readonly Etapa[],
  formulario: FormularioDoDossie,
  nota?: string,
): void {
  // Título, nota, cabeçalho e a primeira linha da tabela: nunca o título
  // sozinho no pé da página. 44 é a maior altura mínima da primeira parte.
  folha.garantir(ALTURA_TITULO_SECAO + 10 + (nota ? 30 : 0) + ALTURA_CABECALHO_TABELA + 44);
  faixaSecao(folha, secao, direita);
  if (nota) {
    folha.paragrafo(nota, { tamanho: 7.8, cor: COR.suave, fonte: folha.fontes.italico });
    folha.y -= 4;
  }
  cabecalhoEtapas(folha);
  folha.aoQuebrar = () => {
    faixaSecao(folha, secao, null);
    cabecalhoEtapas(folha);
  };
  for (const etapa of etapas) desenharEtapa(folha, etapa, formulario);
  folha.aoQuebrar = null;
  folha.y -= 26;
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

const FOTOS_POR_LINHA = 3;
const FOTO_VAO = 12;
const FOTO_LARGURA_CARTAO = (LARGURA_UTIL - FOTO_VAO * (FOTOS_POR_LINHA - 1)) / FOTOS_POR_LINHA;
const FOTO_RECUO = 5;
const FOTO_ALTURA_IMAGEM = 158;
const FOTO_ALTURA_LEGENDA = 42;
const FOTO_ALTURA_CARTAO = FOTO_RECUO + FOTO_ALTURA_IMAGEM + FOTO_ALTURA_LEGENDA;
const ALTURA_ANEXO = 44;

/**
 * Registro fotográfico do checklist: as fotos numa galeria de três colunas, na
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
      itens.push({ tipo: 'foto', id, descricao, imagem, numero: i + 1, total: imagens.length });
    }
  }

  const { negrito, seminegrito, medio, regular } = folha.fontes;
  const alturaAbertura = 84;
  const primeiro = itens[0].tipo === 'foto' ? FOTO_ALTURA_CARTAO : ALTURA_ANEXO;
  // Continua na mesma página quando cabem a abertura e a primeira linha.
  if (folha.livre < 12 + alturaAbertura + primeiro) folha.novaPagina();
  else folha.y -= 12;

  let base = folha.y - 12;
  escrever(folha.pagina, 'REGISTRO FOTOGRÁFICO', X, base, {
    fonte: seminegrito,
    tamanho: 7.2,
    cor: COR.marca,
    espacamento: 1.1,
  });
  base -= 26;
  const fotos = itens.filter((i) => i.tipo === 'foto').length;
  const anexos = itens.length - fotos;
  const resumoFotos = [
    fotos ? plural(fotos, 'foto', 'fotos') : '',
    anexos ? plural(anexos, 'anexo em PDF', 'anexos em PDF') : '',
  ]
    .filter(Boolean)
    .join(' e ');
  const larguraResumo = larguraTexto(resumoFotos, { fonte: medio, tamanho: 8 });
  folha.escrever(truncar(`TAG ${tag.nome}`, negrito, 20, LARGURA_UTIL - larguraResumo - 20), X, base, 20, negrito, COR.tinta);
  folha.textoDireita(resumoFotos, DIREITA, base, 8, medio, COR.suave);
  base -= 17;
  folha.escrever(truncar(formulario.definicao.nome, regular, 9.5, LARGURA_UTIL), X, base, 9.5, regular, COR.texto);
  folha.y = base - 22;

  for (let i = 0; i < itens.length; ) {
    const item = itens[i];
    if (item.tipo === 'anexo') {
      await desenharAnexo(folha, tag, item);
      i += 1;
      continue;
    }
    const linha: CartaoFoto[] = [];
    while (linha.length < FOTOS_POR_LINHA && itens[i]?.tipo === 'foto') {
      linha.push(itens[i] as CartaoFoto);
      i += 1;
    }
    desenharLinhaDeFotos(folha, linha);
  }
}

/** Selo claro com o id da etapa; devolve a largura. */
function seloEtapa(folha: Folha, id: string, x: number, topo: number): number {
  const { seminegrito } = folha.fontes;
  const texto = truncar(id, seminegrito, 7.5, 80);
  const largura = larguraTexto(texto, { fonte: seminegrito, tamanho: 7.5 }) + 12;
  retangulo(folha.pagina, { x, topo, largura, altura: 14 }, { raio: 4, cor: COR.superficieForte });
  folha.escrever(texto, x + 6, baseCentrada(topo - 7, 7.5), 7.5, seminegrito, COR.tinta);
  return largura;
}

function desenharLinhaDeFotos(folha: Folha, linha: CartaoFoto[]): void {
  const { seminegrito, regular, italico } = folha.fontes;
  folha.garantir(FOTO_ALTURA_CARTAO + FOTO_VAO);
  const topo = folha.y;
  const pagina = folha.pagina;

  linha.forEach((cartao, j) => {
    const x = X + j * (FOTO_LARGURA_CARTAO + FOTO_VAO);
    retangulo(pagina, { x, topo, largura: FOTO_LARGURA_CARTAO, altura: FOTO_ALTURA_CARTAO }, {
      raio: 8,
      cor: COR.branco,
      borda: COR.linha,
    });
    const area = {
      x: x + FOTO_RECUO,
      topo: topo - FOTO_RECUO,
      largura: FOTO_LARGURA_CARTAO - FOTO_RECUO * 2,
      altura: FOTO_ALTURA_IMAGEM,
    };
    retangulo(pagina, area, { raio: 5, cor: COR.superficie });
    const imagem = cartao.imagem;
    if (imagem) {
      const escala = Math.min(area.largura / imagem.width, area.altura / imagem.height);
      const largura = imagem.width * escala;
      const altura = imagem.height * escala;
      const caixa = {
        x: area.x + (area.largura - largura) / 2,
        topo: area.topo - (area.altura - altura) / 2,
        largura,
        altura,
      };
      comRecorte(pagina, caixa, 5, () => {
        pagina.drawImage(imagem, { x: caixa.x, y: caixa.topo - altura, width: largura, height: altura });
      });
    } else {
      const aviso = 'Foto não pôde ser incorporada.';
      const larguraAviso = larguraTexto(aviso, { fonte: italico, tamanho: 7.5 });
      folha.escrever(aviso, area.x + (area.largura - larguraAviso) / 2, area.topo - area.altura / 2, 7.5, italico, COR.suave);
    }

    const base = topo - FOTO_RECUO - FOTO_ALTURA_IMAGEM - 14;
    const larguraId = folha.escrever(truncar(cartao.id, seminegrito, 8, 90), x + 9, base, 8, seminegrito, COR.tinta);
    if (cartao.total > 1) {
      folha.escrever(`  ·  foto ${cartao.numero} de ${cartao.total}`, x + 9 + larguraId, base, 7.5, regular, COR.suave);
    }
    quebrarLimitado(cartao.descricao, regular, 7, FOTO_LARGURA_CARTAO - 18, 2).forEach((texto, k) => {
      folha.escrever(texto, x + 9, base - 12 - k * 9, 7, regular, COR.suave);
    });
  });
  folha.y -= FOTO_ALTURA_CARTAO + FOTO_VAO;
}

async function desenharAnexo(folha: Folha, tag: TagDoDossie, item: LinhaAnexo): Promise<void> {
  const { seminegrito, regular } = folha.fontes;
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

  folha.garantir(ALTURA_ANEXO + FOTO_VAO);
  const topo = folha.y;
  retangulo(folha.pagina, { x: X, topo, largura: LARGURA_UTIL, altura: ALTURA_ANEXO }, {
    raio: 8,
    cor: COR.branco,
    borda: COR.linha,
  });
  const larguraIcone = 18;
  const topoIcone = topo - (ALTURA_ANEXO - larguraIcone * 1.3) / 2;
  iconeDocumento(folha.pagina, X + 12, topoIcone, larguraIcone, COR.apagado, COR.superficie);
  const rotuloPdf = larguraTexto('PDF', { fonte: folha.fontes.negrito, tamanho: 5 });
  folha.escrever('PDF', X + 12 + (larguraIcone - rotuloPdf) / 2, topoIcone - 17, 5, folha.fontes.negrito, COR.marca);

  const xTexto = X + 12 + larguraIcone + 12;
  const larguraId = seloEtapa(folha, item.id, xTexto, topo - 8);
  folha.escrever(
    truncar(item.descricao, regular, 8, DIREITA - 12 - xTexto - larguraId - 8),
    xTexto + larguraId + 8,
    baseCentrada(topo - 15, 8),
    8,
    regular,
    COR.texto,
  );
  folha.escrever(
    truncar(
      `${midia.nomeOriginal ?? 'documento.pdf'}  ·  ${formatarBytes(midia.tamanho)}  ·  ${
        incorporado ? `anexado a este PDF como ${nomeAnexo}` : 'não pôde ser anexado a este PDF'
      }`,
      regular,
      7.5,
      DIREITA - 12 - xTexto,
    ),
    xTexto,
    baseCentrada(topo - 32, 7.5),
    7.5,
    incorporado ? seminegrito : regular,
    incorporado ? COR.suave : COR.erro,
  );
  folha.y -= ALTURA_ANEXO + FOTO_VAO;
}

/* ----------------------------------------------------------------------- */
/* Documento                                                                */
/* ----------------------------------------------------------------------- */

function rodape(doc: PDFDocument, fontes: Fontes, texto: string): void {
  const paginas = doc.getPages();
  const base = MARGEM.base - 12;
  paginas.forEach((pagina, i) => {
    pagina.drawLine({
      start: { x: X, y: MARGEM.base },
      end: { x: DIREITA, y: MARGEM.base },
      thickness: 0.75,
      color: COR.linha,
    });
    escrever(pagina, truncar(texto, fontes.regular, 7, LARGURA_UTIL - 90), X, base, {
      fonte: fontes.regular,
      tamanho: 7,
      cor: COR.suave,
    });
    escreverDireita(pagina, `Página ${i + 1} de ${paginas.length}`, DIREITA, base, {
      fonte: fontes.seminegrito,
      tamanho: 7,
      cor: COR.texto,
    });
  });
}

export interface OpcoesPdf {
  incluirFotos: boolean;
  /** Título do documento: o tipo de verificação ou o nome do checklist. */
  titulo: string;
  /** ZIP que leva as fotos quando elas não vão embutidas. */
  arquivoFotos?: string;
  /** Família tipográfica do documento. Sem ela, o PDF sai em Helvetica. */
  fontes?: BytesFontes;
}

/**
 * Monta um PDF com a capa (indicadores, identificação, resumo e pendências) e,
 * para cada TAG e checklist, a abertura, as seções com as etapas e o registro
 * fotográfico.
 */
export async function gerarPdf(dossie: Dossie, opcoes: OpcoesPdf): Promise<Blob> {
  const doc = await PDFDocument.create();
  const fontes = await incorporarFontes(doc, opcoes.fontes);

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

  const contexto = [dossie.painel, dossie.empresa, dossie.nomeProjeto].filter(Boolean).join(' · ');
  const folha = new Folha(doc, fontes, opcoes.titulo, `Gerado em ${dataBr(dossie.geradoEm)}`);
  desenharCapa(folha, dossie, blocos, opcoes);

  for (const { tag, formulario } of blocos) {
    folha.contexto = `${contexto} · ${tag.nome}`;
    desenharChecklist(folha, tag, formulario);
    if (opcoes.incluirFotos) await desenharFotos(folha, tag, formulario);
  }

  rodape(
    doc,
    fontes,
    `${dossie.empresa} · ${dossie.nomeProjeto} · gerado em ${dataHoraBr(dossie.geradoEm.getTime())}`,
  );

  const bytes = await doc.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}
