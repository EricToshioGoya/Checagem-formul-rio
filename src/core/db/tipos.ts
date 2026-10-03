import type {
  DefinicaoFormulario,
  MapaRespostas,
  ValoresCabecalho,
} from '../forms/tipos';

export interface Projeto {
  id?: number;
  empresa: string;
  nomeProjeto: string;
  operador: string;
  /** Modelado desde a v1 para a futura integração SAP/ERP. */
  numeroPedido?: string;
  /**
   * Painel do servidor a que este projeto corresponde. Ausente nos projetos
   * criados localmente antes do login existir.
   */
  painelId?: number;
  /**
   * `slug` do painel (`sen-plus`, `mns`…). Guardado junto do id para que a
   * tela saiba quais formulários valem sem consultar o servidor — é o que
   * mantém o preenchimento funcionando offline.
   */
  painelSlug?: string;
  /**
   * Dono da cópia local. Separa os dados de quem divide o mesmo aparelho.
   * Ausente nos projetos anteriores ao login — esses aparecem para todos,
   * e é o comportamento pretendido: não há a quem atribuí-los.
   */
  usuarioId?: number;
  criadoEm: number;
  atualizadoEm: number;
  /**
   * `atualizadoEm` do que foi enviado ao servidor por último. Projeto com
   * `atualizadoEm` maior tem alteração ainda só neste aparelho.
   */
  sincronizadoEm?: number;
  /** Versão do servidor de que esta cópia partiu. */
  versaoServidor?: number;
}

export interface Tag {
  id?: number;
  projetoId: number;
  nome: string;
  ordem: number;
  /**
   * Identificador que vale em todo aparelho. O `id` é só deste aparelho; para
   * a mesma TAG ser reconhecida no servidor e em outro aparelho, é o `uid`.
   */
  uid?: string;
}

export interface Preenchimento {
  id?: number;
  tagId: number;
  formId: string;
  /** Revisão da definição usada — impressa no PDF. */
  formRevisao: string;
  cabecalho: ValoresCabecalho;
  respostas: MapaRespostas;
  atualizadoEm: number;
}

export interface Midia {
  id?: number;
  preenchimentoId: number;
  etapaId: string;
  blob: Blob;
  mime: string;
  largura: number;
  altura: number;
  tamanho: number;
  nomeOriginal?: string;
  criadoEm: number;
  ordem: number;
  /** Identificador que vale em todo aparelho e é o nome do arquivo no servidor. */
  uid?: string;
}

/**
 * Checklist baixado do servidor e guardado no aparelho.
 *
 * O servidor é a fonte da verdade — é lá que a administração monta o
 * checklist. Esta cópia existe para o montador continuar preenchendo dentro
 * do galpão, sem rede: a tela de preenchimento lê sempre daqui, e a sincronia
 * acontece quando há conexão.
 */
export interface FormularioCache {
  id: string;
  painelSlug: string;
  nome: string;
  tipo: 'montagem' | 'rotina';
  linhaProduto: string;
  ativo: boolean;
  /** Etapas ativas; zero significa checklist ainda em construção. */
  etapas: number;
  /** Carimbo do servidor: muda quando a administração grava o checklist. */
  atualizadoEm: number;
  definicao: DefinicaoFormulario;
  /** Quando este aparelho baixou — para mostrar a idade da cópia offline. */
  sincronizadoEm: number;
}
