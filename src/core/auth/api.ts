/**
 * Cliente da API de autorização.
 *
 * Toda função aqui pode falhar por falta de rede — é a situação normal em
 * campo. Quem chama trata a falha como "não deu para falar com o servidor
 * agora", nunca como "acesso negado": negar acesso é decisão do responsável,
 * não consequência de sinal ruim.
 */
import { API_URL } from '../config';
import type { PainelPublico, ResultadoSolicitacao, Solicitacao } from './tipos';

/** Erro com mensagem já pronta para a tela. */
export class ErroApi extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }

  /** Distingue falta de rede de recusa do servidor. */
  get semRede(): boolean {
    return this.status === 0;
  }
}

interface Opcoes {
  metodo?: 'GET' | 'POST';
  corpo?: unknown;
  credencial?: string;
}

async function chamar<T>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  if (!API_URL) {
    throw new ErroApi(
      'Este build não sabe o endereço do servidor de autorização ' +
        '(VITE_API_URL). Fale com quem publicou o aplicativo.',
      0,
    );
  }

  const cabecalhos: Record<string, string> = {};
  if (opcoes.corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (opcoes.credencial) cabecalhos.Authorization = `Bearer ${opcoes.credencial}`;

  let resposta: Response;
  try {
    resposta = await fetch(`${API_URL}${caminho}`, {
      method: opcoes.metodo ?? 'GET',
      headers: cabecalhos,
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
    });
  } catch {
    throw new ErroApi('Sem conexão com o servidor de autorização.', 0);
  }

  if (!resposta.ok) {
    const detalhe = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroApi(detalhe?.erro ?? `Falha na comunicação (HTTP ${resposta.status}).`, resposta.status);
  }
  return (await resposta.json()) as T;
}

export const AutorizacaoApi = {
  paineis(): Promise<PainelPublico[]> {
    return chamar<PainelPublico[]>('/api/paineis');
  },

  solicitar(dados: {
    email: string;
    painelId: string;
    deviceId: string;
    descricao: string;
  }): Promise<ResultadoSolicitacao> {
    return chamar<ResultadoSolicitacao>('/api/solicitacoes', { metodo: 'POST', corpo: dados });
  },

  consultar(id: string, deviceId: string): Promise<ResultadoSolicitacao> {
    return chamar<ResultadoSolicitacao>(
      `/api/solicitacoes/${encodeURIComponent(id)}?device=${encodeURIComponent(deviceId)}`,
    );
  },

  /** Renova a credencial e, de quebra, descobre se o acesso foi revogado. */
  async revalidar(credencial: string): Promise<string> {
    const resposta = await chamar<{ credencial: string }>('/api/sessao/revalidar', {
      metodo: 'POST',
      credencial,
    });
    return resposta.credencial;
  },

  listarSolicitacoes(painelId: string, credencial: string): Promise<Solicitacao[]> {
    return chamar<Solicitacao[]>(`/api/paineis/${encodeURIComponent(painelId)}/solicitacoes`, {
      credencial,
    });
  },

  decidir(id: string, aprovar: boolean, credencial: string): Promise<Solicitacao> {
    return chamar<Solicitacao>(`/api/solicitacoes/${encodeURIComponent(id)}/decidir`, {
      metodo: 'POST',
      corpo: { aprovar },
      credencial,
    });
  },

  revogar(id: string, credencial: string): Promise<Solicitacao> {
    return chamar<Solicitacao>(`/api/solicitacoes/${encodeURIComponent(id)}/revogar`, {
      metodo: 'POST',
      credencial,
    });
  },
};
