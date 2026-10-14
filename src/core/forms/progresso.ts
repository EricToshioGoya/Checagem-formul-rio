/**
 * A regra de andamento vive em `compartilhado/progresso`, porque o servidor
 * calcula o andamento do que é sincronizado do mesmo jeito que o aparelho.
 */
export {
  calcularProgresso,
  checklistsDaTag,
  contarMidias,
  etapaRespondida,
  etapasAtivas,
  etapaVisivel,
  idsPendentes,
  percentualDe,
  progressoDe,
  somarProgresso,
  SEM_MIDIAS,
  type ContagemMidias,
  type MapaMidias,
  type Progresso,
} from '../../../compartilhado/progresso';
