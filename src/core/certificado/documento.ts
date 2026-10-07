import { PDFDocument, type Color, type PDFFont, type PDFPage } from 'pdf-lib';
import { quebrarLimitado, quebrarLinhas, truncar } from '../export/pdf/texto';
import {
  BASE_CONTEUDO,
  COR,
  DIREITA,
  LARGURA_UTIL,
  MARGEM,
  PAGINA,
  incorporarFontes,
  type BytesFontes,
  type Fontes,
} from '../export/pdf/tema';
import {
  alturaMaiuscula,
  escrever,
  escreverDireita,
  larguraTexto,
  retangulo,
  type EstiloTexto,
} from '../export/pdf/desenho';
import { LOGO_ABB } from '../../shared/marca/logoAbb';
import { aplicarMarcadores } from './contexto';
import type { BlocoCertificado, ContextoCertificado, TemplateCertificado } from './tipos';

/**
 * Certificado de produto, no mesmo visual do dossiê (tipografia, cores e
 * primitivas de `core/export/pdf`). Nenhum texto do corpo vive aqui: tudo vem
 * do template do painel.
 */

const X = MARGEM.x;
const TAMANHO_TEXTO = 9.5;
const PASSO_TEXTO = 13.5;
const TAMANHO_ITEM = 8.8;
const PASSO_ITEM = 12;

function baseCentrada(centro: number, tamanho: number): number {
  return centro - alturaMaiuscula({ tamanho }) / 2;
}

class Folha {
  pagina!: PDFPage;
  y = 0;

  constructor(
    readonly doc: PDFDocument,
    readonly fontes: Fontes,
    private readonly template: TemplateCertificado,
    private readonly contexto: ContextoCertificado,
  ) {
    this.novaPagina();
  }

  novaPagina(): void {
    this.pagina = this.doc.addPage([PAGINA.largura, PAGINA.altura]);
    this.desenharTopo();
  }

  /** Filete vermelho, logotipo, número do certificado e título do produto. */
  private desenharTopo(): void {
    const { pagina, fontes } = this;
    retangulo(
      pagina,
      { x: 0, topo: PAGINA.altura, largura: PAGINA.largura, altura: 4 },
      {
        cor: COR.marca,
      },
    );

    const alturaLogo = 22;
    const escala = alturaLogo / LOGO_ABB.altura;
    const topoLogo = PAGINA.altura - MARGEM.topo - 4;
    // O logotipo em vetor, e não a palavra "ABB" na fonte do documento.
    for (const caminho of LOGO_ABB.caminhos) {
      pagina.drawSvgPath(caminho, { x: X, y: topoLogo, scale: escala, color: COR.marca });
    }

    escreverDireita(pagina, 'CERTIFICADO', DIREITA, topoLogo - 6, {
      fonte: fontes.seminegrito,
      tamanho: 6.5,
      cor: COR.suave,
      espacamento: 1,
    });
    const numero = aplicarMarcadores(this.template.numero, this.contexto);
    escreverDireita(pagina, truncar(numero, fontes.negrito, 15, 200), DIREITA, topoLogo - 22, {
      fonte: fontes.negrito,
      tamanho: 15,
      cor: COR.tinta,
    });

    let base = topoLogo - alturaLogo - 30;
    for (const linha of quebrarLimitado(
      this.template.tituloProduto,
      fontes.negrito,
      20,
      LARGURA_UTIL,
      2,
    )) {
      escrever(pagina, linha, X, base, { fonte: fontes.negrito, tamanho: 20, cor: COR.tinta });
      base -= 24;
    }
    base += 24;

    pagina.drawLine({
      start: { x: X, y: base - 12 },
      end: { x: DIREITA, y: base - 12 },
      thickness: 0.75,
      color: COR.linha,
    });
    this.y = base - 26;
  }

  /** Garante `altura` livre, quebrando a página se preciso. */
  garantir(altura: number): void {
    if (this.y - altura < BASE_CONTEUDO) this.novaPagina();
  }

  escrever(
    texto: string,
    x: number,
    y: number,
    tamanho: number,
    fonte: PDFFont,
    cor: Color,
  ): number {
    return escrever(this.pagina, texto, x, y, { fonte, tamanho, cor });
  }

