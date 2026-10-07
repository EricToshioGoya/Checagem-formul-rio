import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { quebrarLinhas, sanitizar, truncar } from '../export/pdf/texto';
import { aplicarMarcadores } from './contexto';
import type { BlocoCertificado, ContextoCertificado, TemplateCertificado } from './tipos';

const PAGINA = { largura: 595.28, altura: 841.89 };
const MARGEM = 46;
const LARGURA_UTIL = PAGINA.largura - MARGEM * 2;

const VERMELHO = rgb(1, 0, 0.06);
const PRETO = rgb(0.12, 0.12, 0.12);
const CINZA = rgb(0.42, 0.42, 0.42);
const CINZA_CLARO = rgb(0.85, 0.85, 0.85);

interface Fontes {
  normal: PDFFont;
  negrito: PDFFont;
}

/**
 * Folha do certificado. Mais simples que a do dossiê: uma coluna de texto
 * corrido, sem tabelas de etapas.
 */
class Folha {
  doc: PDFDocument;
  fontes: Fontes;
  pagina!: PDFPage;
  y = 0;

  constructor(
    doc: PDFDocument,
    fontes: Fontes,
    private readonly template: TemplateCertificado,
    private readonly contexto: ContextoCertificado,
  ) {
    this.doc = doc;
    this.fontes = fontes;
    this.novaPagina();
  }

  novaPagina(): void {
    this.pagina = this.doc.addPage([PAGINA.largura, PAGINA.altura]);
    this.y = PAGINA.altura - MARGEM;
    this.desenharTopo();
  }

  /** Marca, número do certificado e título do produto. */
  private desenharTopo(): void {
    this.pagina.drawText('ABB', {
      x: MARGEM,
      y: this.y - 20,
      size: 24,
      font: this.fontes.negrito,
      color: VERMELHO,
    });

    const numero = aplicarMarcadores(this.template.numero, this.contexto);
    const larguraNumero = this.fontes.negrito.widthOfTextAtSize(sanitizar(numero), 14);
    this.pagina.drawText(sanitizar(numero), {
      x: PAGINA.largura - MARGEM - larguraNumero,
      y: this.y - 18,
      size: 14,
      font: this.fontes.negrito,
      color: PRETO,
    });

    this.y -= 30;
    this.pagina.drawText(
      truncar(this.template.tituloProduto, this.fontes.negrito, 15, LARGURA_UTIL),
      { x: MARGEM, y: this.y - 15, size: 15, font: this.fontes.negrito, color: PRETO },
    );
    this.y -= 22;

    this.pagina.drawLine({
      start: { x: MARGEM, y: this.y },
      end: { x: PAGINA.largura - MARGEM, y: this.y },
      thickness: 1.2,
      color: VERMELHO,
    });
    this.y -= 16;
  }

  espaco(altura: number): void {
    if (this.y - altura < MARGEM + 26) this.novaPagina();
  }

  paragrafo(
    valor: string,
    opcoes: { tamanho?: number; negrito?: boolean; cor?: typeof PRETO; recuo?: number } = {},
  ): void {
    const tamanho = opcoes.tamanho ?? 10;
    const recuo = opcoes.recuo ?? 0;
    const fonte = opcoes.negrito ? this.fontes.negrito : this.fontes.normal;
    for (const linha of quebrarLinhas(valor, fonte, tamanho, LARGURA_UTIL - recuo)) {
      this.espaco(tamanho + 4);
      this.pagina.drawText(linha, {
        x: MARGEM + recuo,
        y: this.y - tamanho,
        size: tamanho,
        font: fonte,
        color: opcoes.cor ?? PRETO,
      });
      this.y -= tamanho + 2.5;
    }
  }
}

function desenharCampos(
  folha: Folha,
  itens: { rotulo: string; valor: string }[],
  contexto: ContextoCertificado,
): void {
  const larguraRotulo = 170;
  const alturaLinha = 16;
  for (const item of itens) {
    folha.espaco(alturaLinha);
    folha.pagina.drawText(
      truncar(`${item.rotulo}:`, folha.fontes.negrito, 10, larguraRotulo - 6),
      {
        x: MARGEM,
        y: folha.y - alturaLinha + 5,
        size: 10,
        font: folha.fontes.negrito,
        color: PRETO,
      },
    );
    const valor = aplicarMarcadores(item.valor, contexto).trim();
    folha.pagina.drawText(
      truncar(valor || '—', folha.fontes.normal, 10, LARGURA_UTIL - larguraRotulo),
      {
        x: MARGEM + larguraRotulo,
        y: folha.y - alturaLinha + 5,
        size: 10,
        font: folha.fontes.normal,
        color: PRETO,
      },
    );
    folha.y -= alturaLinha;
  }
  folha.y -= 8;
}

