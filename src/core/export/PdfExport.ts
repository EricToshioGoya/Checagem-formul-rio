import { montarDossie, type Dossie } from './dossie';
import type { ExportTarget, OpcoesExportacao } from './ExportTarget';
import type { Projeto } from '../db/tipos';
import { baixarBlob } from '../../shared/utils/download';
import { nomeArquivoExportacao, normalizarParaArquivo } from '../../shared/utils/texto';

export interface ArquivoGerado {
  nome: string;
  blob: Blob;
}

function rotuloTipo(tipo: 'montagem' | 'rotina'): string {
  return tipo === 'montagem' ? 'Verificação de Montagem' : 'Verificação de Rotina';
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
          const nome = `${normalizarParaArquivo(tag.tag.nome)}_${normalizarParaArquivo(
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
 * Gera um arquivo por tipo de verificação selecionado. As fotos vão embutidas
 * no PDF ou em um ZIP separado, conforme a escolha do montador.
 */
export async function gerarArquivos(
  projetoId: number,
  opcoes: OpcoesExportacao & { incluirFotos: boolean },
): Promise<ArquivoGerado[]> {
  const { gerarPdf } = await import('./pdf/documento');
  const dossieCompleto = await montarDossie(projetoId, opcoes.formIds);
  const tiposPresentes = Array.from(
    new Set(
      dossieCompleto.tags.flatMap((t) => t.formularios.map((f) => f.definicao.tipo)),
    ),
  );
  const arquivos: ArquivoGerado[] = [];

  for (const tipo of tiposPresentes) {
    const dossie: Dossie = {
      ...dossieCompleto,
      tags: dossieCompleto.tags.map((t) => ({
        ...t,
        formularios: t.formularios.filter((f) => f.definicao.tipo === tipo),
      })),
    };

    const pdf = await gerarPdf(dossie, {
      incluirFotos: opcoes.incluirFotos,
      tituloTipo: rotuloTipo(tipo),
    });
    arquivos.push({
      nome: nomeArquivoExportacao(
        dossie.projeto.empresa,
        dossie.projeto.nomeProjeto,
        tipo === 'montagem' ? 'MONTAGEM' : 'ROTINA',
        'pdf',
        dossie.geradoEm,
      ),
      blob: pdf,
    });

    if (!opcoes.incluirFotos) {
      const zip = await montarZipFotos(dossie);
      if (zip) {
        arquivos.push({
          nome: nomeArquivoExportacao(
            dossie.projeto.empresa,
            dossie.projeto.nomeProjeto,
            tipo === 'montagem' ? 'MONTAGEM-FOTOS' : 'ROTINA-FOTOS',
            'zip',
            dossie.geradoEm,
          ),
          blob: zip,
        });
      }
    }
  }

  return arquivos;
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