  /** Parágrafo corrido, com quebra de linha e de página. */
  paragrafo(valor: string, estilo: { cor?: Color; fonte?: PDFFont } = {}): void {
    const fonte = estilo.fonte ?? this.fontes.regular;
    for (const linha of quebrarLinhas(valor, fonte, TAMANHO_TEXTO, LARGURA_UTIL)) {
      this.garantir(PASSO_TEXTO);
      this.escrever(
        linha,
        X,
        baseCentrada(this.y - PASSO_TEXTO / 2, TAMANHO_TEXTO),
        TAMANHO_TEXTO,
        fonte,
        estilo.cor ?? COR.texto,
      );
      this.y -= PASSO_TEXTO;
    }
  }
}

/** Dados do certificado em grade de três colunas sobre um cartão de fundo suave. */
function desenharCampos(
  folha: Folha,
  itens: { rotulo: string; valor: string }[],
  contexto: ContextoCertificado,
): void {
  const { regular, medio } = folha.fontes;
  const colunas = 3;
  const recuo = 14;
  const larguraColuna = (LARGURA_UTIL - recuo * 2) / colunas;
  const larguraCampo = larguraColuna - 12;
  const passoValor = 13;
  const vao = 10;

  const celulas = itens.map((item) => {
    const valor = aplicarMarcadores(item.valor, contexto).trim();
    return {
      rotulo: truncar(item.rotulo, regular, 7, larguraCampo),
      linhas: valor ? quebrarLimitado(valor, medio, 10, larguraCampo, 2) : ['—'],
      preenchido: valor.length > 0,
    };
  });
  const linhas: (typeof celulas)[] = [];
  for (let i = 0; i < celulas.length; i += colunas) linhas.push(celulas.slice(i, i + colunas));
  const alturaLinha = (linha: typeof celulas) =>
    22 + (Math.max(...linha.map((c) => c.linhas.length)) - 1) * passoValor;
  const altura =
    recuo * 2 + linhas.reduce((s, l) => s + alturaLinha(l), 0) + vao * (linhas.length - 1);

  folha.garantir(altura);
  retangulo(
    folha.pagina,
    { x: X, topo: folha.y, largura: LARGURA_UTIL, altura },
    {
      raio: 8,
      cor: COR.superficie,
    },
  );
  let topo = folha.y - recuo;
  for (const linha of linhas) {
    linha.forEach((c, j) => {
      const x = X + recuo + j * larguraColuna;
      folha.escrever(c.rotulo, x, topo - 5, 7, regular, COR.suave);
      c.linhas.forEach((texto, k) => {
        folha.escrever(
          texto,
          x,
          topo - 18.5 - k * passoValor,
          10,
          medio,
          c.preenchido ? COR.tinta : COR.apagado,
        );
      });
    });
    topo -= alturaLinha(linha) + vao;
  }
  folha.y -= altura + 16;
}

/** Lista em cartão claro, com marcadores na cor da marca. */
function desenharLista(folha: Folha, itens: string[], contexto: ContextoCertificado): void {
  const { regular } = folha.fontes;
  const recuo = 9;
  const larguraItem = LARGURA_UTIL - 32;
  const linhas = itens.map((item) =>
    quebrarLinhas(aplicarMarcadores(item, contexto), regular, TAMANHO_ITEM, larguraItem),
  );

  // O cartão se divide nas quebras de página: cada pedaço leva os itens que cabem.
  let indice = 0;
  while (indice < linhas.length) {
    folha.garantir(recuo * 2 + linhas[indice].length * PASSO_ITEM);
    let altura = recuo * 2;
    let fim = indice;
    while (fim < linhas.length) {
      const extra = linhas[fim].length * PASSO_ITEM;
      if (fim > indice && folha.y - altura - extra < BASE_CONTEUDO) break;
      altura += extra;
      fim += 1;
    }
    retangulo(
      folha.pagina,
      { x: X, topo: folha.y, largura: LARGURA_UTIL, altura },
      {
        raio: 8,
        cor: COR.superficie,
      },
    );
    let y = folha.y - recuo;
    for (const item of linhas.slice(indice, fim)) {
      folha.pagina.drawCircle({ x: X + 16, y: y - PASSO_ITEM / 2, size: 1.8, color: COR.marca });
      for (const texto of item) {
        folha.escrever(
          texto,
          X + 25,
          baseCentrada(y - PASSO_ITEM / 2, TAMANHO_ITEM),
          TAMANHO_ITEM,
          regular,
          COR.texto,
        );
        y -= PASSO_ITEM;
      }
    }
    folha.y -= altura;
    indice = fim;
  }
  folha.y -= 14;
}

