import { db } from '../db';
import type { PdfPendente } from '../tipos';

/** Fila dos PDFs emitidos neste aparelho que ainda não chegaram ao servidor. */
export const PdfPendenteRepository = {
  async adicionar(pdf: Omit<PdfPendente, 'id'>): Promise<void> {
    await db.pdfsPendentes.add(pdf);
  },

  /** Os da conta, do mais antigo ao mais novo. */
  listar(usuarioId: number): Promise<PdfPendente[]> {
    return db.pdfsPendentes.where('usuarioId').equals(usuarioId).sortBy('criadoEm');
  },

  porUids(uids: string[]): Promise<PdfPendente[]> {
    return db.pdfsPendentes.where('uid').anyOf(uids).toArray();
  },

  async remover(id: number): Promise<void> {
    await db.pdfsPendentes.delete(id);
  },

  /** O PDF chegou ao arquivo; a entrada fica até a aprovação ser concluída. */
  async marcarPdfEnviado(id: number): Promise<void> {
    await db.pdfsPendentes.update(id, { pdfEnviado: true });
  },

  async recusar(id: number, motivo: string): Promise<void> {
    await db.pdfsPendentes.update(id, { recusa: motivo });
  },
};
