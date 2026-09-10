/**
 * Lê um PDF gerado e relata onde o texto foi desenhado.
 * Usa pdfjs-dist, que não é dependência do projeto:
 *   npm i -D pdfjs-dist
 */
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MARGEM_RODAPE = 44;   // linha do rodapé em `core/export/pdf/documento.ts`

const doc = await getDocument({
  data: new Uint8Array(readFileSync(process.argv[2])),
  useSystemFonts: true,
}).promise;

let foraDaArea = 0;
let linhasObservacao = 0;
let textoCompleto = '';
const amostras = [];

for (let i = 1; i <= doc.numPages; i += 1) {
  const pagina = await doc.getPage(i);
  const altura = pagina.getViewport({ scale: 1 }).height;
  for (const item of (await pagina.getTextContent()).items) {
    if (!item.str?.trim()) continue;
    textoCompleto += `${item.str}\n`;
    const [, , , , x, y] = item.transform;
    if (/^Obs\.:|Observação longa registrada/.test(item.str)) linhasObservacao += 1;
    const noRodape = /Página \d+ de|gerado em/.test(item.str);
    if (!noRodape && (y < MARGEM_RODAPE || y > altura)) {
      foraDaArea += 1;
      if (amostras.length < 3) {
        amostras.push({ pagina: i, x: Math.round(x), y: Math.round(y), texto: item.str.slice(0, 50) });
      }
    }
  }
}

if (process.argv.includes('--texto')) {
  console.log(textoCompleto);
  process.exit(0);
}

console.log(JSON.stringify({
  paginas: doc.numPages,
  foraDaArea,
  linhasObservacao,
  linhasEsperadas: 200,
  observacaoCompleta: linhasObservacao >= 200,
  amostras,
}));
