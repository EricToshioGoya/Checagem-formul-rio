import { ehMimeDeVideo, extensaoDoMime } from '../../../compartilhado/midias';
import { infoDoTipo, type TipoChecklist } from '../../../compartilhado/tiposChecklist';
import {
  etapasImpressas,
  montarDossie,
  montarDossieSolicitacao,
  type Dossie,
} from './dossie';
import { formulariosDoPainel } from '../forms/catalogo';
import { somarProgresso } from '../forms/progresso';
import type { OpcoesExportacao } from './ExportTarget';
import {
  nomeArquivoExportacao,
  nomeSemRepetir,
  normalizarParaArquivo,
} from '../../shared/utils/texto';

export interface ArquivoGerado {
  nome: string;
  blob: Blob;
  /** Só nos PDFs: os dados com que o arquivo é guardado no servidor. */
  registro?: {
    empresa: string;
    nomeProjeto: string;
    titulo: string;
    painelSlug?: string;
    emitidoEm: number;
    /**
     * Só no PDF do projeto: o tipo de verificação e, por TAG (`uid`), os
     * checklists que o PDF leva. É o que segue para a aprovação.
     */
    verificacao?: { tipo: string; formIdsPorTag: Record<string, string[]> };
  };
}

function rotuloTipo(tipo: TipoChecklist): string {
  return infoDoTipo(tipo).tituloPdf;
}

function sufixoTipo(tipo: TipoChecklist): string {
  return infoDoTipo(tipo).sufixoArquivo;
}

/**
 * ZIP com as fotos e os vídeos do dossiê, nomeados `TAG_ETAPA_N.jpg` (ou
 * `.mp4`, `.mov`…) — as mesmas etapas que o PDF imprime. Nome repetido (duas
 * TAGs que viram o mesmo nome de arquivo, dois checklists com a mesma
 * numeração) ganha sufixo, em vez de um arquivo sobrescrever o outro.
 * Com `somenteVideos`, leva só os vídeos — numerados entre os vídeos da
 * etapa, como o PDF os cita.
 * JSZip e pdf-lib entram por importação dinâmica: o primeiro carregamento da
 * aplicação no celular não paga o custo das bibliotecas de exportação.
 */
async function montarZipMidias(dossie: Dossie, somenteVideos = false): Promise<Blob | null> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const usados = new Set<string>();
  let quantidade = 0;

  for (const tag of dossie.tags) {
    for (const formulario of tag.formularios) {
      for (const etapa of etapasImpressas(formulario)) {
        const lista = formulario.midiasPorEtapa[etapa.id] ?? [];
        (somenteVideos ? lista.filter((m) => ehMimeDeVideo(m.mime)) : lista).forEach((midia, i) => {
          const extensao = extensaoDoMime(midia.mime);
          const base = `${normalizarParaArquivo(tag.nome)}_${normalizarParaArquivo(etapa.id)}_${i + 1}`;
          zip.file(nomeSemRepetir(usados, base, extensao), midia.blob);
          quantidade += 1;
        });
      }
    }
  }

  if (quantidade === 0) return null;
  return zip.generateAsync({ type: 'blob' });
}

/**
 * O PDF do dossiê e, quando as fotos não vão embutidas, o ZIP com elas. Com
 * as fotos embutidas, os vídeos (que não cabem num PDF) seguem num ZIP só deles.
 * `sufixo` entra no nome do arquivo depois de empresa e projeto.
 */
async function arquivosDoDossie(
  dossie: Dossie,
  opcoes: { incluirFotos: boolean; titulo: string; sufixo: string },
): Promise<ArquivoGerado[]> {
  const [{ gerarPdf }, { carregarFontesPdf }] = await Promise.all([
    import('./pdf/documento'),
    import('./pdf/carregarFontes'),
  ]);
  const fontes = await carregarFontesPdf();
  const arquivos: ArquivoGerado[] = [];
  const zip = await montarZipMidias(dossie, opcoes.incluirFotos);
  const nomeZip = zip
    ? nomeArquivoExportacao(
        dossie.empresa,
        dossie.nomeProjeto,
        `${opcoes.sufixo}-${opcoes.incluirFotos ? 'VIDEOS' : 'FOTOS'}`,
        'zip',
        dossie.geradoEm,
      )
    : undefined;

  arquivos.push({
    nome: nomeArquivoExportacao(dossie.empresa, dossie.nomeProjeto, opcoes.sufixo, 'pdf', dossie.geradoEm),
    blob: await gerarPdf(dossie, {
      incluirFotos: opcoes.incluirFotos,
      titulo: opcoes.titulo,
      arquivoFotos: opcoes.incluirFotos ? undefined : nomeZip,
      arquivoVideos: opcoes.incluirFotos ? nomeZip : undefined,
      fontes,
    }),
    registro: {
      empresa: dossie.empresa,
      nomeProjeto: dossie.nomeProjeto,
      titulo: opcoes.titulo,
      painelSlug: dossie.painelSlug,
      emitidoEm: dossie.geradoEm.getTime(),
    },
  });
  if (zip && nomeZip) arquivos.push({ nome: nomeZip, blob: zip });
  return arquivos;
}

