import type { Certificado } from '../db/tipos';
import type { Painel } from '../paineis/tipos';
import { dataBr } from '../../shared/utils/texto';
import type { ContextoCertificado } from './tipos';

/**
 * Achata o certificado emitido e o responsável ABB em um mapa plano de
 * marcadores. Um campo novo no template só precisa aparecer aqui.
 */
export function montarContexto(
  certificado: Certificado,
  painel: Painel,
): ContextoCertificado {
  const responsavel = painel.responsavel;
  return {
    numeroCertificado: certificado.numero,
    dataEmissao: dataBr(certificado.emitidoEm),
    projeto: certificado.projeto,
    clienteFinal: certificado.clienteFinal,
    tagPainel: certificado.tagPainel,
    correnteNominal: certificado.correnteNominal,
    correnteCurtoCircuito: certificado.correnteCurtoCircuito,
    montador: certificado.montador,
    nomePainel: certificado.nomePainel,
    'responsavel.nome': responsavel?.nome ?? '',
    'responsavel.cargo': responsavel?.cargo ?? '',
    'responsavel.area': responsavel?.area ?? '',
    'responsavel.empresa': responsavel?.empresa ?? '',
    'responsavel.email': responsavel?.email ?? '',
  };
}

/** Substitui `{{campo}}` pelos valores do contexto. Marcador sem valor sai vazio. */
export function aplicarMarcadores(texto: string, contexto: ContextoCertificado): string {
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, chave: string) => contexto[chave] ?? '');
}
