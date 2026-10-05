/**
 * Paginação e busca das listas da administração. A lista inteira chegava de
 * uma vez; com centenas de registros, a tela ficava lenta e longa demais.
 */

export interface Pagina {
  pagina: number;
  porPagina: number;
  deslocamento: number;
}

export function lerPagina(consulta: URLSearchParams, padrao = 25, maximo = 100): Pagina {
  const pagina = Math.max(1, Math.floor(Number(consulta.get('pagina')) || 1));
  const pedido = Math.floor(Number(consulta.get('porPagina')) || padrao);
  const porPagina = Math.min(maximo, Math.max(1, pedido));
  return { pagina, porPagina, deslocamento: (pagina - 1) * porPagina };
}

/**
 * Termo de busca para `LIKE ... ESCAPE '\'`: `%` e `_` digitados valem como
 * texto, e não como coringa.
 */
export function padraoBusca(termo: string): string {
  return `%${termo.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
