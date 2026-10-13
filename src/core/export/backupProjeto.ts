import { db } from '../db/db';
import { ProjetoRepository } from '../db/repositorios';
import { baixarBlob } from '../../shared/utils/download';
import { nomeArquivoExportacao, normalizarParaArquivo } from '../../shared/utils/texto';
import type { Midia, Preenchimento, Projeto, Tag } from '../db/tipos';

const VERSAO = 1;
const ARQUIVO_DADOS = 'projeto.json';

interface MidiaSerializada extends Omit<Midia, 'blob' | 'id'> {
  arquivo: string;
}

interface Pacote {
  versao: number;
  exportadoEm: string;
  projeto: Omit<Projeto, 'id'>;
  tags: (Omit<Tag, 'id' | 'projetoId'> & { chave: number })[];
  preenchimentos: (Omit<Preenchimento, 'id' | 'tagId'> & { chave: number; tagChave: number })[];
  midias: (Omit<MidiaSerializada, 'preenchimentoId'> & { preenchimentoChave: number })[];
}

/**
 * Cópia de arquivo do projeto: um `.zip` com o JSON dos dados e as fotos, para
 * guardar ou enviar. Não é uma forma de levar o projeto a outro aparelho — isso
 * é a sincronização com a conta, que mantém o painel, o acesso e o andamento.
 */
export async function exportarProjeto(projetoId: number): Promise<void> {
  const projeto = await ProjetoRepository.obter(projetoId);
  if (!projeto) throw new Error('Projeto não encontrado.');

  const tags = await ProjetoRepository.listarTags(projetoId);
  // Só o fluxo de projeto/TAG entra no backup; solicitações de certificação
  // têm ciclo próprio e não viajam neste pacote.
  const preenchimentos = (
    await db.preenchimentos
      .where('tagId')
      .anyOf(tags.map((t) => t.id!))
      .toArray()
  ).filter((p): p is Preenchimento & { id: number; tagId: number } => p.tagId !== undefined);
  const midias = await db.midias
    .where('preenchimentoId')
    .anyOf(preenchimentos.map((p) => p.id!))
    .toArray();

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const pasta = zip.folder('fotos')!;

  const pacote: Pacote = {
    versao: VERSAO,
    exportadoEm: new Date().toISOString(),
    projeto: {
      empresa: projeto.empresa,
      nomeProjeto: projeto.nomeProjeto,
      operador: projeto.operador,
      numeroPedido: projeto.numeroPedido,
      criadoEm: projeto.criadoEm,
      atualizadoEm: projeto.atualizadoEm,
    },
    tags: tags.map((t) => ({ chave: t.id!, nome: t.nome, ordem: t.ordem, formIds: t.formIds })),
    preenchimentos: preenchimentos.map((p) => ({
      chave: p.id!,
      tagChave: p.tagId,
      formId: p.formId,
      formRevisao: p.formRevisao,
      cabecalho: p.cabecalho,
      respostas: p.respostas,
      atualizadoEm: p.atualizadoEm,
    })),
    midias: midias.map((m, i) => {
      const extensao = m.mime === 'application/pdf' ? 'pdf' : 'jpg';
      const nome = `${i + 1}_${normalizarParaArquivo(m.etapaId)}.${extensao}`;
      pasta.file(nome, m.blob);
      return {
        preenchimentoChave: m.preenchimentoId,
        etapaId: m.etapaId,
        arquivo: nome,
        mime: m.mime,
        largura: m.largura,
        altura: m.altura,
        tamanho: m.tamanho,
        nomeOriginal: m.nomeOriginal,
        criadoEm: m.criadoEm,
        ordem: m.ordem,
      };
    }),
  };

  zip.file(ARQUIVO_DADOS, JSON.stringify(pacote, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  baixarBlob(
    blob,
    nomeArquivoExportacao(projeto.empresa, projeto.nomeProjeto, 'BACKUP', 'zip'),
  );
}
