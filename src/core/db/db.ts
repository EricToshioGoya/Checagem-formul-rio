import Dexie, { type Table } from 'dexie';
import type {
  EntradaSessao,
  FormularioCustomizado,
  Midia,
  Preenchimento,
  Projeto,
  Tag,
} from './tipos';

/**
 * Base local do dispositivo. Nenhum componente de tela importa este módulo
 * diretamente — todo acesso passa pelos repositórios em `./repositorios`,
 * de modo que a troca por um servidor central não afete a interface.
 */
class BancoVerificacao extends Dexie {
  projetos!: Table<Projeto, number>;
  tags!: Table<Tag, number>;
  preenchimentos!: Table<Preenchimento, number>;
  midias!: Table<Midia, number>;
  formulariosCustom!: Table<FormularioCustomizado, string>;
  sessao!: Table<EntradaSessao, string>;

  constructor() {
    super('verificacao-montagem');
    this.version(1).stores({
      projetos: '++id, empresa, nomeProjeto, operador, criadoEm, atualizadoEm',
      tags: '++id, projetoId, nome, ordem, [projetoId+ordem]',
      preenchimentos: '++id, tagId, formId, atualizadoEm, [tagId+formId]',
      midias: '++id, preenchimentoId, etapaId, [preenchimentoId+etapaId]',
      formulariosCustom: 'id, atualizadoEm',
    });
    // v2 acrescenta a sessão de acesso. Uma versão nova, e não uma alteração
    // da v1, para que os aparelhos já em campo migrem sem perder projeto.
    this.version(2).stores({
      sessao: 'chave',
    });
  }
}

export const db = new BancoVerificacao();

/** Espaço ocupado pela base, quando o navegador expõe a estimativa. */
export async function estimarArmazenamento(): Promise<{
  usadoMb: number;
  disponivelMb: number;
} | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usadoMb: usage / 1024 / 1024, disponivelMb: quota / 1024 / 1024 };
}
