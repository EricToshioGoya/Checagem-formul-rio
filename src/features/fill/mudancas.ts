import type { MapaRespostas, Resposta, ValoresCabecalho } from '../../core/forms/tipos';

/**
 * A tela do formulário guarda as respostas em memória e as grava no aparelho.
 * Gravar o mapa inteiro apagaria o que a sincronização trouxe de outro
 * aparelho da mesma conta com a tela aberta. Por isso se grava só o que a
 * pessoa mudou (`mudancas`), e o que chega de fora entra na tela
 * (`adotarExterno`) sem tocar no que ela está digitando.
 */

/** Texto estável de um valor: as mesmas chaves em outra ordem dão o mesmo texto. */
function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>;
    return `{${Object.keys(objeto)
      .sort()
      .map((chave) => `${JSON.stringify(chave)}:${canonico(objeto[chave])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor) ?? 'undefined';
}

export function iguais(a: unknown, b: unknown): boolean {
  return canonico(a) === canonico(b);
}

/** O que mudou de `base` (o que está gravado) para `tela`: `null` onde a chave saiu. */
function diferenca<T>(base: Record<string, T>, tela: Record<string, T>): Record<string, T | null> {
  const mudancas: Record<string, T | null> = {};
  for (const [chave, valor] of Object.entries(tela)) {
    if (!iguais(base[chave], valor)) mudancas[chave] = valor;
  }
  for (const chave of Object.keys(base)) {
    if (!(chave in tela)) mudancas[chave] = null;
  }
  return mudancas;
}

export function mudancasDeRespostas(base: MapaRespostas, tela: MapaRespostas) {
  return diferenca<Resposta>(base, tela);
}

export function mudancasDeCabecalho(base: ValoresCabecalho, tela: ValoresCabecalho) {
  return diferenca<string>(base, tela);
}

/** Aplica um conjunto de mudanças (`null` apaga a chave) sobre um mapa. */
export function aplicarMudancas<T>(mapa: Record<string, T>, mudancas: Record<string, T | null>): Record<string, T> {
  const novo = { ...mapa };
  for (const [chave, valor] of Object.entries(mudancas)) {
    if (valor === null) delete novo[chave];
    else novo[chave] = valor;
  }
  return novo;
}

/**
 * O que o banco tem de diferente do que a tela já conhecia (`base`) e a pessoa
 * não mexeu aqui: entra na tela. Chave que ela alterou e ainda não gravou fica
 * como está — a alteração dela é a mais nova e será gravada em seguida.
 */
export function adotarExterno<T>(
  base: Record<string, T>,
  tela: Record<string, T>,
  banco: Record<string, T>,
): Record<string, T> {
  const externas = diferenca(base, banco);
  let resultado = tela;
  for (const [chave, valor] of Object.entries(externas)) {
    if (!iguais(tela[chave], base[chave])) continue;
    if (resultado === tela) resultado = { ...tela };
    if (valor === null) delete resultado[chave];
    else resultado[chave] = valor;
  }
  return resultado;
}
