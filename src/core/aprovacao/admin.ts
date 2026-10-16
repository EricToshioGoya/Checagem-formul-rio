import { api, consulta, type Paginado } from '../api/cliente';
import type { ItemNaoConforme } from '../db/tipos';
import type { DefinicaoFormulario, MapaRespostas } from '../forms/tipos';
import type { DocumentoProjeto } from '../sync/sincronizacao';
import type { EstadoVerificacao } from './decisoes';
import { sha256Hex } from '../../shared/utils/hash';

/** Chamadas da administração para aprovar verificações e certificações. */

export interface ResumoVerificacaoAdmin {
  id: number;
  uid: string;
  estado: EstadoVerificacao;
  versao: number | null;
  painel: { id: number | null; nome: string };
  projeto: { uid: string; empresa: string; nome: string };
  tipo: { id: string; rotulo: string };
  montador: { id: number | null; nome: string; email: string };
  tags: string[];
  pdfUid: string;
  geradoEm: number;
  enviadoEm: number | null;
  decididoEm: number | null;
  decididoPor: string | null;
  comentario: string;
  itens: ItemNaoConforme[];
}

export interface RespostaVerificacoesAdmin extends Paginado {
  itens: Array<ResumoVerificacaoAdmin & { progresso: { total: number; respondidas: number } | null }>;
}

export interface MidiaDoEnvio {
  uid: string;
  mime: string;
  tagUid: string | null;
  formId: string | null;
  etapaId: string;
  ordem: number;
  situacao: 'pendente' | 'recebida' | 'ausente';
}

export interface DetalheVerificacaoAdmin {
  verificacao: ResumoVerificacaoAdmin & { documento: DocumentoProjeto };
  definicoes: Record<string, DefinicaoFormulario | null>;
  midias: MidiaDoEnvio[];
  versoes: ResumoVerificacaoAdmin[];
  pdf: { uid: string; nomeArquivo: string; tamanho: number; sha256: string; emitidoEm: number } | null;
}

/** Etapa marcada na tela de análise, antes de ir ao servidor. */
export interface MarcaNaoConforme {
  tagUid?: string;
  formId: string;
  etapaId: string;
  motivo: string;
}

export function listarVerificacoes(estado: string, pagina: number): Promise<RespostaVerificacoesAdmin> {
  return api.get(`/api/admin/verificacoes${consulta({ estado, pagina })}`);
}

export function obterVerificacao(id: number): Promise<DetalheVerificacaoAdmin> {
  return api.get(`/api/admin/verificacoes/${id}`);
}

export function decidirVerificacao(
  id: number,
  decisao: 'aprovada' | 'reprovada',
  comentario: string,
  itens: MarcaNaoConforme[],
): Promise<{ verificacao: ResumoVerificacaoAdmin }> {
  return api.post(`/api/admin/verificacoes/${id}/decisao`, { decisao, comentario, itens });
}

// ------------------------------------------------------------ certificação

export interface DetalheCertificacaoAdmin {
  solicitacao: {
    id: number;
    uid: string;
    estado: string;
    formId: string;
    numero: string | null;
    painel: { slug: string; nome: string };
    montador: { nome: string; email: string };
    dados: Record<string, string>;
    preenchimento: { formRevisao: string; cabecalho: Record<string, string>; respostas: MapaRespostas };
    midias: Array<{ uid: string; etapaId: string; mime: string; ordem: number; recebida: boolean }>;
    itens: ItemNaoConforme[];
    apontamentos: string | null;
    historico: Array<{ estado: string; em: number; por: string; observacao?: string }>;
  };
  definicao: DefinicaoFormulario | null;
}

export function obterCertificacao(id: number): Promise<DetalheCertificacaoAdmin> {
  return api.get(`/api/admin/certificacoes/${id}`);
}

export function devolverCertificacao(
  id: number,
  apontamentos: string,
  itens: MarcaNaoConforme[],
): Promise<void> {
  return api.post(`/api/admin/certificacoes/${id}/devolver`, {
    apontamentos,
    itens: itens.map(({ formId, etapaId, motivo }) => ({ formId, etapaId, motivo })),
  });
}

/** Tipos de arquivo aceitos como certificado. */
export const TIPOS_CERTIFICADO = ['application/pdf', 'image/jpeg', 'image/png'];

/**
 * Aprova a solicitação e anexa o arquivo do certificado (`nova via` anexa a
 * uma solicitação já aprovada). O servidor confere o SHA-256.
 */
export async function enviarCertificado(
  id: number,
  arquivo: File,
  modo: 'aprovacao' | 'nova-via',
): Promise<void> {
  const rota = modo === 'aprovacao' ? 'aprovacao' : 'certificado';
  await api.enviarArquivo(
    `/api/admin/certificacoes/${id}/${rota}${consulta({ nomeArquivo: arquivo.name, sha256: await sha256Hex(arquivo) })}`,
    arquivo,
  );
}