/**
 * Gera um arquivo por tipo de verificação selecionado. As fotos vão embutidas
 * no PDF ou em um ZIP separado, conforme a escolha do montador.
 */
export async function gerarArquivos(
  projetoId: number,
  opcoes: OpcoesExportacao & { incluirFotos: boolean },
): Promise<ArquivoGerado[]> {
  const dossieCompleto = await montarDossie(projetoId, { formIds: opcoes.formIds });
  const tiposPresentes = Array.from(
    new Set(
      dossieCompleto.tags.flatMap((t) => t.formularios.map((f) => f.definicao.tipo)),
    ),
  );
  const arquivos: ArquivoGerado[] = [];
  const doPainel = await formulariosDoPainel(dossieCompleto.painelSlug);
  // Só o PDF com todos os checklists do tipo vai para aprovação: um PDF
  // parcial substituiria, na fila, a versão completa que aguardava.
  const completo = (tipo: string) =>
    !opcoes.formIds?.length ||
    doPainel.filter((e) => e.tipo === tipo).every((e) => opcoes.formIds!.includes(e.id));

  for (const tipo of tiposPresentes) {
    // TAG sem checklist deste tipo não entra no PDF dele.
    const tags = dossieCompleto.tags
      .map((t) => ({ ...t, formularios: t.formularios.filter((f) => f.definicao.tipo === tipo) }))
      .filter((t) => t.formularios.length > 0);
    const dossie: Dossie = {
      ...dossieCompleto,
      tags,
      progressoGeral: somarProgresso(tags.flatMap((t) => t.formularios.map((f) => f.progresso))),
    };
    const gerados = await arquivosDoDossie(dossie, {
      incluirFotos: opcoes.incluirFotos,
      titulo: rotuloTipo(tipo),
      sufixo: sufixoTipo(tipo),
    });
    const pdf = gerados.find((a) => a.registro);
    if (pdf?.registro && completo(tipo) && tags.every((t) => t.uid)) {
      pdf.registro.verificacao = {
        tipo,
        formIdsPorTag: Object.fromEntries(tags.map((t) => [t.uid!, t.formularios.map((f) => f.definicao.id)])),
      };
    }
    arquivos.push(...gerados);
  }

  return arquivos;
}

/** O alvo de um PDF de checklist único: o de uma TAG do projeto ou o de uma solicitação. */
export type AlvoChecklist =
  | { projetoId: number; tagId: number; formId: string }
  | { solicitacaoId: number };

/** PDF de um checklist só — o que a tela de preenchimento tem aberto. */
export async function gerarArquivosChecklist(
  alvo: AlvoChecklist,
  incluirFotos: boolean,
): Promise<ArquivoGerado[]> {
  const dossie =
    'solicitacaoId' in alvo
      ? await montarDossieSolicitacao(alvo.solicitacaoId)
      : await montarDossie(alvo.projetoId, { formIds: [alvo.formId], tagIds: [alvo.tagId] });
  const tag = dossie.tags[0];
  const formulario = tag?.formularios[0];
  if (!tag || !formulario) {
    throw new Error('Este checklist não está mais disponível neste painel.');
  }
  // Painel com mais de um checklist do mesmo tipo: o id do checklist entra no
  // nome, para os dois PDFs da mesma TAG não saírem com o mesmo arquivo.
  const doMesmoTipo = (await formulariosDoPainel(dossie.painelSlug)).filter(
    (e) => e.tipo === formulario.definicao.tipo,
  ).length;
  return arquivosDoDossie(dossie, {
    incluirFotos,
    titulo: formulario.definicao.nome,
    sufixo: `${tag.nome}-${doMesmoTipo > 1 ? formulario.definicao.id : sufixoTipo(formulario.definicao.tipo)}`,
  });
}
