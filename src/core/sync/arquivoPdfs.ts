import { api, consulta, ErroApi } from '../api/cliente';
import { db, novoUid } from '../db/db';
import { PdfPendenteRepository, ProjetoRepository } from '../db/repositorios';
import type { AprovacaoPendente, PdfPendente } from '../db/tipos';
import type { ArquivoGerado } from '../export/PdfExport';
import { sha256Hex } from '../../shared/utils/hash';
import { montarDocumento } from './sincronizacao';

/**
 * Arquivo dos PDFs emitidos no servidor — a documentação que valida a
 * garantia ABB em caso de falha ou quebra do material.
 *
 * Todo PDF de checklist gerado entra numa fila no aparelho e segue para o
 * servidor na hora, se houver rede, ou na próxima sincronização. O `uid` de
 * cada um torna o envio idempotente: uma queda no meio não duplica nada.
 *
 * O PDF do projeto (um por tipo de verificação) vai além: depois de guardado,
 * segue para a aprovação da administração com o retrato das respostas e das
 * fotos daquele tipo, em três passos que também podem ser repetidos.
 */

/** Erro que tentar de novo não resolve: o servidor recusou este arquivo. */
function ehRecusa(erro: unknown): erro is ErroApi {
  return (
    erro instanceof ErroApi &&
    erro.status >= 400 &&
    erro.status < 500 &&
    ![401, 408, 429].includes(erro.status)
  );
}

async function enviarPdf(pdf: PdfPendente): Promise<void> {
  await api.enviarArquivo(
    `/api/pdfs/${pdf.uid}${consulta({
      empresa: pdf.empresa,
      projeto: pdf.nomeProjeto,
      titulo: pdf.titulo,
      painel: pdf.painelSlug,
      nomeArquivo: pdf.nomeArquivo,
      emitidoEm: pdf.emitidoEm,
      sha256: await sha256Hex(pdf.blob),
    })}`,
    pdf.blob,
  );
}

/**
 * Envio para aprovação: retrato, fotos que faltam e conclusão. Foto que não
 * existe mais no aparelho, ou que o servidor recusa, vai como ausente — o PDF
 * segue sendo o documento, e o envio não fica preso por ela.
 */
async function enviarAprovacao(pdf: PdfPendente, aprovacao: AprovacaoPendente): Promise<void> {
  const { faltando } = await api.post<{ faltando: string[] }>('/api/verificacoes', {
    uid: aprovacao.uid,
    pdfUid: pdf.uid,
    painelId: aprovacao.painelId,
    projetoUid: aprovacao.projetoUid,
    tipo: aprovacao.tipo,
    geradoEm: pdf.emitidoEm,
    documento: aprovacao.documento,
  });
  const ausentes: string[] = [];
  for (const midiaUid of faltando) {
    const midia = await db.midias.where('uid').equals(midiaUid).first();
    if (!midia) {
      ausentes.push(midiaUid);
      continue;
    }
    try {
      await api.enviarArquivo(
        `/api/verificacoes/${aprovacao.uid}/midias/${midiaUid}${consulta({ sha256: await sha256Hex(midia.blob) })}`,
        midia.blob.type === midia.mime ? midia.blob : new Blob([midia.blob], { type: midia.mime }),
      );
    } catch (erro) {
      if (!ehRecusa(erro)) throw erro;
      ausentes.push(midiaUid);
    }
  }
  await api.post(`/api/verificacoes/${aprovacao.uid}/concluir`, { ausentes });
}

