import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/cliente';
import type { ItemNaoConforme } from '../db/tipos';
import type { Resposta } from '../forms/tipos';

/**
 * Decisões da administração sobre os PDFs de verificação enviados pelo
 * montador: aprovada, ou reprovada com as etapas a corrigir.
 *
 * A última leitura fica guardada no aparelho por conta: o alerta amarelo e as
 * etapas marcadas continuam à vista dentro do galpão, sem rede.
 */

export const ID_CABECALHO = '__cabecalho__';

export type EstadoVerificacao = 'aguardando' | 'aprovada' | 'reprovada' | 'substituida';

/** O que o montador tinha mandado na etapa marcada, para dizer se já mudou. */
export type EnviadoNaEtapa =
  | { resposta: Resposta | null; midias: string[] }
  | { cabecalho: Record<string, string> };

export interface ItemDecisao extends ItemNaoConforme {
  enviado: EnviadoNaEtapa;
}

export interface DecisaoVerificacao {
  id: number;
  uid: string;
  estado: EstadoVerificacao;
  versao: number | null;
  painel: { id: number | null; nome: string };
  projeto: { uid: string; empresa: string; nome: string };
  tipo: { id: string; rotulo: string };
  tags: string[];
  geradoEm: number;
  enviadoEm: number | null;
  decididoEm: number | null;
  decididoPor: string | null;
  comentario: string;
  itens: ItemDecisao[];
  /** Versão aprovada mais recente do mesmo projeto e tipo, se houver. */
  ultimaAprovada: { versao: number; decididoEm: number } | null;
  /** `verificacao`: PDF do projeto. `certificado`: checklist que contém certificado (uma TAG). */
  categoria?: 'verificacao' | 'certificado';
  /** No checklist que contém certificado: a TAG, o checklist e, aprovado, o código emitido. */
  certificado?: { tagUid: string | null; formId: string | null; numero: string | null; uid: string | null } | null;
}

export const ehCertificado = (d: DecisaoVerificacao): boolean => d.categoria === 'certificado';

/** Como a decisão aparece para o montador: o tipo do PDF, ou o checklist e a TAG do certificado. */
export function rotuloDaDecisao(d: DecisaoVerificacao): string {
  return ehCertificado(d) ? `Certificado — ${d.tipo.rotulo} · TAG ${d.tags[0] ?? ''}` : d.tipo.rotulo;
}

/** O certificado já emitido para o checklist da TAG, se houver: um por checklist. */
export function certificadoEmitido(usuarioId: number, tagUid: string, formId: string): DecisaoVerificacao | undefined {
  const tag = tagUid.toLowerCase();
  return lerDecisoesGuardadas(usuarioId).find(
    (d) =>
      ehCertificado(d) &&
      d.estado === 'aprovada' &&
      Boolean(d.certificado?.numero) &&
      d.certificado?.tagUid?.toLowerCase() === tag &&
      d.certificado.formId === formId,
  );
}

