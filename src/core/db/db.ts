import Dexie, { type Table } from 'dexie';
import type {
  FormularioCache,
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
  formularios!: Table<FormularioCache, string>;

  constructor() {
    super('verificacao-montagem');
    this.version(1).stores({
      projetos: '++id, empresa, nomeProjeto, operador, criadoEm, atualizadoEm',
      tags: '++id, projetoId, nome, ordem, [projetoId+ordem]',
      preenchimentos: '++id, tagId, formId, atualizadoEm, [tagId+formId]',
      midias: '++id, preenchimentoId, etapaId, [preenchimentoId+etapaId]',
      formulariosCustom: 'id, atualizadoEm',
    });
    // v2: o projeto local passa a apontar para o painel do servidor, de modo
    // que reabrir o painel caia no preenchimento já existente. Projetos
    // criados antes do login ficam com `painelId` indefinido e continuam
    // acessíveis — a migração não reescreve nada.
    this.version(2).stores({
      projetos: '++id, empresa, nomeProjeto, operador, criadoEm, atualizadoEm, painelId',
    });
    // v3: o projeto passa a ser de um usuário. O IndexedDB é por origem, não
    // por pessoa — num tablet compartilhado no galpão, sem isto o montador
    // seguinte abriria o projeto do anterior e assinaria o PDF no nome dele.
    this.version(3).stores({
      projetos:
        '++id, empresa, nomeProjeto, operador, criadoEm, atualizadoEm, painelId, usuarioId, [usuarioId+painelId]',
    });
    // v4: os checklists deixam de ser arquivo publicado com customização local
    // e passam a ser cópia do servidor, que é onde a administração os monta.
    // `formulariosCustom` é descartada: o que havia nela eram edições presas a
    // um aparelho, que agora não teriam como voltar para o servidor sem
    // sobrescrever o checklist de todo mundo.
    this.version(4).stores({
      formulariosCustom: null,
      formularios: 'id, painelSlug, atualizadoEm',
    });
    // v5: TAGs e mídias ganham `uid`, o identificador que vale em todo
    // aparelho, para a sincronização com o servidor reconhecer a mesma TAG e
    // a mesma foto. As que já existem recebem o seu agora.
    this.version(5)
      .stores({
        tags: '++id, projetoId, nome, ordem, [projetoId+ordem], uid',
        midias: '++id, preenchimentoId, etapaId, [preenchimentoId+etapaId], uid',
      })
      .upgrade(async (tx) => {
        await tx
          .table('tags')
          .toCollection()
          .modify((t: Tag) => {
            if (!t.uid) t.uid = novoUid();
          });
        await tx
          .table('midias')
          .toCollection()
          .modify((m: Midia) => {
            if (!m.uid) m.uid = novoUid();
          });
      });

    // Toda TAG e mídia nova nasce com `uid`, venha de onde vier: tela,
    // importação de .zip ou a própria sincronização.
    this.tags.hook('creating', (_chave, tag) => {
      if (!tag.uid) tag.uid = novoUid();
    });
    this.midias.hook('creating', (_chave, midia) => {
      if (!midia.uid) midia.uid = novoUid();
    });
  }
}

/** UUID v4. `crypto.randomUUID` existe em todo contexto seguro (HTTPS e localhost). */
export function novoUid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
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
