import { API_BASE } from '../config';

/**
 * Cliente da fila de liberação (`cmd/servidor`).
 *
 * Só este módulo conhece o formato da API: as telas trabalham com
 * `SolicitacaoAcesso` e com os dois erros abaixo.
 */

export type StatusAcesso = 'pendente' | 'liberado' | 'negado';

export interface SolicitacaoAcesso {
  id: string;
  email: string;
  painelId: string;
  painelNome: string;
  status: StatusAcesso;
  observacao?: string;
  criadoEm: string;
  decididoEm?: string;
  decididoPor?: string;
}

/** O servidor respondeu, mas recusou a operação. */
export class ErroApi extends Error {
  constructor(
    readonly codigo: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

/**
 * Não foi possível falar com o servidor: sem rede, servidor fora do ar ou
 * aplicação publicada sem a fila de liberação atrás do mesmo endereço.
 */
export class ServidorIndisponivel extends Error {
  constructor(mensagem = 'Sem conexão com o servidor de liberação.') {
    super(mensagem);
    this.name = 'ServidorIndisponivel';
  }
}

interface Opcoes {
  metodo?: 'GET' | 'POST' | 'DELETE';
  corpo?: unknown;
  token?: string;
}

async function chamar<T>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  const { metodo = 'GET', corpo, token } = opcoes;
  let resposta: Response;
  try {
    resposta = await fetch(`${API_BASE}${caminho}`, {
      method: metodo,
      headers: {
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: 'no-store',
    });
  } catch {
    throw new ServidorIndisponivel();
  }

  const tipo = resposta.headers.get('Content-Type') ?? '';
  if (!tipo.includes('application/json')) {
    // Hospedagem estática devolve o index.html em /api: é o mesmo que não ter
    // servidor de liberação.
    throw new ServidorIndisponivel(
      'O endereço configurado não responde a fila de liberação. Verifique VITE_API_URL.',
    );
  }

  const dados = (await resposta.json()) as T & { erro?: string };
  if (!resposta.ok) {
    throw new ErroApi(resposta.status, dados.erro ?? 'Falha na comunicação com o servidor.');
  }
  return dados;
}

export const AcessoApi = {
  /** Cria (ou recupera) o pedido de acesso do montador. */
  solicitar(email: string, painelId: string, painelNome: string) {
    return chamar<{ token: string; solicitacao: SolicitacaoAcesso }>('/acesso/solicitar', {
      metodo: 'POST',
      corpo: { email, painelId, painelNome },
    });
  },

  async situacao(token: string): Promise<SolicitacaoAcesso> {
    const { solicitacao } = await chamar<{ solicitacao: SolicitacaoAcesso }>(
      `/acesso/situacao?token=${encodeURIComponent(token)}`,
    );
    return solicitacao;
  },

  disponivel(): Promise<{ ok: boolean }> {
    return chamar<{ ok: boolean }>('/saude');
  },
};

export const AdminApi = {
  async entrar(senha: string): Promise<string> {
    const { token } = await chamar<{ token: string }>('/admin/sessao', {
      metodo: 'POST',
      corpo: { senha },
    });
    return token;
  },

  async sair(token: string): Promise<void> {
    await chamar('/admin/sessao', { metodo: 'DELETE', token });
  },

  async listar(token: string): Promise<SolicitacaoAcesso[]> {
    const { solicitacoes } = await chamar<{ solicitacoes: SolicitacaoAcesso[] }>(
      '/admin/solicitacoes',
      { token },
    );
    return solicitacoes;
  },

  async decidir(
    token: string,
    id: string,
    acao: 'liberar' | 'negar' | 'revogar',
    observacao = '',
  ): Promise<SolicitacaoAcesso> {
    const { solicitacao } = await chamar<{ solicitacao: SolicitacaoAcesso }>(
      `/admin/solicitacoes/${encodeURIComponent(id)}`,
      { metodo: 'POST', corpo: { acao, observacao }, token },
    );
    return solicitacao;
  },

  async excluir(token: string, id: string): Promise<void> {
    await chamar(`/admin/solicitacoes/${encodeURIComponent(id)}`, {
      metodo: 'DELETE',
      token,
    });
  },
};
