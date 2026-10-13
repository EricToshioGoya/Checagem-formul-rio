import { api, type PainelApi } from '../api/cliente';
import { guardarCatalogoPaineis, lerCatalogoPaineis } from '../api/acessoLocal';
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

/** Campos padrão da solicitação de certificação (dado de publicação). */
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

/** Painel do servidor no formato das telas de certificação. */
export function painelDeApi(p: Pick<PainelApi, 'slug' | 'nome' | 'descricao' | 'fluxo' | 'certificado' | 'signatario'>): Painel {
  return {
    id: p.slug,
    nome: p.nome,
    descricao: p.descricao ?? '',
    fluxo: p.fluxo,
    certificado: p.certificado ?? undefined,
    responsavel: p.signatario ?? undefined,
  };
}

/**
 * Painel pelo `slug`. A fonte é o servidor (`/api/paineis`); a cópia do aparelho
 * serve quando não há rede, para a certificação abrir offline como o resto.
 */
export async function entradaDoPainel(slug: string): Promise<Painel | null> {
  const guardado = lerCatalogoPaineis()[slug];
  if (guardado) return painelDeApi(guardado);
  try {
    const { paineis } = await api.get<{ paineis: PainelApi[] }>('/api/paineis');
    guardarCatalogoPaineis(paineis);
    const p = paineis.find((x) => x.slug === slug);
    return p ? painelDeApi(p) : null;
  } catch {
    return null;
  }
}

export async function obterPainel(slug: string): Promise<Painel> {
  const painel = await entradaDoPainel(slug);
  if (!painel) throw new Error(`O painel "${slug}" não está disponível neste aparelho.`);
  return painel;
}

/**
 * Fluxo de um painel do servidor. Sem a cópia do painel e sem rede vale a
 * verificação, que é o comportamento de todo painel comum.
 */
export async function fluxoDoPainel(slug: string | undefined): Promise<FluxoPainel> {
  if (!slug) return 'verificacao';
  return (await entradaDoPainel(slug))?.fluxo ?? 'verificacao';
}

/** Campos da solicitação para um painel: os padrão do catálogo de publicação. */
export async function camposDoPainel(_slug: string): Promise<CampoCabecalho[]> {
  return (await carregarCatalogoPaineis()).camposPadrao;
}

export function limparCachePaineis(): void {
  cache = null;
}
