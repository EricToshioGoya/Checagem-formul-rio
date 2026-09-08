/**
 * Sessão do usuário no aparelho.
 *
 * Não há backend: o login apenas identifica o montador pelo e-mail e guarda a
 * escolha, para que ele não precise digitar de novo a cada abertura —
 * inclusive offline. Quem libera a montagem é o responsável pelo painel, pela
 * aprovação registrada em `core/access`.
 */
const CHAVE = 'sessao-usuario';
const CHAVE_PAINEL = 'painel-ativo';

export interface Sessao {
  email: string;
  entrouEm: number;
}

export function lerSessao(): Sessao | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return null;
    const dado = JSON.parse(bruto) as Partial<Sessao>;
    if (typeof dado?.email !== 'string' || !dado.email) return null;
    return { email: dado.email, entrouEm: dado.entrouEm ?? Date.now() };
  } catch {
    return null;
  }
}

export function gravarSessao(email: string): Sessao {
  const sessao: Sessao = { email, entrouEm: Date.now() };
  try {
    localStorage.setItem(CHAVE, JSON.stringify(sessao));
  } catch {
    // Armazenamento bloqueado (navegação privada): a sessão vale só em memória.
  }
  return sessao;
}

export function limparSessao(): void {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // Nada a fazer — a sessão em memória já foi descartada pelo chamador.
  }
}

/** Id do painel escolhido depois do login. */
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
