/**
 * Tipos de arquivo aceitos como mídia de preenchimento.
 *
 * Fotos tiradas no aparelho são sempre recodificadas em JPEG; PNG só entra
 * por backup. Qualquer outro tipo é recusado, inclusive na importação de
 * projeto, e o conteúdo precisa começar com a assinatura do tipo declarado.
 */
export const MIMES_PERMITIDOS = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type MimePermitido = (typeof MIMES_PERMITIDOS)[number];

/** Limite por arquivo de mídia — anexos PDF não são recomprimidos. */
export const MAX_TAMANHO_MIDIA = 30 * 1024 * 1024;

const ASSINATURAS: Record<MimePermitido, readonly number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
};

export function conferirAssinatura(bytes: Uint8Array, mime: MimePermitido): boolean {
  const assinatura = ASSINATURAS[mime];
  return bytes.length >= assinatura.length && assinatura.every((b, i) => bytes[i] === b);
}

export async function blobTemAssinatura(blob: Blob, mime: MimePermitido): Promise<boolean> {
  const cabecalho = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  return conferirAssinatura(cabecalho, mime);
}
