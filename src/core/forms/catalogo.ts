import { validarDefinicao } from '../../../compartilhado/formulario';
import { api } from '../api/cliente';
import { baixarImagensDoChecklist } from '../media/apoio';
import { FormularioRepository } from '../db/repositorios';
import type { FormularioCache } from '../db/tipos';
import type { DefinicaoFormulario, EntradaCatalogo } from './tipos';

export { validarDefinicao };

/**
 * Acesso aos checklists no aparelho do montador.
 *
 * A fonte da verdade é o servidor, onde a administração monta o checklist de
 * cada painel. Aqui a leitura é sempre da cópia local: dentro do galpão não
 * há rede, e um preenchimento que dependesse de rede para abrir o formulário
 * simplesmente não abriria. A cópia é renovada por `sincronizarPainel`, nos
 * momentos em que há conexão.
 */

/** Como o servidor entrega o checklist: a entrada de lista mais a definição. */
interface FormularioDoServidor extends EntradaCatalogo {
  definicao: unknown;
}

/** Memória de processo, para não reler o IndexedDB a cada etapa do PDF. */
const memoria = new Map<string, DefinicaoFormulario>();

function paraEntrada(f: FormularioCache): EntradaCatalogo {
  return {
    id: f.id,
    nome: f.nome,
    tipo: f.tipo,
    linhaProduto: f.linhaProduto,
    painelSlug: f.painelSlug,
    ativo: f.ativo,
    etapas: f.etapas,
    atualizadoEm: f.atualizadoEm,
  };
}

/**
 * Baixa os checklists de um painel e substitui a cópia local.
 *
 * Exige acesso aprovado ao painel — é o servidor quem decide. Um 403 aqui não
 * é falha: significa que o montador ainda não foi aprovado, e a tela já trata
 * esse caso mostrando o pedido pendente.
 */
export async function sincronizarPainel(
  painelId: number,
  painelSlug: string,
): Promise<EntradaCatalogo[]> {
  const { formularios } = await api.get<{ formularios: FormularioDoServidor[] }>(
    `/api/paineis/${painelId}/formularios`,
  );

  const agora = Date.now();
  const cache: FormularioCache[] = formularios.map((f) => ({
    id: f.id,
    painelSlug,
    nome: f.nome,
    tipo: f.tipo,
    linhaProduto: f.linhaProduto,
    ativo: f.ativo !== false,
    etapas: f.etapas ?? 0,
    atualizadoEm: f.atualizadoEm ?? agora,
    // Revalida o que veio da rede: um checklist corrompido tem de falhar aqui,
    // e não na tela de preenchimento com o montador na frente do painel.
    definicao: validarDefinicao(f.definicao),
    sincronizadoEm: agora,
  }));

  await FormularioRepository.substituirPainel(painelSlug, cache);
  for (const f of cache) memoria.set(f.id, f.definicao);
  // As imagens de apoio vêm junto, enquanto há rede; sem esperar por elas.
  for (const f of cache) void baixarImagensDoChecklist(f.definicao);
  return cache.map(paraEntrada);
}

/**
 * Sincroniza os painéis que o montador pode preencher, sem deixar que a falha
 * de um derrube os outros: sem rede, a tela segue com o que já está guardado.
 */
export async function sincronizarPaineis(
  paineis: readonly { id: number; slug: string; podePreencher: boolean }[],
): Promise<void> {
  await Promise.all(
    paineis
      .filter((p) => p.podePreencher)
      .map((p) =>
        sincronizarPainel(p.id, p.slug).catch(() => {
          // Offline ou acesso revogado: a cópia local continua valendo.
        }),
      ),
  );
}

/**
 * Checklists do painel indicado. Um painel sem checklist cadastrado devolve
 * lista vazia, e a tela mostra o aviso em vez de oferecer o formulário de
 * outra linha — as etapas de um SEN Plus não valem para um MNS.
 */
export async function formulariosDoPainel(
  painelSlug: string | undefined,
): Promise<EntradaCatalogo[]> {
  // Projeto anterior aos painéis: não há a que restringir.
  const lista = painelSlug
    ? await FormularioRepository.listarPorPainel(painelSlug)
    : await FormularioRepository.listar();

  return lista
    .filter((f) => f.ativo)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(paraEntrada);
}

export async function carregarFormulario(
  id: string,
  forcar = false,
): Promise<DefinicaoFormulario> {
  if (!forcar) {
    const emMemoria = memoria.get(id);
    if (emMemoria) return emMemoria;
  }

  const cache = await FormularioRepository.obter(id);
  if (!cache) {
    throw new Error(
      `O checklist "${id}" ainda não foi baixado para este aparelho. ` +
        'Conecte-se à rede uma vez para recebê-lo.',
    );
  }

  memoria.set(id, cache.definicao);
  return cache.definicao;
}

export function limparCacheFormulario(id?: string): void {
  if (id) memoria.delete(id);
  else memoria.clear();
}
