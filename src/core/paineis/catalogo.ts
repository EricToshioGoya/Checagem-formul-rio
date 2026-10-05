import type { CampoCabecalho } from '../forms/tipos';
import { catalogoPaineisSchema, descreverErro } from './schema';
import type { CatalogoPaineis, FluxoPainel, Painel } from './tipos';

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

/** Entrada do catálogo para o `slug`, ou `null` quando o painel não tem uma. */
export async function entradaDoPainel(slug: string): Promise<Painel | null> {
  const catalogo = await carregarCatalogoPaineis();
  return catalogo.paineis.find((p) => p.id === slug && p.ativo !== false) ?? null;
}

export async function obterPainel(slug: string): Promise<Painel> {
  const painel = await entradaDoPainel(slug);
  if (!painel) throw new Error(`O painel "${slug}" não consta no catálogo de fluxos.`);
  return painel;
}

/**
 * Fluxo de um painel do servidor. Sem entrada no catálogo — ou sem o catálogo,
 * por falta de rede na primeira abertura — vale a verificação, que é o
 * comportamento de todo painel cadastrado na administração.
 */
export async function fluxoDoPainel(slug: string | undefined): Promise<FluxoPainel> {
  if (!slug) return 'verificacao';
  try {
    return (await entradaDoPainel(slug))?.fluxo ?? 'verificacao';
  } catch {
    return 'verificacao';
  }
}

/**
 * Campos da solicitação para um painel: os próprios, quando declarados, ou os
 * campos padrão do catálogo. Nenhum deles é escrito no código das telas.
 */
export async function camposDoPainel(slug: string): Promise<CampoCabecalho[]> {
  const catalogo = await carregarCatalogoPaineis();
  const painel = await obterPainel(slug);
  return painel.campos ?? catalogo.camposPadrao;
}

export function limparCachePaineis(): void {
  cache = null;
}
