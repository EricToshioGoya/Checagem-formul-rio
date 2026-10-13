import { z } from 'zod';
import type JSZip from 'jszip';
import { db } from '../db/db';
import { ProjetoRepository } from '../db/repositorios';
import { descreverErro } from '../forms/schema';
import { MAX_TAMANHO_MIDIA, MIMES_PERMITIDOS, conferirAssinatura } from '../media/tipoArquivo';
import { baixarBlob } from '../../shared/utils/download';
import {
  formatarBytes,
  nomeArquivoExportacao,
  normalizarParaArquivo,
} from '../../shared/utils/texto';
import type { Midia, Preenchimento, Projeto, Tag } from '../db/tipos';

const VERSAO = 1;
const ARQUIVO_DADOS = 'projeto.json';

/** Limites da importação: um backup legítimo fica muito abaixo deles. */
const MAX_TAMANHO_BACKUP = 300 * 1024 * 1024;
const MAX_TAMANHO_DADOS = 50 * 1024 * 1024;
const MAX_MIDIAS = 5000;

const texto = z.string().max(20_000);
const inteiro = z.number().int();

const respostaSchema = z.object({
  valor: z.union([
    z.boolean(),
    z.number(),
    texto,
    z.record(z.string(), z.record(z.string(), z.number().nullable())),
    z.null(),
  ]),
  observacao: texto.optional(),
});

/**
 * O `.zip` importado vem de fora do aparelho: todo o conteúdo é validado
 * antes de chegar à base. Chaves desconhecidas são descartadas.
 */
const pacoteSchema = z.object({
  versao: z.literal(VERSAO),
  projeto: z.object({
    empresa: texto,
    nomeProjeto: texto,
    operador: texto,
    numeroPedido: texto.optional(),
    criadoEm: z.number(),
    atualizadoEm: z.number(),
  }),
  tags: z.array(z.object({ chave: inteiro, nome: texto, ordem: inteiro })),
  preenchimentos: z.array(
    z.object({
      chave: inteiro,
      tagChave: inteiro,
      formId: texto,
      formRevisao: texto,
      cabecalho: z.record(z.string(), texto),
      respostas: z.record(z.string(), respostaSchema),
      atualizadoEm: z.number(),
    }),
  ),
  midias: z
    .array(
      z.object({
        preenchimentoChave: inteiro,
        etapaId: texto,
        arquivo: z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/),
        mime: z.enum(MIMES_PERMITIDOS),
        largura: z.number().nonnegative(),
        altura: z.number().nonnegative(),
        nomeOriginal: texto.optional(),
        criadoEm: z.number(),
        ordem: inteiro,
      }),
    )
    .max(MAX_MIDIAS),
});

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

/** `ZipObject#internalStream` é API documentada do JSZip, mas falta nas tipagens. */
type EntradaZip = JSZip.JSZipObject & {
  internalStream(tipo: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
};

/**
 * Descompacta uma entrada do ZIP interrompendo assim que passar do limite,
 * para que um arquivo muito comprimido não esgote a memória do aparelho.
 */
function lerLimitado(
  entrada: JSZip.JSZipObject,
  limite: number,
  descricao: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const partes: Uint8Array[] = [];
    let total = 0;
    const fluxo = (entrada as EntradaZip).internalStream('uint8array');
    fluxo
      .on('data', (parte) => {
        total += parte.length;
        if (total > limite) {
          fluxo.pause();
          reject(new Error(`Arquivo inválido: ${descricao} passa de ${formatarBytes(limite)}.`));
          return;
        }
        partes.push(parte);
      })
      .on('error', reject)
      .on('end', () => {
        const saida = new Uint8Array(total);
        let posicao = 0;
        for (const parte of partes) {
          saida.set(parte, posicao);
          posicao += parte.length;
        }
        resolve(saida);
      })
      .resume();
  });
}

/** Lê um `.zip` gerado por `exportarProjeto` e cria uma cópia local do projeto. */
export async function importarProjeto(arquivo: File | Blob): Promise<number> {
  if (arquivo.size > MAX_TAMANHO_BACKUP) {
    throw new Error(`Arquivo grande demais (limite de ${formatarBytes(MAX_TAMANHO_BACKUP)}).`);
  }
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(arquivo);
  const dados = zip.file(ARQUIVO_DADOS);
  if (!dados) throw new Error('Arquivo inválido: projeto.json não encontrado no ZIP.');

  const bruto: unknown = JSON.parse(
    new TextDecoder().decode(await lerLimitado(dados, MAX_TAMANHO_DADOS, ARQUIVO_DADOS)),
  );
  const versao = (bruto as { versao?: unknown } | null)?.versao;
  if (versao !== VERSAO) {
    throw new Error(`Versão de backup não suportada (${String(versao)}).`);
  }
  const analise = pacoteSchema.safeParse(bruto);
  if (!analise.success) {
    throw new Error(`Arquivo inválido:\n${descreverErro(analise.error)}`);
  }
  const pacote = analise.data;

  // Todas as mídias são lidas e conferidas antes de qualquer gravação:
  // um arquivo recusado não deixa projeto pela metade na base.
  const midias: { dados: (typeof pacote.midias)[number]; blob: Blob }[] = [];
  for (const m of pacote.midias) {
    const entrada = zip.file(`fotos/${m.arquivo}`);
    if (!entrada) continue;
    const bytes = await lerLimitado(entrada, MAX_TAMANHO_MIDIA, `fotos/${m.arquivo}`);
    if (!conferirAssinatura(bytes, m.mime)) {
      throw new Error(`Arquivo inválido: fotos/${m.arquivo} não é do tipo declarado (${m.mime}).`);
    }
    midias.push({ dados: m, blob: new Blob([bytes], { type: m.mime }) });
  }

  return db.transaction('rw', [db.projetos, db.tags, db.preenchimentos, db.midias], async () => {
    const projetoId = await db.projetos.add({
      ...pacote.projeto,
      nomeProjeto: `${pacote.projeto.nomeProjeto} (importado)`,
      atualizadoEm: Date.now(),
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

    for (const { dados: m, blob } of midias) {
      const preenchimentoId = mapaPreenchimentos.get(m.preenchimentoChave);
      if (!preenchimentoId) continue;
      await db.midias.add({
        preenchimentoId,
        etapaId: m.etapaId,
        blob,
        mime: m.mime,
        largura: m.largura,
        altura: m.altura,
        tamanho: blob.size,
        nomeOriginal: m.nomeOriginal,
        criadoEm: m.criadoEm,
        ordem: m.ordem,
      });
    }

    return projetoId;
  });
}
