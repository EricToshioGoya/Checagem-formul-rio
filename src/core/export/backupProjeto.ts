import { db } from '../db/db';
import { ProjetoRepository } from '../db/repositorios';
import { baixarBlob } from '../../shared/utils/download';
import { nomeArquivoExportacao, normalizarParaArquivo } from '../../shared/utils/texto';
import { validarPacote } from './pacoteSchema';
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
  const preenchimentos = await db.preenchimentos
    .where('tagId')
    .anyOf(tags.map((t) => t.id!))
    .toArray();
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

/**
 * Lê um `.zip` gerado por `exportarProjeto` e cria uma cópia local do projeto.
 *
 * Tudo é validado antes da primeira escrita, e a escrita acontece em uma
 * transação só: ou o projeto entra inteiro, ou o banco fica como estava. Um
 * pacote corrompido não pode deixar meio projeto gravado — nem escolher a
 * chave primária, o que antes acontecia porque o objeto do arquivo era
 * repassado ao Dexie inteiro.
 */
export async function importarProjeto(arquivo: File | Blob): Promise<number> {
  const { default: JSZip } = await import('jszip');
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(arquivo);
  } catch {
    throw new Error('O arquivo escolhido não é um .zip de exportação de projeto.');
  }

  const dados = zip.file(ARQUIVO_DADOS);
  if (!dados) throw new Error('Arquivo inválido: projeto.json não encontrado no ZIP.');

  let bruto: unknown;
  try {
    bruto = JSON.parse(await dados.async('string'));
  } catch {
    throw new Error('O projeto.json dentro do ZIP está corrompido.');
  }

  if (typeof bruto === 'object' && bruto !== null && 'versao' in bruto) {
    const versao = (bruto as { versao: unknown }).versao;
    if (versao !== VERSAO) {
      throw new Error(`Versão de backup não suportada (${String(versao)}).`);
    }
  }

  const pacote = validarPacote(bruto);

  // As fotos são lidas antes da transação: o Dexie não permite `await` de
  // outra origem dentro dela.
  const fotos = new Map<string, Blob>();
  for (const m of pacote.midias) {
    const entrada = zip.file(`fotos/${m.arquivo}`);
    if (entrada) fotos.set(m.arquivo, await entrada.async('blob'));
  }

  const agora = Date.now();
  return db.transaction(
    'rw',
    db.projetos,
    db.tags,
    db.preenchimentos,
    db.midias,
    async () => {
      // Campo a campo de propósito: repassar o objeto do arquivo deixaria ele
      // escolher o `id` do projeto e trazer campos desconhecidos.
      const projetoId = await db.projetos.add({
        empresa: pacote.projeto.empresa,
        nomeProjeto: `${pacote.projeto.nomeProjeto} (importado)`,
        operador: pacote.projeto.operador,
        numeroPedido: pacote.projeto.numeroPedido,
        criadoEm: pacote.projeto.criadoEm,
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
          respostas: p.respostas as Preenchimento['respostas'],
          atualizadoEm: p.atualizadoEm,
        });
        mapaPreenchimentos.set(p.chave, id);
      }

      for (const m of pacote.midias) {
        const preenchimentoId = mapaPreenchimentos.get(m.preenchimentoChave);
        const blob = fotos.get(m.arquivo);
        if (!preenchimentoId || !blob) continue;
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
    },
  );
}
