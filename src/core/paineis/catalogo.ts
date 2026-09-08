import type { CampoCabecalho } from '../forms/tipos';
import { catalogoPaineisSchema, descreverErro } from './schema';
import type { CatalogoPaineis, Painel } from './tipos';

const base = import.meta.env.BASE_URL;

let cache: CatalogoPaineis | null = null;

async function lerJson(caminho: string): Promise<unknown> {
  const resposta = await fetch(`${base}${caminho}`, { cache: 'no-cache' });
  if (!resposta.ok) {
    throw new Error(`Não foi possível ler ${caminho} (HTTP ${resposta.status}).`);
  }
  return resposta.json();
}

export async function carregarCatalogoPaineis(forcar = false): Promise<CatalogoPaineis> {
  if (cache && !forcar) return cache;
  const bruto = await lerJson('paineis/index.json');
  const analise = catalogoPaineisSchema.safeParse(bruto);
  if (!analise.success) {
    throw new Error(`Catálogo de painéis inválido:\n${descreverErro(analise.error)}`);
  }
  cache = analise.data;
  return cache;
}

export async function paineisAtivos(): Promise<Painel[]> {
  return (await carregarCatalogoPaineis()).paineis.filter((p) => p.ativo !== false);
}

export async function obterPainel(id: string): Promise<Painel> {
  const painel = (await carregarCatalogoPaineis()).paineis.find((p) => p.id === id);
  if (!painel) throw new Error(`Tipo de painel "${id}" não consta no catálogo.`);
  return painel;
}

/**
 * Campos da solicitação para um painel: os próprios, quando declarados, ou os
 * campos padrão do catálogo. Nenhum deles é escrito no código das telas.
 */
export async function camposDoPainel(id: string): Promise<CampoCabecalho[]> {
  const catalogo = await carregarCatalogoPaineis();
  const painel = await obterPainel(id);
  return painel.campos ?? catalogo.camposPadrao;
}

export function limparCachePaineis(): void {
  cache = null;
}
