import { banco, type Usuario } from './banco';

/**
 * Histórico da administração: quem fez o quê, e quando.
 *
 * Cada linha guarda um texto pronto para ler ("liberou acesso", "SEN Plus"),
 * e não só ids, para continuar legível depois que o painel ou a pessoa citada
 * deixarem de existir.
 */

export type TipoAlvo = 'painel' | 'checklist' | 'acesso' | 'conta' | 'administrador' | 'sistema';

interface Fato {
  /** Quem fez; nulo é o próprio sistema (backup automático, por exemplo). */
  autor: Pick<Usuario, 'id' | 'nome'> | null;
  /** Verbo no passado, em minúsculas: "liberou acesso", "editou o checklist". */
  acao: string;
  alvoTipo: TipoAlvo;
  alvoId?: string | number | null;
  /** Nome do que foi afetado: o painel, o checklist, a pessoa. */
  alvo: string;
  detalhe?: string | null;
}

/** O editor de checklist grava a cada pausa na digitação. */
const JANELA_AGRUPAR_MS = 10 * 60 * 1000;

/**
 * Grava um fato. Com `agrupar`, a mesma ação da mesma pessoa no mesmo alvo
 * dentro de 10 minutos atualiza a linha anterior em vez de criar outra — sem
 * isso, editar um checklist enchia o histórico com uma linha por pausa.
 */
export function registrar(fato: Fato, agrupar = false): void {
  const agora = Date.now();
  const alvoId = fato.alvoId == null ? null : String(fato.alvoId);

  if (agrupar && fato.autor) {
    const anterior = banco
      .prepare(
        `SELECT id FROM auditoria
          WHERE autorId = ? AND acao = ? AND alvoTipo = ? AND alvoId IS ? AND em > ?
          ORDER BY em DESC LIMIT 1`,
      )
      .get(fato.autor.id, fato.acao, fato.alvoTipo, alvoId, agora - JANELA_AGRUPAR_MS) as
      | { id: number }
      | undefined;
    if (anterior) {
      banco
        .prepare('UPDATE auditoria SET em = ?, alvo = ?, detalhe = ? WHERE id = ?')
        .run(agora, fato.alvo, fato.detalhe ?? null, anterior.id);
      return;
    }
  }

  banco
    .prepare(
      `INSERT INTO auditoria (em, autorId, autorNome, acao, alvoTipo, alvoId, alvo, detalhe)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      agora,
      fato.autor?.id ?? null,
      fato.autor?.nome ?? 'Sistema',
      fato.acao,
      fato.alvoTipo,
      alvoId,
      fato.alvo,
      fato.detalhe ?? null,
    );
}

/**
 * LGPD: tira do histórico o nome e o e-mail de uma conta excluída. O fato
 * continua lá ("[conta excluída] teve o acesso retirado"), a pessoa não.
 */
export function anonimizar(conta: Pick<Usuario, 'id' | 'nome' | 'email'>): void {
  const marca = '[conta excluída]';
  const dela = "alvoId = ? AND alvoTipo IN ('acesso', 'conta', 'administrador')";
  banco.prepare("UPDATE auditoria SET autorNome = 'Conta excluída' WHERE autorId = ?").run(conta.id);
  // Os fatos sobre esta conta perdem o nome inteiro ("Nome (e-mail)" vira um só marcador).
  banco.prepare(`UPDATE auditoria SET alvo = ? WHERE ${dela}`).run(marca, String(conta.id));
  // O e-mail identifica a pessoa por si só: sai de onde mais aparecer, como na
  // lista de responsáveis de um painel. O nome, que pode ser uma palavra
  // comum, só sai dos fatos dela — trocar em todo o histórico estragaria
  // linhas de outras pessoas e de painéis.
  if (conta.email.trim().length >= 3) {
    banco
      .prepare(
        `UPDATE auditoria
            SET alvo = replace(alvo, ?, ?), detalhe = replace(detalhe, ?, ?)
          WHERE instr(alvo, ?) > 0 OR instr(COALESCE(detalhe, ''), ?) > 0`,
      )
      .run(conta.email, marca, conta.email, marca, conta.email, conta.email);
  }
  if (conta.nome.trim().length >= 3) {
    banco
      .prepare(`UPDATE auditoria SET detalhe = replace(detalhe, ?, ?) WHERE ${dela} AND instr(COALESCE(detalhe, ''), ?) > 0`)
      .run(conta.nome, marca, String(conta.id), conta.nome);
  }
}

/** Última alteração registrada em cada alvo de um tipo: `alvoId` → quem e quando. */
export function ultimasAlteracoes(
  alvoTipo: TipoAlvo,
): Map<string, { autorNome: string; em: number }> {
  const linhas = banco
    .prepare(
      `SELECT alvoId, autorNome, MAX(em) AS em FROM auditoria
        WHERE alvoTipo = ? AND alvoId IS NOT NULL GROUP BY alvoId`,
    )
    .all(alvoTipo) as Array<{ alvoId: string; autorNome: string; em: number }>;
  return new Map(linhas.map((l) => [l.alvoId, { autorNome: l.autorNome, em: Number(l.em) }]));
}
