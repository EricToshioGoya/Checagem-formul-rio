/**
 * Tipos de checklist (montagem, rotina…).
 *
 * É o único lugar que conhece a lista de tipos: botões de criação, rótulos,
 * título e nome de arquivo do PDF e validação do servidor leem daqui. Para
 * adicionar um tipo novo, acrescente uma entrada em `TIPOS_CHECKLIST` — nada
 * mais precisa mudar.
 */

export interface TipoChecklistInfo {
  /** Identificador estável, gravado em cada checklist (minúsculas e hífen). */
  id: string;
  /** Nome curto: botões, cartões e cabeçalhos. */
  rotulo: string;
  /** Título do tipo impresso no PDF. */
  tituloPdf: string;
  /** Sufixo do nome dos arquivos exportados. */
  sufixoArquivo: string;
}

export const TIPOS_CHECKLIST = [
  {
    id: 'montagem',
    rotulo: 'Montagem',
    tituloPdf: 'Verificação de Montagem',
    sufixoArquivo: 'MONTAGEM',
  },
  {
    id: 'rotina',
    rotulo: 'Rotina',
    tituloPdf: 'Verificação de Rotina',
    sufixoArquivo: 'ROTINA',
  },
] as const satisfies readonly TipoChecklistInfo[];

/** Tipo usado quando nenhum é informado ao criar um checklist. */
export const TIPO_CHECKLIST_PADRAO = 'montagem';

/**
 * Id de tipo. É uma string aberta, e não um enum: um checklist gravado com um
 * tipo que esta versão não conhece (banco novo, app antigo) continua abrindo.
 */
export type TipoChecklist = string;

export const IDS_TIPOS_CHECKLIST = TIPOS_CHECKLIST.map((t) => t.id) as [string, ...string[]];

function capitalizar(id: string): string {
  const texto = id.replace(/-/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Dados do tipo; um id desconhecido recebe rótulos derivados dele mesmo. */
export function infoDoTipo(id: TipoChecklist): TipoChecklistInfo {
  const conhecido = TIPOS_CHECKLIST.find((t) => t.id === id);
  if (conhecido) return conhecido;
  const rotulo = capitalizar(id);
  return { id, rotulo, tituloPdf: `Verificação de ${rotulo}`, sufixoArquivo: id.toUpperCase() };
}
