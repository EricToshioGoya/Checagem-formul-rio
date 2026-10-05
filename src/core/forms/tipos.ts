/**
 * Tipos do motor de formulários.
 *
 * A definição em si vem de `compartilhado/formulario`, que é o contrato
 * validado igual no cliente e no servidor. Aqui ficam só os tipos que existem
 * apenas no aparelho: as respostas que o montador digita.
 */
export type {
  CampoCabecalho,
  Condicao,
  ConfigGrade,
  DefinicaoFormulario,
  EntradaCatalogo,
  Etapa,
  MidiaApoio,
  Secao,
  TabelaReferencia,
  TipoCampo,
  TipoResposta,
} from '../../../compartilhado/formulario';

// As respostas também são contrato com o servidor, que calcula o andamento
// do que é sincronizado.
export type {
  MapaRespostas,
  Resposta,
  ValorGrade,
  ValorResposta,
} from '../../../compartilhado/progresso';

/** `campoId` → valor informado no cabeçalho do formulário, por TAG. */
export type ValoresCabecalho = Record<string, string>;
