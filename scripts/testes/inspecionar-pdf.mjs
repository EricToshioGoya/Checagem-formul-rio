/**
 * Lê um PDF gerado e relata onde o texto foi desenhado.
 *
 * Usa pdfjs-dist, que não é dependência do projeto:
 *   npm i -D pdfjs-dist
 *
 * Uso:
 *   node scripts/testes/inspecionar-pdf.mjs arquivo.pdf
 *   node scripts/testes/inspecionar-pdf.mjs arquivo.pdf --texto
 *   node scripts/testes/inspecionar-pdf.mjs arquivo.pdf --contem trecho.txt
 */
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MARGEM_RODAPE = 44; // linha do rodapé em `core/export/pdf/documento.ts`

const arquivo = process.argv[2];
const modoTexto = process.argv.includes('--texto');
const indiceContem = process.argv.indexOf('--contem');

const doc = await getDocument({
  data: new Uint8Array(readFileSync(arquivo)),
  useSystemFonts: true,
}).promise;

// Início da coluna "Descrição" das tabelas de etapa, em `documento.ts`:
// MARGEM (30) + largura da coluna "Etapa" (42) + 3 de respiro.
const X_DESCRICAO = 75;

let foraDaArea = 0;
let textoCompleto = '';
const amostras = [];
// A coluna Descrição na ordem de leitura: é ela que carrega o registro do
// montador, e lê-la sozinha ignora cabeçalhos e rodapés que entram no meio
// quando a linha continua na página seguinte.
const coluna = [];

for (let i = 1; i <= doc.numPages; i += 1) {
  const pagina = await doc.getPage(i);
  const altura = pagina.getViewport({ scale: 1 }).height;
  for (const item of (await pagina.getTextContent()).items) {
    if (!item.str?.trim()) continue;
    textoCompleto += `${item.str}\n`;
    const [, , , , x, y] = item.transform;
    if (Math.abs(x - X_DESCRICAO) < 2 && item.str.trim() !== 'Descrição') {
      coluna.push({ pagina: i, y, texto: item.str });
    }
    const noRodape = /Página \d+ de|gerado em/.test(item.str);
    if (!noRodape && (y < MARGEM_RODAPE || y > altura)) {
      foraDaArea += 1;
      if (amostras.length < 3) {
        amostras.push({ pagina: i, x: Math.round(x), y: Math.round(y), texto: item.str.slice(0, 50) });
      }
    }
  }
}

const textoDaColuna = coluna
  .sort((a, b) => a.pagina - b.pagina || b.y - a.y)
  .map((c) => c.texto)
  .join(' ');

if (modoTexto) {
  console.log(textoCompleto);
  process.exit(0);
}

/** Espaços e quebras de linha do PDF não são conteúdo — só o texto é. */
const achatar = (t) => t.replace(/\s+/g, ' ').trim();

if (indiceContem > 0) {
  const esperado = achatar(readFileSync(process.argv[indiceContem + 1], 'utf8'));
  const obtido = achatar(textoDaColuna);
  // Onde o texto parou de bater, para o relatório dizer quanto se perdeu.
  let sobreviveu = 0;
  while (sobreviveu < esperado.length && obtido.includes(esperado.slice(0, sobreviveu + 200))) {
    sobreviveu += 200;
  }
  console.log(JSON.stringify({
    paginas: doc.numPages,
    foraDaArea,
    amostras,
    contem: obtido.includes(esperado),
    caracteresEsperados: esperado.length,
    caracteresPresentes: Math.min(sobreviveu, esperado.length),
  }));
} else {
  console.log(JSON.stringify({ paginas: doc.numPages, foraDaArea, amostras }));
}