/** Nota em quadro, com o ícone de informação. */
function desenharNota(folha: Folha, texto: string): void {
  const { regular, negrito } = folha.fontes;
  const recuo = 11;
  const linhas = quebrarLinhas(texto, regular, 8.5, LARGURA_UTIL - recuo * 2 - 22);
  const altura = recuo * 2 + linhas.length * 12;
  folha.garantir(altura);
  retangulo(
    folha.pagina,
    { x: X, topo: folha.y, largura: LARGURA_UTIL, altura },
    {
      raio: 8,
      borda: COR.linha,
    },
  );
  const xIcone = X + recuo + 5.5;
  const yIcone = folha.y - recuo - 6;
  folha.pagina.drawCircle({
    x: xIcone,
    y: yIcone,
    size: 5.5,
    borderColor: COR.suave,
    borderWidth: 0.8,
  });
  const i: EstiloTexto = { fonte: negrito, tamanho: 6.5, cor: COR.suave };
  escrever(folha.pagina, 'i', xIcone - larguraTexto('i', i) / 2, baseCentrada(yIcone, 6.5), i);
  linhas.forEach((linha, n) => {
    folha.escrever(
      linha,
      X + recuo + 20,
      baseCentrada(folha.y - recuo - 6 - n * 12, 8.5),
      8.5,
      regular,
      COR.texto,
    );
  });
  folha.y -= altura + 16;
}

type CampoLargo = Extract<BlocoCertificado, { tipo: 'campoLargo' }>;
type Assinatura = Extract<BlocoCertificado, { tipo: 'assinatura' }>;

function alturaCampoLargo(): number {
  return 34;
}

function desenharCampoLargo(
  folha: Folha,
  bloco: CampoLargo,
  contexto: ContextoCertificado,
  x: number,
  topo: number,
  largura: number,
): void {
  const { seminegrito } = folha.fontes;
  escrever(
    folha.pagina,
    truncar(bloco.rotulo.toLocaleUpperCase('pt-BR'), seminegrito, 6.3, largura),
    x,
    topo - 6,
    {
      fonte: seminegrito,
      tamanho: 6.3,
      cor: COR.suave,
      espacamento: 0.55,
    },
  );
  const valor = aplicarMarcadores(bloco.valor, contexto).trim() || '—';
  folha.escrever(
    truncar(valor, seminegrito, 12, largura),
    x,
    topo - 24,
    12,
    seminegrito,
    COR.tinta,
  );
}

function alturaAssinatura(bloco: Assinatura): number {
  return 26 + 14 + bloco.linhas.length * 11.5;
}

/** Linha de assinatura com o nome e as linhas do cargo do responsável. */
function desenharAssinatura(
  folha: Folha,
  bloco: Assinatura,
  contexto: ContextoCertificado,
  x: number,
  topo: number,
  largura: number,
): void {
  const { seminegrito, regular } = folha.fontes;
  let y = topo - 26;
  folha.pagina.drawLine({
    start: { x, y },
    end: { x: x + largura, y },
    thickness: 0.8,
    color: COR.tinta,
  });
  y -= 14;
  folha.escrever(
    truncar(aplicarMarcadores(bloco.nome, contexto), seminegrito, 10.5, largura),
    x,
    y,
    10.5,
    seminegrito,
    COR.tinta,
  );
  for (const linha of bloco.linhas) {
    y -= 11.5;
    folha.escrever(
      truncar(aplicarMarcadores(linha, contexto), regular, 8.5, largura),
      x,
      y,
      8.5,
      regular,
      COR.suave,
    );
  }
}

