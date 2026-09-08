import { catalogoPaineisSchema } from './schema';
import { descreverErro } from '../forms/schema';
import type { CatalogoPaineis, Painel } from './tipos';

const base = import.meta.env.BASE_URL;

let cache: CatalogoPaineis | null = null;

/** Lê `/public/paineis.json`. O arquivo entra no precache: funciona offline. */
export async function carregarPaineis(forcar = false): Promise<CatalogoPaineis> {
  if (cache && !forcar) return cache;
  const resposta = await fetch(`${base}paineis.json`, { cache: 'no-cache' });
  if (!resposta.ok) {
    throw new Error(`Não foi possível ler paineis.json (HTTP ${resposta.status}).`);
  }
  const analise = catalogoPaineisSchema.safeParse(await resposta.json());
  if (!analise.success) {
    throw new Error(`Catálogo de painéis inválido:\n${descreverErro(analise.error)}`);
  }
  cache = analise.data;
  return cache;
}

export async function listarPaineisAtivos(): Promise<Painel[]> {
  return (await carregarPaineis()).paineis.filter((p) => p.ativo);
}

export async function obterPainel(id: string): Promise<Painel | undefined> {
  return (await carregarPaineis()).paineis.find((p) => p.id === id);
}

/** Base absoluta usada no link de aprovação enviado ao responsável. */
export function enderecoAplicacao(catalogo: CatalogoPaineis): string {
  const configurado = catalogo.urlAplicacao?.trim();
  if (configurado) return configurado.replace(/\/+$/, '') + '/';
  return `${window.location.origin}${base}`;
}
