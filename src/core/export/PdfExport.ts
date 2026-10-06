import { montarDossie, montarDossieSolicitacao, somarProgresso, type Dossie } from './dossie';
import type { ExportTarget, OpcoesExportacao } from './ExportTarget';
import type { Projeto } from '../db/tipos';
import { baixarBlob } from '../../shared/utils/download';
import { nomeArquivoExportacao, normalizarParaArquivo } from '../../shared/utils/texto';

export interface ArquivoGerado {
  nome: string;
  blob: Blob;
}

type TipoChecklist = 'montagem' | 'rotina';

function rotuloTipo(tipo: TipoChecklist): string {
  return tipo === 'montagem' ? 'Verificação de Montagem' : 'Verificação de Rotina';
}

function sufixoTipo(tipo: TipoChecklist): string {
  return tipo === 'montagem' ? 'MONTAGEM' : 'ROTINA';
}

/**
 * ZIP com as fotos do dossiê, nomeadas `TAG_ETAPA_N.jpg`.
 * JSZip e pdf-lib entram por importação dinâmica: o primeiro carregamento da
 * aplicação no celular não paga o custo das bibliotecas de exportação.
 */
async function montarZipFotos(dossie: Dossie): Promise<Blob | null> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  let quantidade = 0;

  for (const tag of dossie.tags) {
    for (const formulario of tag.formularios) {
      for (const [etapaId, lista] of Object.entries(formulario.midiasPorEtapa)) {
        lista.forEach((midia, i) => {
          const extensao = midia.mime === 'application/pdf' ? 'pdf' : 'jpg';
          const nome = `${normalizarParaArquivo(tag.nome)}_${normalizarParaArquivo(
            etapaId,
          )}_${i + 1}.${extensao}`;
          zip.file(nome, midia.blob);
          quantidade += 1;
        });
      }
    }
  }

  if (quantidade === 0) return null;
  return zip.generateAsync({ type: 'blob' });
}

/**
 * O PDF do dossiê e, quando as fotos não vão embutidas, o ZIP com elas.
 * `sufixo` entra no nome do arquivo depois de empresa e projeto.
 */
async function arquivosDoDossie(
  dossie: Dossie,
  opcoes: { incluirFotos: boolean; titulo: string; sufixo: string },
): Promise<ArquivoGerado[]> {
  const { gerarPdf } = await import('./pdf/documento');
  const arquivos: ArquivoGerado[] = [];
  const zip = opcoes.incluirFotos ? null : await montarZipFotos(dossie);
  const nomeZip = zip
    ? nomeArquivoExportacao(dossie.empresa, dossie.nomeProjeto, `${opcoes.sufixo}-FOTOS`, 'zip', dossie.geradoEm)
    : undefined;

  arquivos.push({
    nome: nomeArquivoExportacao(dossie.empresa, dossie.nomeProjeto, opcoes.sufixo, 'pdf', dossie.geradoEm),
    blob: await gerarPdf(dossie, {
      incluirFotos: opcoes.incluirFotos,
      titulo: opcoes.titulo,
      arquivoFotos: nomeZip,
    }),
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
    arquivos.push(
      ...(await arquivosDoDossie(dossie, {
        incluirFotos: opcoes.incluirFotos,
        titulo: rotuloTipo(tipo),
        sufixo: sufixoTipo(tipo),
      })),
    );
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
  return arquivosDoDossie(dossie, {
    incluirFotos,
    titulo: formulario.definicao.nome,
    sufixo: `${tag.nome}-${sufixoTipo(formulario.definicao.tipo)}`,
  });
}

/** Implementação de `ExportTarget` da v1: gera e baixa os arquivos localmente. */
export class PdfExport implements ExportTarget {
  readonly nome = 'PDF para download';

  async exportar(projeto: Projeto, opcoes: OpcoesExportacao = {}): Promise<void> {
    if (!projeto.id) throw new Error('Projeto sem identificador.');
    const arquivos = await gerarArquivos(projeto.id, {
      formIds: opcoes.formIds,
      incluirFotos: opcoes.incluirFotos ?? true,
    });
    for (const arquivo of arquivos) {
      baixarBlob(arquivo.blob, arquivo.nome);
    }
  }
}

export const destinosDisponiveis: ExportTarget[] = [new PdfExport()];
