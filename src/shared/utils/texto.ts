/** Remove acentos e caracteres especiais para uso em nome de arquivo. */
export function normalizarParaArquivo(valor: string): string {
  return (
    valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase() || 'SEM-NOME'
  );
}

export function dataIso(data = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`;
}

export function dataBr(valor: number | Date | undefined): string {
  if (valor === undefined) return '—';
  const d = valor instanceof Date ? valor : new Date(valor);
  return d.toLocaleDateString('pt-BR');
}

export function dataHoraBr(valor: number | undefined): string {
  if (valor === undefined) return '—';
  return new Date(valor).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Nome do arquivo exportado:
 * `EMPRESA_PROJETO_TIPO-VERIFICACAO_AAAA-MM-DD`.
 */
export function nomeArquivoExportacao(
  empresa: string,
  projeto: string,
  tipo: string,
  extensao: string,
  data = new Date(),
): string {
  const partes = [
    normalizarParaArquivo(empresa),
    normalizarParaArquivo(projeto),
    normalizarParaArquivo(tipo),
    dataIso(data),
  ];
  return `${partes.join('_')}.${extensao}`;
}

export function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
