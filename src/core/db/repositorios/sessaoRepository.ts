import { db } from '../db';

type Chave = 'dispositivo' | 'credencial';

async function ler(chave: Chave): Promise<string | undefined> {
  return (await db.sessao.get(chave))?.valor;
}

async function gravar(chave: Chave, valor: string): Promise<void> {
  await db.sessao.put({ chave, valor, atualizadoEm: Date.now() });
}

/**
 * Identificador do aparelho e credencial de acesso.
 *
 * Ficam no IndexedDB, junto do resto: a mesma base que guarda os
 * preenchimentos, apagada pelos mesmos gestos do usuário. Limpar os dados do
 * navegador derruba o acesso e exige nova solicitação — comportamento
 * desejado, já que é assim que um aparelho perdido deixa de valer.
 */
export const SessaoRepository = {
  /**
   * Identificador estável do aparelho, criado na primeira execução. É o que
   * amarra a autorização a este aparelho: outro aparelho gera outro
   * identificador e precisa de aprovação própria.
   */
  async dispositivo(): Promise<string> {
    const existente = await ler('dispositivo');
    if (existente) return existente;

    const novo = crypto.randomUUID();
    await gravar('dispositivo', novo);
    return novo;
  },

  credencial(): Promise<string | undefined> {
    return ler('credencial');
  },

  async guardarCredencial(credencial: string): Promise<void> {
    await gravar('credencial', credencial);
  },

  async descartarCredencial(): Promise<void> {
    await db.sessao.delete('credencial');
  },
};
