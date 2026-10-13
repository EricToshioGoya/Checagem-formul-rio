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

/** Duração legível e curta: "2 d 4 h", "3 h 10 min", "45 min". */
export function duracaoCurta(ms: number): string {
  const minutos = Math.floor(ms / 60_000);
  if (minutos < 1) return 'menos de 1 min';
  const d = Math.floor(minutos / 1440);
  const h = Math.floor((minutos % 1440) / 60);
  const m = minutos % 60;
  if (d > 0) return h ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
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

/**
 * Nome de arquivo que ainda não foi usado no mesmo pacote: o repetido ganha
 * `-2`, `-3`… antes da extensão. Registra o nome devolvido em `usados`.
 */
export function nomeSemRepetir(usados: Set<string>, base: string, extensao: string): string {
  let nome = `${base}.${extensao}`;
  for (let n = 2; usados.has(nome.toLowerCase()); n += 1) nome = `${base}-${n}.${extensao}`;
  usados.add(nome.toLowerCase());
  return nome;
}

export function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
