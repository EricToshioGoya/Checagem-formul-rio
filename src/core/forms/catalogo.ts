import { FormularioRepository } from '../db/repositorios';
import { obterPainel } from '../paineis/catalogo';
import { catalogoSchema, definicaoFormularioSchema, descreverErro } from './schema';
import type { Catalogo, DefinicaoFormulario, EntradaCatalogo } from './tipos';

const base = import.meta.env.BASE_URL;

let catalogoCache: Catalogo | null = null;
const formularioCache = new Map<string, DefinicaoFormulario>();

async function lerJson(caminho: string): Promise<unknown> {
  const resposta = await fetch(`${base}${caminho}`, { cache: 'no-cache' });
  if (!resposta.ok) {
    throw new Error(`Não foi possível ler ${caminho} (HTTP ${resposta.status}).`);
  }
  return resposta.json();
}

export async function carregarCatalogo(forcar = false): Promise<Catalogo> {
  if (catalogoCache && !forcar) return catalogoCache;
  const bruto = await lerJson('forms/index.json');
  const analise = catalogoSchema.safeParse(bruto);
  if (!analise.success) {
    throw new Error(`Catálogo de formulários inválido:\n${descreverErro(analise.error)}`);
  }
  catalogoCache = analise.data;
  return catalogoCache;
}

export function validarDefinicao(bruto: unknown): DefinicaoFormulario {
  const analise = definicaoFormularioSchema.safeParse(bruto);
  if (!analise.success) {
    throw new Error(descreverErro(analise.error));
  }
  return analise.data;
}

/**
 * Carrega uma definição. A versão editada na aba de administração, quando
 * existe, tem precedência sobre o arquivo em `/public/forms`.
 */
export async function carregarFormulario(
  id: string,
  forcar = false,
): Promise<DefinicaoFormulario> {
  if (!forcar && formularioCache.has(id)) return formularioCache.get(id)!;

  const customizado = await FormularioRepository.obter(id);
  if (customizado) {
    try {
      const definicao = validarDefinicao(customizado.definicao);
      formularioCache.set(id, definicao);
      return definicao;
    } catch (erro) {
      // Customização corrompida não pode derrubar o preenchimento:
      // registra e volta ao arquivo original.
      console.error(`Formulário customizado "${id}" inválido; usando o original.`, erro);
    }
  }

  const catalogo = await carregarCatalogo();
  const entrada = catalogo.formularios.find((f) => f.id === id);
  if (!entrada) throw new Error(`Formulário "${id}" não consta no catálogo.`);
  const definicao = validarDefinicao(await lerJson(`forms/${entrada.arquivo}`));
  formularioCache.set(id, definicao);
  return definicao;
}

/** Lê o arquivo original ignorando a customização (usado para restaurar). */
export async function carregarFormularioOriginal(
  id: string,
): Promise<DefinicaoFormulario> {
  const catalogo = await carregarCatalogo();
  const entrada = catalogo.formularios.find((f) => f.id === id);
  if (!entrada) throw new Error(`Formulário "${id}" não consta no catálogo.`);
  return validarDefinicao(await lerJson(`forms/${entrada.arquivo}`));
}

export function limparCacheFormulario(id?: string): void {
  if (id) formularioCache.delete(id);
  else formularioCache.clear();
}

export async function formulariosAtivos(): Promise<EntradaCatalogo[]> {
  const catalogo = await carregarCatalogo();
  return catalogo.formularios.filter((f) => f.ativo !== false);
}

/**
 * Formulários de um tipo de painel, na ordem declarada no catálogo de painéis.
 * É por aqui que o SEN Plus continua vendo só os seus dois checklists depois da
 * entrada dos demais painéis.
 */
export async function formulariosDoPainel(
  painelId: string,
): Promise<EntradaCatalogo[]> {
  const [catalogo, painel] = await Promise.all([carregarCatalogo(), obterPainel(painelId)]);
  return painel.formularios
    .map((id) => catalogo.formularios.find((f) => f.id === id))
    .filter((f): f is EntradaCatalogo => !!f && f.ativo !== false);
}
