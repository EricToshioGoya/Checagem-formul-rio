/**
 * Tipos de checklist (montagem, rotina e os que a administração cadastrar).
 *
 * Montagem e rotina vêm de fábrica. Os demais são criados na aba Painéis e
 * checklists, com o nome que a administração escolher, e moram no servidor
 * (tabela `tipos_checklist`). Esta é a única porta de leitura: botões, rótulos,
 * título e nome de arquivo do PDF perguntam a `infoDoTipo`, que conhece os de
 * fábrica e os registrados por `registrarTiposChecklist`.
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

/** Tipo como o servidor o descreve: o id e o nome dado pela administração. */
export interface TipoChecklistApi {
  id: string;
  rotulo: string;
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

/** Tipo usado quando nenhum é informado ao criar um checklist. Não pode ser excluído. */
export const TIPO_CHECKLIST_PADRAO = 'montagem';

/**
 * Id de tipo. É uma string aberta, e não um enum: os tipos são cadastrados
 * pela administração, e um checklist gravado com um tipo que o aparelho ainda
 * não conhece continua abrindo.
 */
export type TipoChecklist = string;

/** Formato do id de tipo: o mesmo de um slug. */
export const PADRAO_ID_TIPO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Texto sem acento, em minúsculas e com hífen no lugar do resto: o id de um nome. */
export function slugDoTipo(rotulo: string): string {
  return rotulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function capitalizar(id: string): string {
  const texto = id.replace(/-/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Tipos cadastrados no servidor, pelo id. */
const registrados = new Map<string, string>();

/** Guarda os nomes dos tipos vindos do servidor; substitui os anteriores. */
export function registrarTiposChecklist(lista: readonly TipoChecklistApi[]): void {
  registrados.clear();
  for (const t of lista) registrados.set(t.id, t.rotulo);
}

/** Dados do tipo; um id desconhecido recebe rótulos derivados dele mesmo. */
export function infoDoTipo(id: TipoChecklist): TipoChecklistInfo {
  const deFabrica = TIPOS_CHECKLIST.find((t) => t.id === id);
  const rotulo = registrados.get(id) ?? deFabrica?.rotulo ?? capitalizar(id);
  // O de fábrica que não foi renomeado mantém o título e o sufixo de sempre.
  if (deFabrica && deFabrica.rotulo === rotulo) return deFabrica;
  return {
    id,
    rotulo,
    tituloPdf: `Verificação de ${rotulo}`,
    sufixoArquivo: slugDoTipo(rotulo).toUpperCase() || id.toUpperCase(),
  };
}