function desenharAssinatura(
  folha: Folha,
  bloco: Extract<BlocoCertificado, { tipo: 'assinatura' }>,
  contexto: ContextoCertificado,
): void {
  const largura = 240;
  folha.espaco(24 + bloco.linhas.length * 12 + 20);
  folha.y -= 20;
  folha.pagina.drawLine({
    start: { x: MARGEM, y: folha.y },
    end: { x: MARGEM + largura, y: folha.y },
    thickness: 0.8,
    color: PRETO,
  });
  folha.y -= 14;
  folha.pagina.drawText(
    truncar(aplicarMarcadores(bloco.nome, contexto), folha.fontes.negrito, 10.5, largura),
    { x: MARGEM, y: folha.y, size: 10.5, font: folha.fontes.negrito, color: PRETO },
  );
  folha.y -= 13;
  for (const linha of bloco.linhas) {
    folha.pagina.drawText(
      truncar(aplicarMarcadores(linha, contexto), folha.fontes.normal, 9.5, largura),
      { x: MARGEM, y: folha.y, size: 9.5, font: folha.fontes.normal, color: CINZA },
    );
    folha.y -= 12;
  }
}

function desenharBloco(
  folha: Folha,
  bloco: BlocoCertificado,
  contexto: ContextoCertificado,
): void {
  switch (bloco.tipo) {
    case 'campos':
      desenharCampos(folha, bloco.itens, contexto);
      break;
    case 'titulo':
      folha.y -= 4;
      folha.paragrafo(aplicarMarcadores(bloco.texto, contexto), {
        tamanho: 12,
        negrito: true,
      });
      folha.y -= 4;
      break;
    case 'paragrafo':
      folha.paragrafo(aplicarMarcadores(bloco.texto, contexto));
      folha.y -= 6;
      break;
    case 'lista':
      for (const item of bloco.itens) {
        folha.paragrafo(`• ${aplicarMarcadores(item, contexto)}`, { recuo: 14 });
      }
      folha.y -= 6;
      break;
    case 'nota':
      folha.paragrafo(aplicarMarcadores(bloco.texto, contexto), { cor: CINZA });
      folha.y -= 6;
      break;
    case 'campoLargo': {
      folha.y -= 4;
      folha.paragrafo(bloco.rotulo, { tamanho: 9.5, negrito: true, cor: CINZA });
      folha.paragrafo(aplicarMarcadores(bloco.valor, contexto).trim() || '—', {
        tamanho: 11,
        negrito: true,
      });
      folha.y -= 4;
      break;
    }
    case 'assinatura':
      desenharAssinatura(folha, bloco, contexto);
      break;
  }
}

function desenharRodape(doc: PDFDocument, fonte: PDFFont, rodape: string): void {
  if (!rodape) return;
  const texto = sanitizar(rodape);
  for (const pagina of doc.getPages()) {
    pagina.drawLine({
      start: { x: MARGEM, y: MARGEM - 8 },
      end: { x: PAGINA.largura - MARGEM, y: MARGEM - 8 },
      thickness: 0.7,
      color: CINZA_CLARO,
    });
    const largura = fonte.widthOfTextAtSize(texto, 8);
    pagina.drawText(texto, {
      x: (PAGINA.largura - largura) / 2,
      y: MARGEM - 20,
      size: 8,
      font: fonte,
      color: CINZA,
    });
  }
}

/**
 * Gera o certificado a partir do template do painel e dos dados da solicitação
 * aprovada. Nenhum texto do corpo vive neste arquivo — tudo vem do JSON.
 */
export async function gerarCertificado(
  template: TemplateCertificado,
  contexto: ContextoCertificado,
): Promise<Blob> {
  const doc = await PDFDocument.create();
  const fontes: Fontes = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrito: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  doc.setTitle(`${template.tituloProduto} — ${contexto.numeroCertificado ?? ''}`.trim());
  doc.setProducer('Sistema de Verificação de Montagem de Painéis');
  doc.setCreationDate(new Date());

  const folha = new Folha(doc, fontes, template, contexto);
  for (const bloco of template.blocos) desenharBloco(folha, bloco, contexto);

  desenharRodape(doc, fontes.normal, template.rodape);

  const bytes = await doc.save();
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' });
}
