/**
 * A regra de andamento vive em `compartilhado/progresso`, porque o servidor
 * calcula o andamento do que é sincronizado do mesmo jeito que o aparelho.
 */
export {
  calcularProgresso,
  etapaRespondida,
  etapasAtivas,
  idsPendentes,
  type Progresso,
} from '../../../compartilhado/progresso';