/** Baixa o certificado emitido para um checklist aprovado. Exige conexão. */
export async function baixarCertificadoEmitido(d: DecisaoVerificacao): Promise<{ blob: Blob; nome: string }> {
  const blob = await api.baixarArquivo(`/api/verificacoes/${d.uid}/certificado`);
  const nome = `Certificado ${d.certificado?.numero ?? ''} - TAG ${d.tags[0] ?? ''}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
  return { blob, nome };
}

const EVENTO = 'decisoes-atualizadas';
const chave = (usuarioId: number) => `verificacoes-${usuarioId}`;
const chaveVistas = (usuarioId: number) => `decisoes-vistas-${usuarioId}`;

export function lerDecisoesGuardadas(usuarioId: number): DecisaoVerificacao[] {
  try {
    const bruto = localStorage.getItem(chave(usuarioId));
    return bruto ? (JSON.parse(bruto) as DecisaoVerificacao[]) : [];
  } catch {
    return [];
  }
}

function guardar(usuarioId: number, lista: DecisaoVerificacao[]): void {
  try {
    localStorage.setItem(chave(usuarioId), JSON.stringify(lista));
  } catch {
    // Armazenamento cheio ou bloqueado: sem rede, o alerta não aparece.
  }
}

/** Lê do servidor e guarda; sem conexão, fica a última leitura. */
export async function atualizarDecisoes(usuarioId: number): Promise<DecisaoVerificacao[]> {
  try {
    const { verificacoes } = await api.get<{ verificacoes: DecisaoVerificacao[] }>('/api/verificacoes');
    guardar(usuarioId, verificacoes);
    window.dispatchEvent(new Event(EVENTO));
    return verificacoes;
  } catch {
    return lerDecisoesGuardadas(usuarioId);
  }
}

/** Decisões da conta, relidas ao abrir, a cada 2 minutos e quando outra tela atualiza. */
export function useDecisoes(usuarioId: number | undefined): {
  decisoes: DecisaoVerificacao[];
  recarregar: () => Promise<void>;
} {
  const [decisoes, setDecisoes] = useState<DecisaoVerificacao[]>(() =>
    usuarioId === undefined ? [] : lerDecisoesGuardadas(usuarioId),
  );

  const recarregar = useCallback(async () => {
    if (usuarioId === undefined) return;
    setDecisoes(await atualizarDecisoes(usuarioId));
  }, [usuarioId]);

  useEffect(() => {
    if (usuarioId === undefined) return;
    setDecisoes(lerDecisoesGuardadas(usuarioId));
    void recarregar();
    const ouvir = () => setDecisoes(lerDecisoesGuardadas(usuarioId));
    window.addEventListener(EVENTO, ouvir);
    const releitura = window.setInterval(() => {
      if (document.visibilityState === 'visible') void recarregar();
    }, 120_000);
    return () => {
      window.removeEventListener(EVENTO, ouvir);
      window.clearInterval(releitura);
    };
  }, [usuarioId, recarregar]);

  return { decisoes, recarregar };
}

/**
 * Reprovação do PDF do projeto cujas etapas são todas de checklists que
 * passaram a conter certificado e já foram reenviados pela aba Certificados:
 * o PDF do projeto não leva mais esses checklists, e a correção seguiu por lá.
 */
export function superadaPorCertificado(d: DecisaoVerificacao, decisoes: DecisaoVerificacao[]): boolean {
  if (ehCertificado(d) || !d.itens.length) return false;
  return d.itens.every((item) => {
    const tag = item.tagUid?.toLowerCase();
    return (
      tag !== undefined &&
      decisoes.some(
        (c) =>
          ehCertificado(c) &&
          c.certificado?.tagUid?.toLowerCase() === tag &&
          c.certificado.formId === item.formId &&
          (c.enviadoEm ?? 0) > (d.decididoEm ?? 0),
      )
    );
  });
}

/** Projeto e tipo com a versão mais recente reprovada: há correção a fazer. */
export function reprovadas(decisoes: DecisaoVerificacao[]): DecisaoVerificacao[] {
  return decisoes.filter((d) => d.estado === 'reprovada' && !superadaPorCertificado(d, decisoes));
}

/**
 * Etapas a corrigir num checklist de uma TAG, com o motivo: o que a tela de
 * preenchimento destaca. Junta as reprovações de todos os tipos do projeto.
 */
export function correcoesDoChecklist(
  usuarioId: number,
  projetoUid: string | undefined,
  tagUid: string | undefined,
  formId: string,
): Record<string, string> {
  if (!projetoUid || !tagUid) return {};
  const projeto = projetoUid.toLowerCase();
  const tag = tagUid.toLowerCase();
  const mapa: Record<string, string> = {};
  for (const d of reprovadas(lerDecisoesGuardadas(usuarioId))) {
    if (d.projeto.uid.toLowerCase() !== projeto) continue;
    for (const item of d.itens) {
      if (item.tagUid?.toLowerCase() === tag && item.formId === formId) mapa[item.etapaId] = item.motivo;
    }
  }
  return mapa;
}

// ------------------------------------------------- avisos já mostrados

/** Chave de cada decisão para o pop-up: aparece uma vez por decisão. */
export function chaveDecisao(tipo: 'verificacao' | 'certificacao', uid: string, estado: string, em: number | null): string {
  return `${tipo}:${uid}:${estado}:${em ?? 0}`;
}

export function lerVistas(usuarioId: number): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(chaveVistas(usuarioId)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function marcarVistas(usuarioId: number, chaves: string[]): void {
  try {
    const todas = lerVistas(usuarioId);
    chaves.forEach((c) => todas.add(c));
    // Só as mais recentes: a lista não cresce para sempre.
    localStorage.setItem(chaveVistas(usuarioId), JSON.stringify([...todas].slice(-500)));
  } catch {
    // Armazenamento bloqueado: o pop-up volta na próxima abertura.
  }
}

/** A resposta e as fotos da etapa ainda são as que foram reprovadas? */
export function etapaAlterada(
  enviado: EnviadoNaEtapa,
  atual: { resposta?: Resposta; midias: string[]; cabecalho: Record<string, string> },
): boolean {
  if ('cabecalho' in enviado) {
    const chaves = new Set([...Object.keys(enviado.cabecalho), ...Object.keys(atual.cabecalho)]);
    return [...chaves].some((c) => (enviado.cabecalho[c] ?? '') !== (atual.cabecalho[c] ?? ''));
  }
  const antes = enviado.resposta ?? null;
  const agora = atual.resposta ?? null;
  const mudouValor = JSON.stringify(antes?.valor ?? null) !== JSON.stringify(agora?.valor ?? null);
  const mudouObservacao = (antes?.observacao ?? '') !== (agora?.observacao ?? '');
  const fotosAntes = [...enviado.midias].map((u) => u.toLowerCase()).sort().join(',');
  const fotosAgora = [...atual.midias].map((u) => u.toLowerCase()).sort().join(',');
  return mudouValor || mudouObservacao || fotosAntes !== fotosAgora;
}