async function enviarUmaVez(usuarioId: number): Promise<void> {
  for (const pdf of await PdfPendenteRepository.listar(usuarioId)) {
    if (pdf.recusa) continue;
    try {
      if (!pdf.pdfEnviado) {
        await enviarPdf(pdf);
        if (pdf.aprovacao) await PdfPendenteRepository.marcarPdfEnviado(pdf.id!);
      }
      if (pdf.aprovacao) await enviarAprovacao(pdf, pdf.aprovacao);
      await PdfPendenteRepository.remover(pdf.id!);
    } catch (erro) {
      if (ehRecusa(erro)) {
        await PdfPendenteRepository.recusar(pdf.id!, erro.message);
        continue;
      }
      // Sem rede, servidor fora do ar ou sessão vencida: fica para a próxima.
      return;
    }
  }
}

let fila: Promise<void> = Promise.resolve();

/**
 * Envia os PDFs da conta que estão na fila. Chamadas seguidas entram em fila,
 * uma passada depois da outra: um PDF acabado de gerar nunca fica de fora de
 * uma passada que já tinha lido a lista.
 */
export function enviarPdfsPendentes(usuarioId: number): Promise<void> {
  fila = fila.then(() => enviarUmaVez(usuarioId)).catch(() => undefined);
  return fila;
}

export interface SituacaoRegistro {
  /** Ficaram no aparelho, à espera de conexão. */
  pendentes: number;
  /** Motivos de recusa do servidor, se houver. */
  recusas: string[];
  /** PDFs que seguem para a aprovação da administração (enviados ou na fila). */
  paraAprovacao: number;
}

/**
 * O retrato do projeto restrito ao que o PDF leva: as TAGs e, de cada uma, os
 * checklists do tipo de verificação — respostas e fotos só desses.
 */
async function retratoDoTipo(
  projetoId: number,
  verificacao: NonNullable<NonNullable<ArquivoGerado['registro']>['verificacao']>,
): Promise<AprovacaoPendente | null> {
  const projeto = await ProjetoRepository.obter(projetoId);
  if (!projeto?.uid || projeto.painelId === undefined) return null;
  const { documento } = await montarDocumento(projeto);
  const doTipo = verificacao.formIdsPorTag;
  const leva = (tagUid: string, formId: string) => doTipo[tagUid]?.includes(formId) ?? false;
  return {
    uid: novoUid(),
    painelId: projeto.painelId,
    projetoUid: projeto.uid,
    tipo: verificacao.tipo,
    documento: {
      projeto: documento.projeto,
      tags: documento.tags.filter((t) => doTipo[t.uid]).map((t) => ({ ...t, formIds: doTipo[t.uid] })),
      preenchimentos: documento.preenchimentos.filter((p) => leva(p.tagUid, p.formId)),
      midias: documento.midias.filter((m) => leva(m.tagUid, m.formId)),
    },
  };
}

/**
 * Coloca os PDFs gerados na fila e tenta enviá-los já. Com `projetoId`, o PDF
 * de cada tipo de verificação leva junto o envio para aprovação.
 */
export async function registrarPdfs(
  usuarioId: number,
  arquivos: ArquivoGerado[],
  projetoId?: number,
): Promise<SituacaoRegistro> {
  const uids: string[] = [];
  let paraAprovacao = 0;
  for (const arquivo of arquivos) {
    if (!arquivo.registro) continue;
    const { verificacao, ...registro } = arquivo.registro;
    const aprovacao =
      verificacao && projetoId !== undefined ? await retratoDoTipo(projetoId, verificacao) : null;
    if (aprovacao) paraAprovacao += 1;
    const uid = novoUid();
    uids.push(uid);
    await PdfPendenteRepository.adicionar({
      uid,
      usuarioId,
      ...registro,
      nomeArquivo: arquivo.nome,
      blob: arquivo.blob,
      criadoEm: Date.now(),
      ...(aprovacao ? { aprovacao } : {}),
    });
  }
  await enviarPdfsPendentes(usuarioId);
  const restantes = await PdfPendenteRepository.porUids(uids);
  return {
    pendentes: restantes.filter((p) => !p.recusa).length,
    recusas: restantes.flatMap((p) => (p.recusa ? [p.recusa] : [])),
    paraAprovacao,
  };
}
