import type { SolicitacaoAcesso, StatusAcesso } from './api';

/**
 * Pedido de liberação deste aparelho, por painel.
 *
 * Guarda o token do pedido e a última situação conhecida. É a cópia local que
 * permite continuar preenchendo offline depois de liberado — o servidor é
 * consultado sempre que houver rede.
 */

const chave = (painelId: string) => `liberacao:${painelId}`;

export interface SessaoLiberacao {
  token: string;
  id: string;
  email: string;
  painelId: string;
  painelNome: string;
  status: StatusAcesso;
  observacao?: string;
  verificadoEm: number;
}

export function lerSessao(painelId: string): SessaoLiberacao | null {
  try {
    const bruto = localStorage.getItem(chave(painelId));
    if (!bruto) return null;
    const dados = JSON.parse(bruto) as SessaoLiberacao;
    if (!dados?.token || dados.painelId !== painelId) return null;
    return dados;
  } catch {
    return null;
  }
}

export function gravarSessao(
  painelId: string,
  token: string,
  solicitacao: SolicitacaoAcesso,
): SessaoLiberacao {
  const sessao: SessaoLiberacao = {
    token,
    id: solicitacao.id,
    email: solicitacao.email,
    painelId,
    painelNome: solicitacao.painelNome || painelId,
    status: solicitacao.status,
    observacao: solicitacao.observacao,
    verificadoEm: Date.now(),
  };
  try {
    localStorage.setItem(chave(painelId), JSON.stringify(sessao));
  } catch {
    // Armazenamento bloqueado: o pedido vale só enquanto a aba estiver aberta.
  }
  return sessao;
}

export function apagarSessao(painelId: string): void {
  try {
    localStorage.removeItem(chave(painelId));
  } catch {
    // Nada a fazer — o chamador já descartou o valor em memória.
  }
}