function desenharBlocos(
  folha: Folha,
  blocos: readonly BlocoCertificado[],
  contexto: ContextoCertificado,
): void {
  for (let i = 0; i < blocos.length; i += 1) {
    const bloco = blocos[i];
    switch (bloco.tipo) {
      case 'campos':
        desenharCampos(folha, bloco.itens, contexto);
        break;
      case 'titulo':
        folha.garantir(40);
        folha.y -= 4;
        for (const linha of quebrarLinhas(
          aplicarMarcadores(bloco.texto, contexto),
          folha.fontes.seminegrito,
          12,
          LARGURA_UTIL,
        )) {
          folha.escrever(linha, X, folha.y - 12, 12, folha.fontes.seminegrito, COR.tinta);
          folha.y -= 16;
        }
        folha.y -= 6;
        break;
      case 'paragrafo':
        folha.paragrafo(aplicarMarcadores(bloco.texto, contexto));
        folha.y -= 6;
        break;
      case 'lista':
        desenharLista(folha, bloco.itens, contexto);
        break;
      case 'nota':
        desenharNota(folha, aplicarMarcadores(bloco.texto, contexto));
        break;
      case 'campoLargo': {
        const seguinte = blocos[i + 1];
        if (seguinte?.tipo === 'assinatura') {
          // Solicitante à esquerda e assinatura do responsável à direita.
          const altura = Math.max(alturaCampoLargo(), alturaAssinatura(seguinte));
          folha.garantir(altura);
          const largura = (LARGURA_UTIL - 40) / 2;
          desenharCampoLargo(folha, bloco, contexto, X, folha.y - 16, largura);
          desenharAssinatura(folha, seguinte, contexto, DIREITA - largura, folha.y, largura);
          folha.y -= altura + 16;
          i += 1;
        } else {
          folha.garantir(alturaCampoLargo());
          desenharCampoLargo(folha, bloco, contexto, X, folha.y, LARGURA_UTIL);
          folha.y -= alturaCampoLargo() + 16;
        }
        break;
      }
      case 'assinatura': {
        const altura = alturaAssinatura(bloco);
        folha.garantir(altura);
        desenharAssinatura(folha, bloco, contexto, X, folha.y, 240);
        folha.y -= altura + 16;
        break;
      }
    }
  }
}

function desenharRodape(doc: PDFDocument, fontes: Fontes, rodape: string): void {
  const paginas = doc.getPages();
  const base = MARGEM.base - 12;
  const estilo: EstiloTexto = { fonte: fontes.regular, tamanho: 7.5, cor: COR.suave };
  paginas.forEach((pagina, i) => {
    pagina.drawLine({
      start: { x: X, y: MARGEM.base },
      end: { x: DIREITA, y: MARGEM.base },
      thickness: 0.75,
      color: COR.linha,
    });
    if (paginas.length > 1) {
      if (rodape)
        escrever(pagina, truncar(rodape, fontes.regular, 7.5, LARGURA_UTIL - 90), X, base, estilo);
      escreverDireita(pagina, `Página ${i + 1} de ${paginas.length}`, DIREITA, base, {
        ...estilo,
        fonte: fontes.seminegrito,
        cor: COR.texto,
      });
    } else if (rodape) {
      const texto = truncar(rodape, fontes.regular, 7.5, LARGURA_UTIL);
      escrever(pagina, texto, (PAGINA.largura - larguraTexto(texto, estilo)) / 2, base, estilo);
    }
  });
}

/**
 * Gera o certificado a partir do template do painel e dos dados da solicitação
 * aprovada. Sem `fontes`, sai em Helvetica com o mesmo leiaute.
 */
export async function gerarCertificado(
  template: TemplateCertificado,
  contexto: ContextoCertificado,
  fontes?: BytesFontes,
): Promise<Blob> {
  const doc = await PDFDocument.create();
  const embutidas = await incorporarFontes(doc, fontes);

  doc.setTitle(`${template.tituloProduto} — ${contexto.numeroCertificado ?? ''}`.trim());
  doc.setSubject(template.tituloProduto);
  doc.setLanguage('pt-BR');
  doc.setCreator('Sistema de Verificação de Montagem de Painéis');
  doc.setProducer('Sistema de Verificação de Montagem de Painéis');
  doc.setCreationDate(new Date());

  const folha = new Folha(doc, embutidas, template, contexto);
  desenharBlocos(folha, template.blocos, contexto);
  desenharRodape(doc, embutidas, template.rodape);

  const bytes = await doc.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}
