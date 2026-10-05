/** "1 painel", "2 painéis": o número com a forma certa, no lugar de "painel(is)". */
export function plural(n: number, singular: string, formaPlural: string): string {
  return `${n} ${n === 1 ? singular : formaPlural}`;
}
