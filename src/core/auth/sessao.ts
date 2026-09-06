/**
 * Sessão do usuário no aparelho.
 *
 * Não há backend: o login confere o e-mail contra a lista de acesso de cada
 * painel (ver `acesso.ts`) e guarda apenas o e-mail aceito, para que o montador
 * não precise digitar de novo a cada abertura — inclusive offline.
 */
const CHAVE = 'sessao-usuario';

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
