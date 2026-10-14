import {
  PADRAO_ID_TIPO,
  registrarTiposChecklist,
  slugDoTipo,
  TIPO_CHECKLIST_PADRAO,
  TIPOS_CHECKLIST,
  type TipoChecklistApi,
} from '../../compartilhado/tiposChecklist';
import { banco } from './banco';

/**
 * Tipos de checklist cadastrados: montagem e rotina de fábrica, mais os que a
 * administração cria com o nome que quiser ("Comissionamento", "Inspeção
 * final"…). Valem para todos os painéis.
 */

export interface TipoChecklistAdmin extends TipoChecklistApi {
  /** Quantos checklists usam o tipo; com algum, o tipo não pode ser excluído. */
  checklists: number;
  /** O tipo padrão (montagem) não pode ser excluído: o painel novo nasce com ele. */
  padrao: boolean;
}

export function listarTipos(): TipoChecklistApi[] {
  return banco
    .prepare('SELECT id, rotulo FROM tipos_checklist ORDER BY ordem, criadoEm, id')
    .all() as unknown as TipoChecklistApi[];
}

/** Atualiza a tabela de rótulos de `infoDoTipo`, usada no andamento e nos nomes. */
function sincronizarRegistro(): void {
  registrarTiposChecklist(listarTipos());
}

function usosPorTipo(): Map<string, number> {
  const linhas = banco
    .prepare(
      `SELECT json_extract(definicao, '$.tipo') AS tipo, COUNT(*) AS n
         FROM formularios GROUP BY tipo`,
    )
    .all() as Array<{ tipo: string; n: number }>;
  return new Map(linhas.map((l) => [String(l.tipo), Number(l.n)]));
}

export function listarTiposAdmin(): TipoChecklistAdmin[] {
  const usos = usosPorTipo();
  return listarTipos().map((t) => ({
    ...t,
    checklists: usos.get(t.id) ?? 0,
    padrao: t.id === TIPO_CHECKLIST_PADRAO,
  }));
}

export function obterTipo(id: string): TipoChecklistApi | null {
  return (
    (banco.prepare('SELECT id, rotulo FROM tipos_checklist WHERE id = ?').get(id) as
      | TipoChecklistApi
      | undefined) ?? null
  );
}

function rotuloEmUso(rotulo: string, excetoId?: string): boolean {
  const linha = banco
    .prepare('SELECT id FROM tipos_checklist WHERE rotulo = ? COLLATE NOCASE')
    .get(rotulo) as { id: string } | undefined;
  return linha !== undefined && linha.id !== excetoId;
}

export class ErroTipo extends Error {}

/** Cria o tipo a partir do nome; o id sai do nome e não muda mais. */
export function criarTipo(rotulo: string): TipoChecklistApi {
  if (rotuloEmUso(rotulo)) throw new ErroTipo(`Já existe um tipo chamado "${rotulo}".`);
  const base = slugDoTipo(rotulo) || 'tipo';
  let id = base;
  let n = 2;
  while (obterTipo(id)) id = `${base}-${n++}`;
  const { proxima } = banco
    .prepare('SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM tipos_checklist')
    .get() as { proxima: number };
  banco
    .prepare('INSERT INTO tipos_checklist (id, rotulo, ordem, criadoEm) VALUES (?, ?, ?, ?)')
    .run(id, rotulo, Number(proxima), Date.now());
  sincronizarRegistro();
  return { id, rotulo };
}

export function renomearTipo(id: string, rotulo: string): TipoChecklistApi {
  if (!obterTipo(id)) throw new ErroTipo('Tipo de checklist não encontrado.');
  if (rotuloEmUso(rotulo, id)) throw new ErroTipo(`Já existe um tipo chamado "${rotulo}".`);
  banco.prepare('UPDATE tipos_checklist SET rotulo = ? WHERE id = ?').run(rotulo, id);
  sincronizarRegistro();
  return { id, rotulo };
}

export function excluirTipo(id: string): void {
  if (id === TIPO_CHECKLIST_PADRAO) {
    throw new ErroTipo('O tipo padrão não pode ser excluído: todo painel novo nasce com ele.');
  }
  if (!obterTipo(id)) throw new ErroTipo('Tipo de checklist não encontrado.');
  const usos = usosPorTipo().get(id) ?? 0;
  if (usos > 0) {
    throw new ErroTipo(
      `O tipo está em uso por ${usos} checklist(s). Exclua ou troque esses checklists antes.`,
    );
  }
  banco.prepare('DELETE FROM tipos_checklist WHERE id = ?').run(id);
  sincronizarRegistro();
}

/**
 * Garante os tipos de fábrica e um registro para todo tipo já gravado num
 * checklist (bases de antes da tabela, sementes) — nenhum checklist fica com
 * um tipo que a administração não enxerga. Roda a cada subida.
 */
export function semearTipos(): void {
  const agora = Date.now();
  const inserir = banco.prepare(
    'INSERT OR IGNORE INTO tipos_checklist (id, rotulo, ordem, criadoEm) VALUES (?, ?, ?, ?)',
  );
  for (const [i, t] of TIPOS_CHECKLIST.entries()) {
    if (!obterTipo(t.id)) inserir.run(t.id, t.rotulo, i, agora);
  }
  for (const tipo of usosPorTipo().keys()) {
    if (!tipo || obterTipo(tipo) || !PADRAO_ID_TIPO.test(tipo)) continue;
    const rotulo = tipo.charAt(0).toUpperCase() + tipo.slice(1).replace(/-/g, ' ');
    const { proxima } = banco
      .prepare('SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM tipos_checklist')
      .get() as { proxima: number };
    inserir.run(tipo, rotuloEmUso(rotulo) ? tipo : rotulo, Number(proxima), agora);
  }
  sincronizarRegistro();
}
