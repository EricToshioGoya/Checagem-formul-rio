import { solicitacaoStore } from '../certificacao';
import { obterPainel } from '../paineis/catalogo';
import { dataIso, normalizarParaArquivo } from '../../shared/utils/texto';
import { carregarTemplateCertificado } from './catalogo';
import { montarContexto } from './contexto';

export interface ArquivoCertificado {
  nome: string;
  blob: Blob;
  numero: string;
}

/**
 * Gera o PDF do certificado de uma solicitação aprovada.
 *
 * A geração exige aprovação explícita do responsável ABB: sem o registro de
 * emissão criado na aprovação, esta função recusa. O `pdf-lib` entra por
 * importação dinâmica, como no dossiê.
 */
export async function gerarPdfCertificado(
  solicitacaoId: number,
): Promise<ArquivoCertificado> {
  const solicitacao = await solicitacaoStore.obter(solicitacaoId);
  if (!solicitacao) throw new Error('Solicitação não encontrada.');
  if (!solicitacao.numeroCertificado) {
    throw new Error(
      'O certificado só pode ser gerado após a aprovação do responsável ABB.',
    );
  }

  const certificado = await solicitacaoStore.obterCertificadoPorSolicitacao(solicitacaoId);
  if (!certificado) throw new Error('Registro de emissão não encontrado.');

  const painel = await obterPainel(solicitacao.tipoPainel);
  if (!painel.certificado) {
    throw new Error(`O painel "${painel.nome}" não tem template de certificado.`);
  }

  const template = await carregarTemplateCertificado(painel.certificado);
  const { gerarCertificado } = await import('./documento');
  const blob = await gerarCertificado(template, montarContexto(certificado, painel));

  const nome = [
    'CERTIFICADO',
    normalizarParaArquivo(certificado.numero),
    normalizarParaArquivo(certificado.tagPainel),
    dataIso(new Date(certificado.emitidoEm)),
  ].join('_');

  return { nome: `${nome}.pdf`, blob, numero: certificado.numero };
}
