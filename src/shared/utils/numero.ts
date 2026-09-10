/**
 * Leitura e escrita de número no formato usado no chão de fábrica brasileiro.
 *
 * O campo aceita vírgula e ponto como separador decimal. Sem isso, `12,5`
 * digitado num `<input type="number">` era descartado pelo navegador e chegava
 * como `125` — um valor dez vezes errado em um registro de ensaio.
 */

/**
 * Converte o texto digitado em número.
 *
 * Aceita `12,5`, `12.5` e `1.234,56`; devolve `null` para texto vazio ou que
 * não seja um número — nunca um valor parcialmente interpretado.
 */
export function analisarNumero(texto: string): number | null {
  const limpo = texto.replace(/\s/g, '');
  if (!limpo) return null;
  // Com vírgula presente, ela é o separador decimal e o ponto é milhar.
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;
  // Recusa notação científica e qualquer sobra de texto.
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(normalizado)) return null;
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

/** Texto de exibição do número no campo, com a vírgula decimal do pt-BR. */
export function numeroParaCampo(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '';
  return String(valor).replace('.', ',');
}
