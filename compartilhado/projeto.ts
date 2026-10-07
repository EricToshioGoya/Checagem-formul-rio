/**
 * Identificador do projeto que existia antes de um painel poder ter vários
 * projetos. Naquela época o projeto era o par (conta, painel), sem `uid`
 * próprio; o aparelho e o servidor derivam este mesmo valor do id do painel,
 * cada um do seu lado, e a cópia antiga continua casando com a do servidor.
 *
 * O servidor repete a fórmula em SQL na migração (`printf('…%012d', painelId)`).
 */
export function uidProjetoLegado(painelId: number): string {
  return `00000000-0000-4000-8000-${String(painelId).padStart(12, '0')}`;
}
