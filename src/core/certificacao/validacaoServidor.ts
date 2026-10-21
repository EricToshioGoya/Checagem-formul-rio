import { api, consulta } from '../api/cliente';
import type { Certificado, EventoSolicitacao } from '../db/tipos';
import type { Progresso } from '../forms/progresso';
import type { ValoresCabecalho } from '../forms/tipos';
import { camposDoPainel, obterPainel } from '../paineis/catalogo';
import { camposObrigatoriosVazios, rotulosDe } from '../forms/validacaoCampos';
import type { CampoCabecalho } from '../forms/tipos';
import type { Painel } from '../paineis/tipos';

/**
 * Validação ABB pela administração. Lê as solicitações enviadas do servidor —
 * de qualquer aparelho — e decide por lá (ver `core/aprovacao/admin`):
 * aprovar anexa o certificado e atribui o número, de um contador único.
 */

export interface SolicitacaoParaValidar {
  id: number;
  uid: string;
  painel: { slug: string; nome: string };
  montador: { nome: string; email: string };
  dados: ValoresCabecalho;
  progresso: Progresso;
  /** Ids das etapas do checklist ainda sem resposta. */
  etapasPendentes: string[];
  enviadaEm: number;
  historico: EventoSolicitacao[];
}

export interface LinhaDeValidacao {
  item: SolicitacaoParaValidar;
  painel: Painel;
  campos: CampoCabecalho[];
  /** Rótulos dos campos obrigatórios ainda vazios. */
  camposPendentes: string[];
  completa: boolean;
}

export async function listarParaValidar(): Promise<LinhaDeValidacao[]> {
  const { itens } = await api.get<{ itens: SolicitacaoParaValidar[] }>(
    '/api/admin/certificacoes?estado=enviada',
  );
  const linhas: LinhaDeValidacao[] = [];
  for (const item of itens) {
    const [painel, campos] = await Promise.all([obterPainel(item.painel.slug), camposDoPainel(item.painel.slug)]);
    const camposPendentes = rotulosDe(campos, camposObrigatoriosVazios(campos, item.dados));
    linhas.push({
      item,
      painel,
      campos,
      camposPendentes,
      completa: item.etapasPendentes.length === 0 && camposPendentes.length === 0,
    });
  }
  return linhas;
}

/** Certificado do registro, com o último arquivo anexado. */
export type CertificadoRegistrado = Omit<Certificado, 'id' | 'solicitacaoId'> & {
  /** Nulo quando a solicitação foi excluída; o certificado continua no registro. */
  certificacaoId: number | null;
  anexo: { uid: string; nomeArquivo: string; mime: string; tamanho: number; anexadoEm: number } | null;
};

/** Registro das emissões: os 500 mais recentes ou, com `busca`, os que batem com ela. */
export async function listarCertificados(busca?: string): Promise<CertificadoRegistrado[]> {
  return (await api.get<{ certificados: CertificadoRegistrado[] }>(`/api/admin/certificados${consulta({ busca })}`))
    .certificados;
}
