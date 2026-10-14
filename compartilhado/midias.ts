/**
 * Arquivos que o montador anexa numa etapa: foto (JPEG, comprimida no
 * aparelho), PDF de laudo e vídeo. Fica aqui porque o aparelho e o servidor
 * precisam concordar sobre o que é vídeo — a contagem do andamento e a regra
 * de "Vídeo obrigatório" dependem disso dos dois lados.
 */

/** Formatos de vídeo aceitos: o que celulares Android (MP4) e iPhone (MOV) gravam. */
export const MIMES_VIDEO = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

/**
 * 50 MB por vídeo: um a dois minutos gravados no celular. O vídeo vai como
 * foi gravado, sem recompressão, e é guardado no aparelho e no servidor.
 */
export const TAMANHO_MAXIMO_VIDEO = 50 * 1024 * 1024;

export function ehMimeDeVideo(mime: string): boolean {
  return mime.startsWith('video/');
}

/** Extensão do arquivo exportado (ZIP de fotos, backup) para cada tipo gravado. */
export function extensaoDoMime(mime: string): string {
  switch (mime) {
    case 'application/pdf':
      return 'pdf';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'video/quicktime':
      return 'mov';
    default:
      return 'jpg';
  }
}
