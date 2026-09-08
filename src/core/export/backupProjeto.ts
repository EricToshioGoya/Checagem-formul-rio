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
 * Mitigação da limitação conhecida (seção 12): sem sincronização entre
 * dispositivos, o projeto viaja em um `.zip` com o JSON dos dados e as fotos.
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
      tipoPainel: projeto.tipoPainel,
      empresa: projeto.empresa,
      nomeProjeto: projeto.nomeProjeto,
      operador: projeto.operador,
      numeroPedido: projeto.numeroPedido,
      painel: projeto.painel,
      criadoEm: projeto.criadoEm,
      atualizadoEm: projeto.atualizadoEm,
    },
    tags: tags.map((t) => ({ chave: t.id!, nome: t.nome, ordem: t.ordem })),
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

/** Lê um `.zip` gerado por `exportarProjeto` e cria uma cópia local do projeto. */
export async function importarProjeto(arquivo: File | Blob): Promise<number> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(arquivo);
  const dados = zip.file(ARQUIVO_DADOS);
  if (!dados) throw new Error('Arquivo inválido: projeto.json não encontrado no ZIP.');

  const pacote = JSON.parse(await dados.async('string')) as Pacote;
  if (pacote.versao !== VERSAO) {
    throw new Error(`Versão de backup não suportada (${pacote.versao}).`);
  }

  const agora = Date.now();
  const projetoId = await db.projetos.add({
    ...pacote.projeto,
    nomeProjeto: `${pacote.projeto.nomeProjeto} (importado)`,
    atualizadoEm: agora,
  });

  const mapaTags = new Map<number, number>();
  for (const tag of pacote.tags) {
    const id = await db.tags.add({ projetoId, nome: tag.nome, ordem: tag.ordem });
    mapaTags.set(tag.chave, id);
  }

  const mapaPreenchimentos = new Map<number, number>();
  for (const p of pacote.preenchimentos) {
    const tagId = mapaTags.get(p.tagChave);
    if (!tagId) continue;
    const id = await db.preenchimentos.add({
      tagId,
      formId: p.formId,
      formRevisao: p.formRevisao,
      cabecalho: p.cabecalho,
      respostas: p.respostas,
      atualizadoEm: p.atualizadoEm,
    });
    mapaPreenchimentos.set(p.chave, id);
  }

  for (const m of pacote.midias) {
    const preenchimentoId = mapaPreenchimentos.get(m.preenchimentoChave);
    const entrada = zip.file(`fotos/${m.arquivo}`);
    if (!preenchimentoId || !entrada) continue;
    const blob = await entrada.async('blob');
    await db.midias.add({
      preenchimentoId,
      etapaId: m.etapaId,
      blob: new Blob([blob], { type: m.mime }),
      mime: m.mime,
      largura: m.largura,
      altura: m.altura,
      tamanho: m.tamanho,
      nomeOriginal: m.nomeOriginal,
      criadoEm: m.criadoEm,
      ordem: m.ordem,
    });
  }

  return projetoId;
}
