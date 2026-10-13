import { StandardFonts, rgb, type PDFDocument, type PDFFont, type RGB } from 'pdf-lib';

function hex(valor: string): RGB {
  const n = Number.parseInt(valor.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Paleta do documento: vermelho ABB como acento, neutros frios para o resto. */
export const COR = {
  marca: hex('#FF000F'),
  marcaEscura: hex('#D1000C'),
  tinta: hex('#111827'),
  texto: hex('#374151'),
  suave: hex('#6B7280'),
  apagado: hex('#9CA3AF'),
  linha: hex('#E5E7EB'),
  linhaSuave: hex('#EEF0F2'),
  superficie: hex('#F6F7F9'),
  superficieForte: hex('#ECEEF1'),
  zebra: hex('#FAFAFB'),
  branco: rgb(1, 1, 1),
  sucesso: hex('#146C3B'),
  sucessoFundo: hex('#E7F6EC'),
  sucessoPonto: hex('#22A85A'),
  pendente: hex('#9A4A06'),
  pendenteFundo: hex('#FEF3E2'),
  pendentePonto: hex('#F59E0B'),
  pendenteLinha: hex('#FFFBF5'),
  erro: hex('#B42318'),
  erroFundo: hex('#FDECEA'),
  erroPonto: hex('#E5484D'),
  erroLinha: hex('#FFF8F7'),
} as const;

export const PAGINA = { largura: 595.28, altura: 841.89 };
export const MARGEM = { x: 40, topo: 36, base: 40 };
export const LARGURA_UTIL = PAGINA.largura - MARGEM.x * 2;
export const DIREITA = MARGEM.x + LARGURA_UTIL;
/** Topo da área de conteúdo, abaixo do cabeçalho de página. */
export const TOPO_CONTEUDO = PAGINA.altura - 84;
/** Limite inferior da área de conteúdo, acima do rodapé. */
export const BASE_CONTEUDO = MARGEM.base + 30;

export interface Fontes {
  regular: PDFFont;
  medio: PDFFont;
  seminegrito: PDFFont;
  negrito: PDFFont;
  italico: PDFFont;
}

/** Arquivos TTF da família tipográfica do documento. */
export interface BytesFontes {
  regular: Uint8Array;
  medio: Uint8Array;
  seminegrito: Uint8Array;
  negrito: Uint8Array;
  italico: Uint8Array;
}

/**
 * Incorpora a Inter (subconjunto Latin). Se os arquivos não vierem ou falharem,
 * o documento sai em Helvetica, com o mesmo leiaute.
 */
export async function incorporarFontes(doc: PDFDocument, bytes?: BytesFontes): Promise<Fontes> {
  if (bytes) {
    try {
      const { default: fontkit } = await import('@pdf-lib/fontkit');
      doc.registerFontkit(fontkit);
      const opcoes = { subset: true };
      const [regular, medio, seminegrito, negrito, italico] = await Promise.all([
        doc.embedFont(bytes.regular, opcoes),
        doc.embedFont(bytes.medio, opcoes),
        doc.embedFont(bytes.seminegrito, opcoes),
        doc.embedFont(bytes.negrito, opcoes),
        doc.embedFont(bytes.italico, opcoes),
      ]);
      return { regular, medio, seminegrito, negrito, italico };
    } catch {
      // Segue para as fontes padrão.
    }
  }
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const italico = await doc.embedFont(StandardFonts.HelveticaOblique);
  return { regular, medio: regular, seminegrito: negrito, negrito, italico };
}
