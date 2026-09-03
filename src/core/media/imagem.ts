export const LARGURA_MAXIMA = 1920;
export const ALTURA_MAXIMA = 1080;
export const QUALIDADE_JPEG = 0.75;

export interface ImagemNormalizada {
  blob: Blob;
  mime: string;
  largura: number;
  altura: number;
  tamanho: number;
}

/** Mantém a proporção e cabe a imagem dentro de 1920×1080. */
function calcularDestino(largura: number, altura: number) {
  const fator = Math.min(LARGURA_MAXIMA / largura, ALTURA_MAXIMA / altura, 1);
  return {
    largura: Math.max(1, Math.round(largura * fator)),
    altura: Math.max(1, Math.round(altura * fator)),
  };
}

async function decodificar(arquivo: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // `from-image` aplica a orientação EXIF — fotos de celular saem em pé.
      return await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    } catch {
      // Alguns navegadores antigos não aceitam as opções; cai no fluxo abaixo.
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem.'));
    };
    img.src = url;
  });
}

function dimensoes(fonte: ImageBitmap | HTMLImageElement) {
  return fonte instanceof HTMLImageElement
    ? { largura: fonte.naturalWidth, altura: fonte.naturalHeight }
    : { largura: fonte.width, altura: fonte.height };
}

/**
 * Redimensiona e recodifica em JPEG antes da gravação.
 * Uma foto de celular de 4 MB vira algo em torno de 250 KB, o que mantém
 * a base utilizável com centenas de imagens.
 */
export async function normalizarImagem(arquivo: File | Blob): Promise<ImagemNormalizada> {
  const fonte = await decodificar(arquivo);
  const origem = dimensoes(fonte);
  const destino = calcularDestino(origem.largura, origem.altura);

  const canvas = document.createElement('canvas');
  canvas.width = destino.largura;
  canvas.height = destino.altura;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('O navegador não permitiu processar a imagem.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fonte as CanvasImageSource, 0, 0, destino.largura, destino.altura);
  if ('close' in fonte) fonte.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALIDADE_JPEG),
  );
  if (!blob) throw new Error('Não foi possível converter a imagem.');

  return {
    blob,
    mime: 'image/jpeg',
    largura: destino.largura,
    altura: destino.altura,
    tamanho: blob.size,
  };
}

export function ehImagem(arquivo: File): boolean {
  return arquivo.type.startsWith('image/');
}

export function ehPdf(arquivo: File): boolean {
  return arquivo.type === 'application/pdf' || arquivo.name.toLowerCase().endsWith('.pdf');
}
