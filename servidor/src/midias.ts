import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { ARQUIVO_BANCO, banco } from './banco';

/**
 * Fotos e anexos sincronizados ficam em disco, um arquivo por mídia, com o
 * `uid` como nome — e não dentro do banco: centenas de fotos por painel
 * tornariam o arquivo do banco, e cada backup diário dele, enormes.
 *
 * Excluir não apaga na hora: o arquivo vai para a lixeira e some depois de
 * 30 dias. Uma remoção por engano tem esse prazo para ser desfeita.
 */

export const PASTA_MIDIAS = process.env.MIDIAS_PASTA ?? join(dirname(ARQUIVO_BANCO), 'midias');
export const PASTA_LIXEIRA = join(dirname(PASTA_MIDIAS), 'midias-excluidas');
const DIAS_NA_LIXEIRA = 30;

const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uidValido(uid: string): boolean {
  return UID.test(uid);
}

/** Caminho da mídia. O `uid` validado impede qualquer `..` no nome. */
export function caminhoMidia(uid: string): string {
  if (!uidValido(uid)) throw new Error('Identificador de mídia inválido.');
  return join(PASTA_MIDIAS, uid.toLowerCase());
}

/** Grava num arquivo temporário e renomeia: nunca fica uma foto pela metade. */
export function gravarMidia(uid: string, dados: Buffer): void {
  mkdirSync(PASTA_MIDIAS, { recursive: true });
  const destino = caminhoMidia(uid);
  const temporario = `${destino}.parcial`;
  writeFileSync(temporario, dados);
  renameSync(temporario, destino);
}

export function moverParaLixeira(uids: Iterable<string>): void {
  mkdirSync(PASTA_LIXEIRA, { recursive: true });
  const agora = new Date();
  for (const uid of uids) {
    if (!uidValido(uid)) continue;
    const origem = caminhoMidia(uid);
    if (!existsSync(origem)) continue;
    const destino = join(PASTA_LIXEIRA, uid.toLowerCase());
    renameSync(origem, destino);
    // A data do arquivo marca a entrada na lixeira; é por ela que se apaga.
    utimesSync(destino, agora, agora);
  }
}

/**
 * Remove os registros e devolve os `uid`s. Os arquivos vão para a lixeira com
 * `moverParaLixeira`, chamado só depois da transação confirmada: mover arquivo
 * não se desfaz, e um erro no meio deixaria registro sem foto.
 */
export function removerRegistrosDeMidias(filtro: { usuarioId?: number; painelId?: number }): string[] {
  const condicoes: string[] = [];
  const valores: number[] = [];
  if (filtro.usuarioId !== undefined) {
    condicoes.push('usuarioId = ?');
    valores.push(filtro.usuarioId);
  }
  if (filtro.painelId !== undefined) {
    condicoes.push('painelId = ?');
    valores.push(filtro.painelId);
  }
  if (!condicoes.length) return [];
  const onde = condicoes.join(' AND ');
  const uids = (
    banco.prepare(`SELECT uid FROM sync_midias WHERE ${onde}`).all(...valores) as Array<{ uid: string }>
  ).map((m) => m.uid);
  banco.prepare(`DELETE FROM sync_midias WHERE ${onde}`).run(...valores);
  return uids;
}

/**
 * Faxina diária: arquivos sem registro vão para a lixeira (sobras de exclusões
 * feitas direto no banco), e o que está na lixeira há mais de 30 dias some.
 */
export function faxinarMidias(): void {
  if (existsSync(PASTA_MIDIAS)) {
    const conhecidas = new Set(
      (banco.prepare('SELECT uid FROM sync_midias').all() as Array<{ uid: string }>).map((m) =>
        m.uid.toLowerCase(),
      ),
    );
    const orfas = readdirSync(PASTA_MIDIAS).filter(
      (nome) => uidValido(nome) && !conhecidas.has(nome.toLowerCase()),
    );
    moverParaLixeira(orfas);
    for (const nome of readdirSync(PASTA_MIDIAS)) {
      if (nome.endsWith('.parcial')) rmSync(join(PASTA_MIDIAS, nome), { force: true });
    }
  }
  if (existsSync(PASTA_LIXEIRA)) {
    const limite = Date.now() - DIAS_NA_LIXEIRA * 86_400_000;
    for (const nome of readdirSync(PASTA_LIXEIRA)) {
      const caminho = join(PASTA_LIXEIRA, nome);
      if (statSync(caminho).mtimeMs < limite) rmSync(caminho, { force: true });
    }
  }
}
