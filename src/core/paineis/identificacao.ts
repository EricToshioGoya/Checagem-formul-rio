/**
 * Quem está usando a ferramenta, por painel.
 *
 * Não é autenticação: é o montador declarando quem é, para a ferramenta
 * conferir se a empresa dele está entre as liberadas naquele painel (veja
 * `permissoes.ts`) e para o registro ficar junto do trabalho. Fica no
 * aparelho, como a escolha do painel — nada disso sai daqui.
 */
export interface Identificacao {
  nome: string;
  email: string;
  empresa: string;
  /** Quando foi informada. */
  em: number;
}

const chave = (painelId: string) => `identificacao:${painelId}`;

export function lerIdentificacao(painelId: string): Identificacao | null {
  try {
    const bruto = localStorage.getItem(chave(painelId));
    if (!bruto) return null;
    const dado = JSON.parse(bruto) as Partial<Identificacao>;
    if (!dado?.email || !dado.nome) return null;
    return {
      nome: dado.nome,
      email: dado.email,
      empresa: dado.empresa ?? '',
      em: dado.em ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export function gravarIdentificacao(
  painelId: string,
  dados: Omit<Identificacao, 'em'>,
): Identificacao {
  const identificacao: Identificacao = { ...dados, em: Date.now() };
  try {
    localStorage.setItem(chave(painelId), JSON.stringify(identificacao));
  } catch {
    // Armazenamento bloqueado: vale só nesta aba.
  }
  return identificacao;
}

export function limparIdentificacao(painelId: string): void {
  try {
    localStorage.removeItem(chave(painelId));
  } catch {
    // Nada a fazer — o chamador já descartou o valor em memória.
  }
}
