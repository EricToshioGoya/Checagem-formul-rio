import type { CampoCabecalho, ValoresCabecalho } from './tipos';

/** Ids dos campos obrigatórios ainda sem valor. */
export function camposObrigatoriosVazios(
  campos: CampoCabecalho[],
  valores: ValoresCabecalho,
): string[] {
  return campos
    .filter((c) => c.obrigatorio && !(valores[c.id] ?? '').trim())
    .map((c) => c.id);
}

/** Rótulos dos campos pendentes, para a mensagem exibida ao montador. */
export function rotulosDe(campos: CampoCabecalho[], ids: string[]): string[] {
  return ids
    .map((id) => campos.find((c) => c.id === id)?.rotulo)
    .filter((r): r is string => !!r);
}
