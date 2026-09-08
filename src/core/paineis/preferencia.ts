/**
 * Painel escolhido no aparelho.
 *
 * Não há login nem servidor: a ferramenta abre no painel que o operador
 * escolheu da última vez, inclusive offline. Quem pode usar cada painel é
 * decidido fora da ferramenta, por quem distribui o endereço.
 */
const CHAVE_PAINEL = 'painel-ativo';

export function lerPainel(): string | null {
  try {
    return localStorage.getItem(CHAVE_PAINEL) || null;
  } catch {
    return null;
  }
}

export function gravarPainel(painelId: string): void {
  try {
    localStorage.setItem(CHAVE_PAINEL, painelId);
  } catch {
    // Armazenamento bloqueado: a escolha vale só nesta aba.
  }
}

export function limparPainel(): void {
  try {
    localStorage.removeItem(CHAVE_PAINEL);
  } catch {
    // Nada a fazer — o chamador já descartou a escolha em memória.
  }
}
