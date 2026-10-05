import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { LOGO_ABB } from '../src/shared/marca/logoAbb';

/**
 * Gera os ícones PNG do aplicativo instalado a partir do vetor do logotipo:
 *
 *   npm run icones
 *
 * Sem dependência de imagem: o logotipo é rasterizado aqui mesmo (preenchimento
 * por linha de varredura, com 4 sub-linhas por pixel para suavizar a borda) e
 * gravado como PNG com o `zlib` do Node. Os caminhos usam só M, L, C e Z.
 */

type Ponto = [number, number];

const VERMELHO = [255, 0, 15];
const SUB_LINHAS = 4;

/** Converte um caminho SVG em polígono, aproximando cada curva por retas. */
function achatar(d: string): Ponto[] {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+/g) ?? [];
  const pontos: Ponto[] = [];
  let i = 0;
  let comando = '';
  const numero = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLCZ]/.test(tokens[i])) comando = tokens[i++];
    if (comando === 'Z') break;
    if (comando === 'M' || comando === 'L') {
      pontos.push([numero(), numero()]);
    } else if (comando === 'C') {
      const [x0, y0] = pontos[pontos.length - 1];
      const c1: Ponto = [numero(), numero()];
      const c2: Ponto = [numero(), numero()];
      const fim: Ponto = [numero(), numero()];
      for (let k = 1; k <= 24; k++) {
        const t = k / 24;
        const u = 1 - t;
        pontos.push([
          u ** 3 * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * fim[0],
          u ** 3 * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * fim[1],
        ]);
      }
    }
  }
  return pontos;
}

function rasterizar(tamanho: number, proporcao: number): Buffer {
  const escala = (tamanho * proporcao) / LOGO_ABB.largura;
  const dx = (tamanho - LOGO_ABB.largura * escala) / 2;
  const dy = (tamanho - LOGO_ABB.altura * escala) / 2;

  // Arestas de todos os blocos, já em pixels. Os blocos não se sobrepõem,
  // então a regra par-ímpar sobre todas as arestas juntas basta.
  const arestas: Array<[number, number, number, number]> = [];
  for (const d of LOGO_ABB.caminhos) {
    const p = achatar(d).map(([x, y]): Ponto => [dx + x * escala, dy + y * escala]);
    for (let k = 0; k < p.length; k++) {
      const [x0, y0] = p[k];
      const [x1, y1] = p[(k + 1) % p.length];
      if (y0 !== y1) arestas.push([x0, y0, x1, y1]);
    }
  }

  const cobertura = new Float32Array(tamanho * tamanho);
  for (let py = 0; py < tamanho; py++) {
    for (let s = 0; s < SUB_LINHAS; s++) {
      const y = py + (s + 0.5) / SUB_LINHAS;
      const xs: number[] = [];
      for (const [x0, y0, x1, y1] of arestas) {
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, xs[k]);
        const b = Math.min(tamanho, xs[k + 1]);
        for (let x = Math.floor(a); x < b; x++) {
          cobertura[py * tamanho + x] += (Math.min(b, x + 1) - Math.max(a, x)) / SUB_LINHAS;
        }
      }
    }
  }

  // Linhas RGBA com o byte de filtro 0 na frente de cada uma.
  const bruto = Buffer.alloc((tamanho * 4 + 1) * tamanho);
  for (let py = 0; py < tamanho; py++) {
    const linha = py * (tamanho * 4 + 1);
    for (let x = 0; x < tamanho; x++) {
      const c = Math.min(1, cobertura[py * tamanho + x]);
      const o = linha + 1 + x * 4;
      for (let canal = 0; canal < 3; canal++) {
        bruto[o + canal] = Math.round(255 * (1 - c) + VERMELHO[canal] * c);
      }
      bruto[o + 3] = 255;
    }
  }
  return png(tamanho, bruto);
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(dados: Buffer): number {
  let c = 0xffffffff;
  for (const b of dados) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo: string, dados: Buffer): Buffer {
  const cabecalho = Buffer.alloc(4);
  cabecalho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([cabecalho, corpo, crc]);
}

function png(tamanho: number, bruto: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tamanho, 0);
  ihdr.writeUInt32BE(tamanho, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateSync(bruto, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

// O ícone "maskable" é recortado em círculo pelo Android: o logotipo fica
// menor, dentro da zona segura central.
const ICONES: Array<[arquivo: string, tamanho: number, proporcao: number]> = [
  ['icon-192.png', 192, 0.72],
  ['icon-512.png', 512, 0.72],
  ['icon-512-maskable.png', 512, 0.58],
  ['apple-touch-icon.png', 180, 0.7],
];

for (const [arquivo, tamanho, proporcao] of ICONES) {
  const caminho = `public/icons/${arquivo}`;
  writeFileSync(caminho, rasterizar(tamanho, proporcao));
  console.log(`${caminho} (${tamanho}×${tamanho})`);
}
