import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ARQUIVO_BANCO, banco } from './banco';
import { PASTA_LIXEIRA, PASTA_MIDIAS, uidValido } from './midias';

/**
 * Backup diário automático.
 *
 * O banco é copiado com `VACUUM INTO`, que gera uma cópia consistente mesmo
 * com o servidor no ar e gravando. As fotos sincronizadas, que ficam em disco,
 * vão para um espelho que só recebe arquivos novos — eles nunca mudam depois
 * de gravados, então não há o que copiar de novo a cada dia.
 *
 * Restaurar: parar o servidor, copiar o arquivo do backup por cima do banco
 * (apagando os `-wal` e `-shm` ao lado dele) e subir de novo.
 */

export const PASTA_BACKUP = process.env.BACKUP_PASTA ?? join(dirname(ARQUIVO_BANCO), 'backups');
const DIAS = Math.max(1, Number(process.env.BACKUP_DIAS ?? 30));
const DESLIGADO = process.env.BACKUP_DESLIGADO === '1';
const ESPELHO = join(PASTA_BACKUP, 'midias');
const PREFIXO = 'acesso-';

function dataLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface Backup {
  arquivo: string;
  tamanho: number;
  criadoEm: number;
}

export function listarBackups(): Backup[] {
  if (!existsSync(PASTA_BACKUP)) return [];
  return readdirSync(PASTA_BACKUP)
    .filter((nome) => nome.startsWith(PREFIXO) && nome.endsWith('.db'))
    .map((nome) => {
      const info = statSync(join(PASTA_BACKUP, nome));
      return { arquivo: nome, tamanho: info.size, criadoEm: info.mtimeMs };
    })
    .sort((a, b) => b.criadoEm - a.criadoEm);
}

/**
 * Faz um backup. O automático tem um arquivo por dia e não refaz o que já
 * existe — o servidor reinicia à toa em desenvolvimento. O manual leva a hora
 * no nome e sempre gera um novo.
 */
export function fazerBackup(motivo: 'automatico' | 'manual'): Backup | null {
  if (DESLIGADO && motivo === 'automatico') return null;
  mkdirSync(PASTA_BACKUP, { recursive: true });

  const agora = new Date();
  const hora = `${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}${String(agora.getSeconds()).padStart(2, '0')}`;
  const nome =
    motivo === 'automatico' ? `${PREFIXO}${dataLocal(agora)}.db` : `${PREFIXO}${dataLocal(agora)}-${hora}.db`;
  const destino = join(PASTA_BACKUP, nome);
  if (existsSync(destino)) return null;

  banco.prepare('VACUUM INTO ?').run(resolve(destino));
  espelharMidias();
  podar();
  const info = statSync(destino);
  return { arquivo: nome, tamanho: info.size, criadoEm: info.mtimeMs };
}

/** Chamado na subida e a cada hora: faz o backup do dia, se ainda não houver. */
export function backupDoDia(): void {
  try {
    const feito = fazerBackup('automatico');
    if (feito) console.log(`Backup diário gravado: ${join(PASTA_BACKUP, feito.arquivo)}`);
  } catch (erro) {
    console.error('Falha no backup diário', erro);
  }
}

/** Copia as fotos novas; tira do espelho as que já saíram da lixeira de vez. */
function espelharMidias(): void {
  mkdirSync(ESPELHO, { recursive: true });
  const vivas = new Set<string>();
  for (const pasta of [PASTA_MIDIAS, PASTA_LIXEIRA]) {
    if (!existsSync(pasta)) continue;
    for (const nome of readdirSync(pasta)) {
      if (!uidValido(nome)) continue;
      vivas.add(nome);
      const copia = join(ESPELHO, nome);
      if (!existsSync(copia)) copyFileSync(join(pasta, nome), copia);
    }
  }
  for (const nome of readdirSync(ESPELHO)) {
    if (!vivas.has(nome)) rmSync(join(ESPELHO, nome), { force: true });
  }
}

/** Mantém os backups dos últimos `BACKUP_DIAS` dias — e nunca menos que os 3 mais novos. */
function podar(): void {
  const limite = Date.now() - DIAS * 86_400_000;
  listarBackups()
    .slice(3)
    .filter((b) => b.criadoEm < limite)
    .forEach((b) => rmSync(join(PASTA_BACKUP, b.arquivo), { force: true }));
}

export function configuracaoBackup() {
  return { pasta: resolve(PASTA_BACKUP), dias: DIAS, desligado: DESLIGADO };
}
