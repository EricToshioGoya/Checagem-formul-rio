/** Dispara o download de um blob pelo navegador. */
export function baixarBlob(blob: Blob, nomeArquivo: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Alguns navegadores só concluem o download depois do tick seguinte.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
