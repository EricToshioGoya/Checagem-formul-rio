import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { ARQUIVO_BANCO, banco } from './banco';
import { ErroHttp } from './erroHttp';

/**
 * Fotos e anexos sincronizados ficam em disco, um arquivo por mídia, com o
 * `uid` como nome — e não dentro do banco: centenas de fotos por painel
 * tornariam o arquivo do banco, e cada backup diário dele, enormes.
 *
 * Excluir não apaga na hora: o arquivo vai para a lixeira e some depois de
 * 30 dias. Uma remoção por engano tem esse prazo para ser desfeita.
 *
 * Documentos (PDFs arquivados, certificados anexados e as fotos citadas num
 * envio para aprovação ou numa certificação aprovada) nunca vão para a
 * lixeira: ver `documentosEntre`.
 */

export const PASTA_MIDIAS = process.env.MIDIAS_PASTA ?? join(dirname(ARQUIVO_BANCO), 'midias');
export const PASTA_LIXEIRA = join(dirname(PASTA_MIDIAS), 'midias-excluidas');
const DIAS_NA_LIXEIRA = 30;

export const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uidValido(uid: string): boolean {
  return UID.test(uid);
}

/** Caminho da mídia. O `uid` validado impede qualquer `..` no nome. */
export function caminhoMidia(uid: string): string {
  if (!uidValido(uid)) throw new Error('Identificador de mídia inválido.');
  return join(PASTA_MIDIAS, uid.toLowerCase());
}

export function hashDe(dados: Buffer): string {
  return createHash('sha256').update(dados).digest('hex');
}

/** SHA-256 de um arquivo do disco. */
export function hashDoArquivo(caminho: string): string {
  return hashDe(readFileSync(caminho));
}

/**
 * Grava a entrada de diretório no disco. Sem isso, uma queda de energia logo
 * depois do rename pode fazer o arquivo "sumir" com o conteúdo já gravado. O
 * Windows não abre pasta para isso; o NTFS registra o rename no próprio journal.
 */
export function sincronizarPasta(pasta: string): void {
  if (process.platform === 'win32') return;
  try {
    const fd = openSync(pasta, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Sistema de arquivos sem suporte: o rename já é atômico.
  }
}

/**
 * Grava num arquivo temporário, força a gravação no disco (fsync) e só então
 * renomeia: quem lê vê o arquivo antigo inteiro ou o novo inteiro, e um
 * arquivo confirmado ao aparelho sobrevive a uma queda de energia.
 */
export function gravarArquivoSeguro(destino: string, dados: Buffer): void {
  mkdirSync(dirname(destino), { recursive: true });
  const temporario = `${destino}.parcial`;
  const fd = openSync(temporario, 'w');
  try {
    let escrito = 0;
    while (escrito < dados.length) {
      escrito += writeSync(fd, dados, escrito, dados.length - escrito);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporario, destino);
  sincronizarPasta(dirname(destino));
}

/**
 * Grava a mídia com `fsync`: nunca fica uma foto pela metade. Um documento já
 * guardado (PDF, certificado, foto de um envio) nunca é sobrescrito: com o
 * mesmo conteúdo, a gravação é dispensada; com outro, é recusada.
 */
export function gravarMidia(uid: string, dados: Buffer): void {
  const caminho = caminhoMidia(uid);
  if (existsSync(caminho) && documentosEntre([uid]).size) {
    if (hashDoArquivo(caminho) === hashDe(dados)) return;
    throw new ErroHttp(409, 'Identificador já usado por um documento guardado.', 'documento-guardado');
  }
  gravarArquivoSeguro(caminho, dados);
}

/**
 * Dentre os `uid`s, os que são documento ou foto citada num documento: estes
 * nunca vão para a lixeira nem saem do espelho do backup.
 */
export function documentosEntre(uids: Iterable<string>): Set<string> {
  const protegidos = new Set<string>();
  const consulta = banco.prepare(
    `SELECT 1 FROM pdfs_emitidos WHERE uid = ?
     UNION ALL SELECT 1 FROM certificados_anexos WHERE uid = ?
     UNION ALL SELECT 1 FROM modelos_certificado WHERE uid = ?
     UNION ALL SELECT 1 FROM midias_protegidas WHERE uid = ? AND situacao = 'recebida'
     LIMIT 1`,
  );
  for (const bruto of uids) {
    const uid = bruto.toLowerCase();
    if (consulta.get(uid, uid, uid, uid)) protegidos.add(uid);
  }
  return protegidos;
}

export function moverParaLixeira(uids: Iterable<string>): void {
  const lista = [...uids].filter(uidValido);
  if (!lista.length) return;
  const protegidos = documentosEntre(lista);
  mkdirSync(PASTA_LIXEIRA, { recursive: true });
  const agora = new Date();
  for (const uid of lista) {
    // Foto citada num documento: o registro de sincronização sai, o arquivo fica.
    if (protegidos.has(uid.toLowerCase())) continue;
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

/** Todos os `uid`s que o banco conhece — o que não estiver aqui é sobra. */
export function uidsConhecidos(): Set<string> {
  return new Set(
    (
      banco
        .prepare(
          `SELECT uid FROM sync_midias
           UNION SELECT uid FROM apoio_midias
           UNION SELECT uid FROM pdfs_emitidos
           UNION SELECT uid FROM certificados_anexos
           UNION SELECT uid FROM modelos_certificado
           UNION SELECT uid FROM midias_protegidas WHERE situacao = 'recebida'`,
        )
        .all() as Array<{ uid: string }>
    ).map((m) => m.uid.toLowerCase()),
  );
}

/**
 * Faxina diária: arquivos sem registro vão para a lixeira (sobras de exclusões
 * feitas direto no banco), e o que está na lixeira há mais de 30 dias some.
 */
export function faxinarMidias(): void {
  if (existsSync(PASTA_MIDIAS)) {
    const conhecidas = uidsConhecidos();
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
