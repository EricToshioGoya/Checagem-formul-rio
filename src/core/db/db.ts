import Dexie, { type Table } from 'dexie';
import type {
  Certificado,
  Contador,
  FormularioCustomizado,
  Midia,
  PermissaoCustomizada,
  Preenchimento,
  Projeto,
  Solicitacao,
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
  solicitacoes!: Table<Solicitacao, number>;
  certificados!: Table<Certificado, number>;
  contadores!: Table<Contador, string>;
  permissoes!: Table<PermissaoCustomizada, string>;

  constructor() {
    super('verificacao-montagem');
    this.version(1).stores({
      projetos: '++id, empresa, nomeProjeto, operador, criadoEm, atualizadoEm',
      tags: '++id, projetoId, nome, ordem, [projetoId+ordem]',
      preenchimentos: '++id, tagId, formId, atualizadoEm, [tagId+formId]',
      midias: '++id, preenchimentoId, etapaId, [preenchimentoId+etapaId]',
      formulariosCustom: 'id, atualizadoEm',
    });

    // v2 — fluxo de certificação (SPEE, SPEP e SAFR) e permissão de acesso ao
    // painel. As tabelas da v1 são redeclaradas sem alteração; os registros
    // existentes continuam válidos e nenhuma migração de dados é necessária.
    this.version(2).stores({
      projetos: '++id, tipoPainel, empresa, nomeProjeto, operador, criadoEm, atualizadoEm',
      tags: '++id, projetoId, nome, ordem, [projetoId+ordem]',
      preenchimentos:
        '++id, tagId, solicitacaoId, formId, atualizadoEm, [tagId+formId]',
      midias: '++id, preenchimentoId, etapaId, [preenchimentoId+etapaId]',
      formulariosCustom: 'id, atualizadoEm',
      solicitacoes: '++id, tipoPainel, estado, numeroCertificado, criadoEm, atualizadoEm',
      certificados: '++id, &numero, solicitacaoId, tipoPainel, emitidoEm',
      contadores: 'id',
      acessos: '++id, email, painelId, [email+painelId]',
    });

    // v3 — a ferramenta deixou de ter login e aprovação de acesso. A tabela
    // sai do banco, e com ela os e-mails que ficavam gravados no aparelho.
    this.version(3).stores({ acessos: null });

    // v4 — permissões de uso por painel, editáveis na aba de administração.
    this.version(4).stores({ permissoes: 'painelId, atualizadoEm' });
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
