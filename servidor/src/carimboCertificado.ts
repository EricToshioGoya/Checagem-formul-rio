import {
  PDFDocument,
  StandardFonts,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
} from 'pdf-lib';

/**
 * Carimbo do certificado: em todas as páginas do modelo, uma faixa no rodapé
 * com o código único, a data de emissão, quem aprovou e a identificação do
 * painel. O código vai também nos metadados do arquivo. Sem banco nem disco:
 * recebe o modelo e devolve o certificado.
 */

export interface DadosCarimbo {
  codigo: string;
  emitidoEm: number;
  aprovadoPor: string;
  empresa: string;
  projeto: string;
  tag: string;
  painel: string;
  checklist: string;
  montador: string;
}

/** Texto que a fonte padrão do PDF consegue escrever (Latin-1 e pontuação comum). */
function paraFonte(texto: string): string {
  return texto.normalize('NFC').replace(/[^\x20-\x7e\xa0-\xff—–‘’“”•…€]/g, '?');
}

/** Corta o texto com reticências para caber na largura. */
function caber(texto: string, fonte: PDFFont, tamanho: number, largura: number): string {
  let t = paraFonte(texto);
  if (fonte.widthOfTextAtSize(t, tamanho) <= largura) return t;
  while (t.length > 1 && fonte.widthOfTextAtSize(`${t}…`, tamanho) > largura) t = t.slice(0, -1);
  return `${t}…`;
}

function dataHora(em: number): string {
  const formato = (timeZone: string) =>
    new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(em));
  try {
    return formato(process.env.TZ || 'America/Sao_Paulo');
  } catch {
    // TZ no formato POSIX (ex.: ':/etc/localtime'), que o Intl não aceita.
    return formato('America/Sao_Paulo');
  }
}

/**
 * Leva as coordenadas da página como o leitor a mostra (origem no canto
 * inferior esquerdo visível) às da página sem a rotação (/Rotate): a faixa sai
 * no rodapé visível também no modelo em paisagem gravado como retrato girado.
 */
function matrizVisivel(
  rotacao: number,
  c: { x: number; y: number; width: number; height: number },
): [number, number, number, number, number, number] {
  if (rotacao === 90) return [0, 1, -1, 0, c.x + c.width, c.y];
  if (rotacao === 180) return [-1, 0, 0, -1, c.x + c.width, c.y + c.height];
  if (rotacao === 270) return [0, -1, 1, 0, c.x, c.y + c.height];
  return [1, 0, 0, 1, c.x, c.y];
}

export async function carimbarCertificado(modelo: Uint8Array, d: DadosCarimbo): Promise<Buffer> {
  const documento = await PDFDocument.load(modelo);
  const normal = await documento.embedFont(StandardFonts.Helvetica);
  const negrito = await documento.embedFont(StandardFonts.HelveticaBold);
  const paginas = documento.getPages();
  const linha2 = `Emitido em ${dataHora(d.emitidoEm)} · Aprovado por ${d.aprovadoPor} · ${d.checklist}`;
  const linha3 = [
    d.empresa && `Empresa ${d.empresa}`,
    d.projeto && `Projeto ${d.projeto}`,
    d.tag && `TAG ${d.tag}`,
    d.painel,
    d.montador && `Montador ${d.montador}`,
  ]
    .filter(Boolean)
    .join(' · ');

  paginas.forEach((pagina, i) => {
    const caixa = pagina.getCropBox();
    const rotacao = ((pagina.getRotation().angle % 360) + 360) % 360;
    const larguraVisivel = rotacao === 90 || rotacao === 270 ? caixa.height : caixa.width;
    pagina.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrizVisivel(rotacao, caixa)));
    const margem = Math.min(18, larguraVisivel * 0.03);
    const altura = 40;
    const largura = larguraVisivel - margem * 2;
    const x = margem;
    const y = margem;
    const util = largura - 16;
    pagina.drawRectangle({
      x,
      y,
      width: largura,
      height: altura,
      color: rgb(1, 1, 1),
      opacity: 0.94,
      borderColor: rgb(0.86, 0, 0.06),
      borderWidth: 0.8,
    });
    const rotuloPagina = paraFonte(`Página ${i + 1} de ${paginas.length}`);
    const larguraPagina = normal.widthOfTextAtSize(rotuloPagina, 7);
    pagina.drawText(caber(`Certificado nº ${d.codigo}`, negrito, 11, util - larguraPagina - 8), {
      x: x + 8,
      y: y + altura - 14,
      size: 11,
      font: negrito,
      color: rgb(0, 0, 0),
    });
    pagina.drawText(rotuloPagina, {
      x: x + largura - 8 - larguraPagina,
      y: y + altura - 13,
      size: 7,
      font: normal,
      color: rgb(0.35, 0.35, 0.35),
    });
    pagina.drawText(caber(linha2, normal, 7.5, util), { x: x + 8, y: y + 15, size: 7.5, font: normal, color: rgb(0.1, 0.1, 0.1) });
    pagina.drawText(caber(linha3, normal, 7.5, util), { x: x + 8, y: y + 6, size: 7.5, font: normal, color: rgb(0.1, 0.1, 0.1) });
    pagina.pushOperators(popGraphicsState());
  });

  documento.setTitle(`Certificado ${d.codigo}`);
  documento.setSubject(`${d.checklist} — TAG ${d.tag}`);
  documento.setKeywords([d.codigo, d.tag, d.projeto].filter(Boolean));
  documento.setProducer('Verificação de Montagem de Painéis');
  documento.setCreationDate(new Date(d.emitidoEm));
  documento.setModificationDate(new Date(d.emitidoEm));
  return Buffer.from(await documento.save({ useObjectStreams: false }));
}
