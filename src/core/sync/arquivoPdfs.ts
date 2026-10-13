import { api, consulta, ErroApi } from '../api/cliente';
import { novoUid } from '../db/db';
import { PdfPendenteRepository } from '../db/repositorios';
import type { ArquivoGerado } from '../export/PdfExport';

/**
 * Arquivo dos PDFs emitidos no servidor — a documentação que valida a
 * garantia ABB em caso de falha ou quebra do material.
 *
 * Todo PDF de checklist gerado entra numa fila no aparelho e segue para o
 * servidor na hora, se houver rede, ou na próxima sincronização. O `uid` de
 * cada um torna o envio idempotente: uma queda no meio não duplica nada.
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

async function enviarUmaVez(usuarioId: number): Promise<void> {
  for (const pdf of await PdfPendenteRepository.listar(usuarioId)) {
    if (pdf.recusa) continue;
    try {
      await api.enviarArquivo(
        `/api/pdfs/${pdf.uid}${consulta({
          empresa: pdf.empresa,
          projeto: pdf.nomeProjeto,
          titulo: pdf.titulo,
          painel: pdf.painelSlug,
          nomeArquivo: pdf.nomeArquivo,
          emitidoEm: pdf.emitidoEm,
        })}`,
        pdf.blob,
      );
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
}

/** Coloca os PDFs gerados na fila e tenta enviá-los já. */
export async function registrarPdfs(
  usuarioId: number,
  arquivos: ArquivoGerado[],
): Promise<SituacaoRegistro> {
  const uids: string[] = [];
  for (const arquivo of arquivos) {
    if (!arquivo.registro) continue;
    const uid = novoUid();
    uids.push(uid);
    await PdfPendenteRepository.adicionar({
      uid,
      usuarioId,
      ...arquivo.registro,
      nomeArquivo: arquivo.nome,
      blob: arquivo.blob,
      criadoEm: Date.now(),
    });
  }
  await enviarPdfsPendentes(usuarioId);
  const restantes = await PdfPendenteRepository.porUids(uids);
  return {
    pendentes: restantes.filter((p) => !p.recusa).length,
    recusas: restantes.flatMap((p) => (p.recusa ? [p.recusa] : [])),
  };
}
