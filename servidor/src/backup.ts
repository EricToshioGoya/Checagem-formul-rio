import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ARQUIVO_BANCO, banco } from './banco';
import {
  PASTA_LIXEIRA,
  PASTA_MIDIAS,
  caminhoMidia,
  gravarArquivoSeguro,
  hashDe,
  uidValido,
  uidsConhecidos,
} from './midias';

/**
 * Backup automático.
 *
 * O banco é copiado com `VACUUM INTO`, que gera uma cópia consistente mesmo
 * com o servidor no ar e gravando. As fotos e os documentos, que ficam em
 * disco, vão para espelhos que só recebem arquivos novos — eles nunca mudam
 * depois de gravados, então não há o que copiar de novo.
 *
 * Os espelhos ficam na pasta de backup (`BACKUP_PASTA`, ao lado do banco por
 * padrão) e em cada destino de `BACKUP_DESTINOS` — outro disco ou uma pasta de
 * rede, para que a falha de um disco não leve os documentos junto.
 *
 * Documentos (PDFs arquivados, certificados e fotos citadas num envio) nunca
 * saem de um espelho, e a cópia de cada um é conferida pelo SHA-256.
 *
 * Restaurar: parar o servidor, copiar o arquivo do backup por cima do banco
 * (apagando os `-wal` e `-shm` ao lado dele), copiar a pasta `midias` do
 * espelho para a pasta das mídias e subir de novo.
 */

export const PASTA_BACKUP = process.env.BACKUP_PASTA ?? join(dirname(ARQUIVO_BANCO), 'backups');
const DIAS = Math.max(1, Number(process.env.BACKUP_DIAS ?? 30));
const DESLIGADO = process.env.BACKUP_DESLIGADO === '1';
const ESPELHO = join(PASTA_BACKUP, 'midias');
const PREFIXO = 'acesso-';

/** Destinos extras, separados por `;` (ou `,`): outro disco, pasta de rede. */
export const DESTINOS = (process.env.BACKUP_DESTINOS ?? '')
  .split(/[;,]/)
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => resolve(d));

/** Cópias contínuas do banco (a cada documento novo) mantidas em cada lugar. */
const CONTINUAS = 48;
/** Intervalo mínimo entre duas cópias contínuas do banco. */
const INTERVALO_CONTINUO_MS = 15 * 60 * 1000;
/** Espera depois de um documento novo, para juntar vários num backup só. */
const ATRASO_CONTINUO_MS = Number(process.env.BACKUP_ATRASO_MS ?? 20_000);

function dataLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function horaLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface Backup {
  arquivo: string;
  tamanho: number;
  criadoEm: number;
}

function listarCopiasDoBanco(pasta: string): Backup[] {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta)
    .filter((nome) => nome.startsWith(PREFIXO) && nome.endsWith('.db'))
    .map((nome) => {
      const info = statSync(join(pasta, nome));
      return { arquivo: nome, tamanho: info.size, criadoEm: info.mtimeMs };
    })
    .sort((a, b) => b.criadoEm - a.criadoEm);
}

export function listarBackups(): Backup[] {
  return listarCopiasDoBanco(PASTA_BACKUP);
}

// ------------------------------------------------------------- lugares

/** Um lugar de cópia: o espelho local e cada destino externo. */
interface Lugar {
  rotulo: string;
  /** Raiz do lugar (a chave dos registros). */
  raiz: string;
  midias: string;
  banco: string;
  externo: boolean;
}

function lugares(): Lugar[] {
  return [
    { rotulo: 'Pasta de backup', raiz: resolve(PASTA_BACKUP), midias: ESPELHO, banco: PASTA_BACKUP, externo: false },
    ...DESTINOS.map((d) => ({
      rotulo: d,
      raiz: d,
      midias: join(d, 'midias'),
      banco: join(d, 'banco'),
      externo: true,
    })),
  ];
}

/** Documentos guardados e o SHA-256 de cada um (nulo quando não registrado). */
export function documentosRegistrados(): Map<string, string | null> {
  const docs = new Map<string, string | null>();
  const linhas = banco
    .prepare(
      `SELECT uid, sha256 FROM pdfs_emitidos
       UNION ALL SELECT uid, sha256 FROM certificados_anexos
       UNION ALL SELECT uid, sha256 FROM midias_protegidas WHERE situacao = 'recebida'`,
    )
    .all() as Array<{ uid: string; sha256: string | null }>;
  for (const l of linhas) docs.set(l.uid.toLowerCase(), l.sha256 ?? docs.get(l.uid.toLowerCase()) ?? null);
  return docs;
}

/** Copia e, se o hash for conhecido, confere a cópia antes de dá-la por feita. */
function copiarConferido(origem: string, destino: string, sha256: string | null): void {
  if (sha256) {
    const dados = readFileSync(origem);
    if (hashDe(dados) !== sha256) throw new Error('o arquivo de origem não confere com o SHA-256 registrado');
    gravarArquivoSeguro(destino, dados);
    if (hashDe(readFileSync(destino)) !== sha256) {
      rmSync(destino, { force: true });
      throw new Error('a cópia gravada não confere com o SHA-256');
    }
    return;
  }
  mkdirSync(dirname(destino), { recursive: true });
  copyFileSync(origem, `${destino}.parcial`);
  renameSync(`${destino}.parcial`, destino);
}

interface ResultadoLugar {
  lugar: string;
  ok: boolean;
  copiados: number;
  erros: string[];
  copiaDoBanco?: string;
}

/**
 * Espelha as mídias num lugar: copia o que é novo e tira do espelho o que já
 * saiu da lixeira de vez (exclusão de conta pela LGPD) — exceto documentos,
 * que nunca saem.
 */
function espelharEm(lugar: Lugar, docs: Map<string, string | null>): ResultadoLugar {
  const r: ResultadoLugar = { lugar: lugar.raiz, ok: true, copiados: 0, erros: [] };
  try {
    mkdirSync(lugar.midias, { recursive: true });
  } catch (erro) {
    r.ok = false;
    r.erros.push(`Pasta inacessível: ${(erro as Error).message}`);
    return r;
  }
  const vivas = new Set<string>();
  // Sem a pasta das mídias (disco não montado, pasta trocada), nada sai do
  // espelho: é justamente quando o backup faz falta.
  const podePodar = existsSync(PASTA_MIDIAS);
  if (!podePodar) r.erros.push(`A pasta das mídias (${PASTA_MIDIAS}) não está acessível.`);
  for (const pasta of [PASTA_MIDIAS, PASTA_LIXEIRA]) {
    if (!existsSync(pasta)) continue;
    for (const nome of readdirSync(pasta)) {
      if (!uidValido(nome)) continue;
      vivas.add(nome);
      const copia = join(lugar.midias, nome);
      if (existsSync(copia)) continue;
      try {
        copiarConferido(join(pasta, nome), copia, docs.get(nome.toLowerCase()) ?? null);
        r.copiados += 1;
      } catch (erro) {
        r.erros.push(`${nome}: ${(erro as Error).message}`);
      }
    }
  }
  // Sai do espelho só o que saiu da lixeira de vez: nem no disco, nem na
  // lixeira, nem registrado no banco. Uma foto registrada que sumiu do disco
  // principal continua no espelho — é de lá que ela volta.
  const conhecidas = podePodar ? uidsConhecidos() : new Set<string>();
  for (const nome of readdirSync(lugar.midias)) {
    if (nome.endsWith('.parcial')) {
      rmSync(join(lugar.midias, nome), { force: true });
      continue;
    }
    const uid = nome.toLowerCase();
    if (podePodar && uidValido(nome) && !vivas.has(nome) && !docs.has(uid) && !conhecidas.has(uid)) {
      rmSync(join(lugar.midias, nome), { force: true });
    }
  }
  r.ok = r.erros.length === 0;
  if (r.erros.length > 20) r.erros = [...r.erros.slice(0, 20), `… e mais ${r.erros.length - 20} erro(s).`];
  return r;
}

function registrarRodada(tipo: 'backup' | 'verificacao', destino: string, inicio: number, ok: boolean, resumo: unknown): void {
  try {
    banco
      .prepare(
        `INSERT INTO registros_armazenamento (tipo, destino, iniciadoEm, concluidoEm, ok, resumo)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(tipo, destino, inicio, Date.now(), ok ? 1 : 0, JSON.stringify(resumo));
    // O histórico das rodadas não precisa crescer para sempre.
    banco
      .prepare('DELETE FROM registros_armazenamento WHERE concluidoEm < ?')
      .run(Date.now() - 180 * 86_400_000);
  } catch (erro) {
    console.error('Falha ao registrar a rodada de backup', erro);
  }
}

/** Copia uma cópia do banco já feita para a pasta de banco de cada destino externo. */
function distribuirCopiaDoBanco(arquivo: string, subpasta: string, resultados: Map<string, ResultadoLugar>): void {
  const dados = readFileSync(arquivo);
  const sha = hashDe(dados);
  const nome = arquivo.split(/[\\/]/).pop()!;
  for (const lugar of lugares().filter((l) => l.externo)) {
    const r = resultados.get(lugar.raiz) ?? { lugar: lugar.raiz, ok: true, copiados: 0, erros: [] };
    try {
      const destino = join(lugar.banco, subpasta, nome);
      gravarArquivoSeguro(destino, dados);
      if (hashDe(readFileSync(destino)) !== sha) throw new Error('a cópia gravada não confere');
      r.copiaDoBanco = nome;
    } catch (erro) {
      r.ok = false;
      r.erros.push(`Cópia do banco: ${(erro as Error).message}`);
    }
    resultados.set(lugar.raiz, r);
  }
}

function podarCopias(pasta: string, manter: number, minimoDias?: number): void {
  const copias = listarCopiasDoBanco(pasta);
  if (minimoDias !== undefined) {
    const limite = Date.now() - minimoDias * 86_400_000;
    copias
      .slice(3)
      .filter((b) => b.criadoEm < limite)
      .forEach((b) => rmSync(join(pasta, b.arquivo), { force: true }));
    return;
  }
  copias.slice(manter).forEach((b) => rmSync(join(pasta, b.arquivo), { force: true }));
}

function espelharTudo(resultados: Map<string, ResultadoLugar>): void {
  const docs = documentosRegistrados();
  for (const lugar of lugares()) resultados.set(lugar.raiz, espelharEm(lugar, docs));
}

function fecharRodada(resultados: Map<string, ResultadoLugar>, inicio: number): void {
  for (const r of resultados.values()) registrarRodada('backup', r.lugar, inicio, r.ok, r);
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
  const nome =
    motivo === 'automatico'
      ? `${PREFIXO}${dataLocal(agora)}.db`
      : `${PREFIXO}${dataLocal(agora)}-${horaLocal(agora)}.db`;
  const destino = join(PASTA_BACKUP, nome);
  if (existsSync(destino)) return null;

  const inicio = Date.now();
  banco.prepare('VACUUM INTO ?').run(resolve(destino));
  const resultados = new Map<string, ResultadoLugar>();
  espelharTudo(resultados);
  distribuirCopiaDoBanco(destino, '', resultados);
  const local = resultados.get(resolve(PASTA_BACKUP));
  if (local) local.copiaDoBanco = nome;
  fecharRodada(resultados, inicio);
  podarCopias(PASTA_BACKUP, 0, DIAS);
  for (const lugar of lugares().filter((l) => l.externo)) podarCopias(lugar.banco, 0, DIAS);
  ultimaCopiaContinua = Date.now();
  const info = statSync(destino);
  return { arquivo: nome, tamanho: info.size, criadoEm: info.mtimeMs };
}

/**
 * Chamado na subida e a cada hora: faz o backup do dia, se ainda não houver.
 * Já feito, espelha mesmo assim — um documento que chegou antes de uma queda
 * de energia, ou numa hora em que o destino estava fora do ar, é copiado
 * agora, e não só no dia seguinte.
 */
export function backupDoDia(): void {
  try {
    const feito = fazerBackup('automatico');
    if (feito) console.log(`Backup diário gravado: ${join(PASTA_BACKUP, feito.arquivo)}`);
    else if (!DESLIGADO) {
      const inicio = Date.now();
      const resultados = new Map<string, ResultadoLugar>();
      espelharTudo(resultados);
      fecharRodada(resultados, inicio);
    }
  } catch (erro) {
    console.error('Falha no backup diário', erro);
  }
}

// ------------------------------------------------------ backup contínuo

let ultimaCopiaContinua = 0;
let temporizadorContinuo: ReturnType<typeof setTimeout> | null = null;

/**
 * Backup logo depois de cada documento novo (PDF, certificado, fotos de um
 * envio): espelha os arquivos em todos os lugares e, no máximo a cada 15
 * minutos, guarda uma cópia do banco. Vários documentos seguidos viram uma
 * rodada só.
 */
export function agendarBackupContinuo(): void {
  if (DESLIGADO || temporizadorContinuo) return;
  temporizadorContinuo = setTimeout(() => {
    temporizadorContinuo = null;
    try {
      backupContinuo();
    } catch (erro) {
      console.error('Falha no backup contínuo', erro);
    }
  }, ATRASO_CONTINUO_MS);
  temporizadorContinuo.unref?.();
}

/**
 * Ao encerrar o servidor: a rodada que ainda esperava o atraso roda já, para
 * um documento recém-chegado não ficar só no disco principal.
 */
export function concluirBackupPendente(): void {
  if (!temporizadorContinuo) return;
  clearTimeout(temporizadorContinuo);
  temporizadorContinuo = null;
  try {
    backupContinuo();
  } catch (erro) {
    console.error('Falha no backup contínuo ao encerrar', erro);
  }
}

export function backupContinuo(): void {
  const inicio = Date.now();
  const resultados = new Map<string, ResultadoLugar>();
  espelharTudo(resultados);
  if (Date.now() - ultimaCopiaContinua >= INTERVALO_CONTINUO_MS) {
    const pasta = join(PASTA_BACKUP, 'continuo');
    mkdirSync(pasta, { recursive: true });
    const agora = new Date();
    const arquivo = join(pasta, `${PREFIXO}${dataLocal(agora)}-${horaLocal(agora)}.db`);
    if (!existsSync(arquivo)) {
      banco.prepare('VACUUM INTO ?').run(resolve(arquivo));
      distribuirCopiaDoBanco(arquivo, 'continuo', resultados);
      podarCopias(pasta, CONTINUAS);
      for (const lugar of lugares().filter((l) => l.externo)) podarCopias(join(lugar.banco, 'continuo'), CONTINUAS);
      ultimaCopiaContinua = Date.now();
    }
  }
  fecharRodada(resultados, inicio);
}

// ------------------------------------------------ integridade e reparo

/** Lugares de cópia onde procurar um documento: espelho local e destinos. */
function copiasDe(uid: string): string[] {
  return lugares().map((l) => join(l.midias, uid));
}

/**
 * Restaura um documento do disco principal a partir da primeira cópia
 * íntegra. Devolve o lugar de onde veio, ou nulo se não houver cópia boa.
 */
export function repararDocumento(uid: string, sha256: string): string | null {
  for (const copia of copiasDe(uid)) {
    if (!existsSync(copia)) continue;
    try {
      const dados = readFileSync(copia);
      if (hashDe(dados) !== sha256) continue;
      gravarArquivoSeguro(caminhoMidia(uid), dados);
      if (hashDe(readFileSync(caminhoMidia(uid))) === sha256) return copia;
    } catch {
      // Cópia ilegível: tenta a próxima.
    }
  }
  return null;
}

export interface ProblemaIntegridade {
  uid: string;
  onde: string;
  problema: 'ausente' | 'corrompido';
  reparado: boolean;
}

export interface ResultadoVerificacao {
  ok: boolean;
  iniciadoEm: number;
  concluidoEm: number;
  bancoIntegro: boolean;
  problemasBanco: string[];
  documentos: number;
  conferidos: number;
  copiasConferidas: number;
  reparados: number;
  /** Documentos ruins no disco principal sem nenhuma cópia íntegra. */
  semReparo: number;
  /** Cópias que não puderam ser refeitas (destino inacessível, por exemplo). */
  copiasComFalha: number;
  problemas: ProblemaIntegridade[];
}

function situacaoDoArquivo(caminho: string, sha256: string): 'ok' | 'ausente' | 'corrompido' {
  if (!existsSync(caminho)) return 'ausente';
  try {
    return hashDe(readFileSync(caminho)) === sha256 ? 'ok' : 'corrompido';
  } catch {
    return 'corrompido';
  }
}

/**
 * Confere o banco (`PRAGMA quick_check`) e recalcula o SHA-256 de todo
 * documento — no disco principal e em cada cópia. O que estiver ausente ou
 * corrompido é reparado a partir de uma cópia íntegra; uma cópia ruim é
 * refeita a partir do principal.
 */
let verificacaoEmCurso: Promise<ResultadoVerificacao> | null = null;

/**
 * A leitura de cada documento cede a vez às requisições: com milhares de
 * arquivos, a conferência não deixa o servidor sem responder. Duas chamadas
 * ao mesmo tempo compartilham a mesma rodada.
 */
export function verificarIntegridade(): Promise<ResultadoVerificacao> {
  verificacaoEmCurso ??= conferirTudo().finally(() => {
    verificacaoEmCurso = null;
  });
  return verificacaoEmCurso;
}

const cederAVez = () => new Promise<void>((pronto) => setImmediate(pronto));

async function conferirTudo(): Promise<ResultadoVerificacao> {
  const r: ResultadoVerificacao = {
    ok: true,
    iniciadoEm: Date.now(),
    concluidoEm: 0,
    bancoIntegro: true,
    problemasBanco: [],
    documentos: 0,
    conferidos: 0,
    copiasConferidas: 0,
    reparados: 0,
    semReparo: 0,
    copiasComFalha: 0,
    problemas: [],
  };
  try {
    const linhas = banco.prepare('PRAGMA quick_check').all() as Array<Record<string, string>>;
    r.problemasBanco = linhas.map((l) => Object.values(l)[0]).filter((m) => m !== 'ok');
  } catch (erro) {
    r.problemasBanco = [(erro as Error).message];
  }
  r.bancoIntegro = r.problemasBanco.length === 0;

  const docs = documentosRegistrados();
  const gravar = banco.prepare(
    `INSERT INTO integridade_arquivos (uid, situacao, verificadoEm, detalhe) VALUES (?, ?, ?, ?)
     ON CONFLICT (uid) DO UPDATE SET situacao = excluded.situacao, verificadoEm = excluded.verificadoEm,
       detalhe = excluded.detalhe`,
  );
  const lugaresDeCopia = lugares();
  for (const [uid, sha256] of docs) {
    if (!sha256) continue;
    await cederAVez();
    r.documentos += 1;
    let situacao: 'ok' | 'reparado' | 'ausente' | 'corrompido' = situacaoDoArquivo(caminhoMidia(uid), sha256);
    let detalhe: string | null = null;
    if (situacao !== 'ok') {
      const problema = situacao;
      const origem = repararDocumento(uid, sha256);
      r.problemas.push({ uid, onde: 'principal', problema, reparado: origem !== null });
      if (origem) {
        situacao = 'reparado';
        detalhe = `Restaurado de ${origem}.`;
        r.reparados += 1;
      } else {
        r.semReparo += 1;
        detalhe = 'Sem cópia íntegra nos backups.';
        console.error(`ALERTA: documento ${uid} ${problema} e sem cópia íntegra no backup.`);
      }
    }
    const principalBom = situacao === 'ok' || situacao === 'reparado';
    if (principalBom) r.conferidos += 1;

    // As cópias também envelhecem: cada uma é conferida e, se estiver ruim ou
    // faltando, refeita a partir do disco principal.
    for (const lugar of lugaresDeCopia) {
      const copia = join(lugar.midias, uid);
      const estado = situacaoDoArquivo(copia, sha256);
      if (estado === 'ok') {
        r.copiasConferidas += 1;
        continue;
      }
      if (!principalBom) {
        if (estado === 'corrompido') r.problemas.push({ uid, onde: lugar.raiz, problema: estado, reparado: false });
        continue;
      }
      try {
        copiarConferido(caminhoMidia(uid), copia, sha256);
        r.copiasConferidas += 1;
        // Faltar no destino é só atraso do backup; corrompido é defeito reparado.
        if (estado === 'corrompido') {
          r.reparados += 1;
          r.problemas.push({ uid, onde: lugar.raiz, problema: estado, reparado: true });
        }
      } catch {
        r.copiasComFalha += 1;
        r.problemas.push({ uid, onde: lugar.raiz, problema: estado, reparado: false });
      }
    }
    gravar.run(uid, situacao, Date.now(), detalhe);
  }

  r.ok = r.bancoIntegro && r.semReparo === 0;
  r.concluidoEm = Date.now();
  if (r.problemas.length > 200) r.problemas = r.problemas.slice(0, 200);
  registrarRodada('verificacao', '', r.iniciadoEm, r.ok, r);
  if (r.reparados > 0) agendarBackupContinuo();
  return r;
}

/** Chamado uma vez por dia: a verificação lê todos os documentos do disco. */
export async function verificacaoDoDia(): Promise<void> {
  const ultima = banco
    .prepare("SELECT MAX(concluidoEm) AS em FROM registros_armazenamento WHERE tipo = 'verificacao'")
    .get() as { em: number | null };
  if (ultima.em && Date.now() - Number(ultima.em) < 20 * 3_600_000) return;
  try {
    const r = await verificarIntegridade();
    console.log(
      `Verificação de integridade: ${r.conferidos}/${r.documentos} documento(s) íntegro(s), ` +
        `${r.reparados} reparo(s), ${r.semReparo} sem reparo.`,
    );
  } catch (erro) {
    console.error('Falha na verificação de integridade', erro);
  }
}

// ----------------------------------------------------------- situação

function dispositivo(caminho: string): number | null {
  let atual = resolve(caminho);
  for (;;) {
    try {
      return Number(statSync(atual).dev);
    } catch {
      const pai = dirname(atual);
      if (pai === atual) return null;
      atual = pai;
    }
  }
}

function espacoLivre(caminho: string): { livre: number; total: number } | null {
  let atual = resolve(caminho);
  for (;;) {
    try {
      const s = statfsSync(atual);
      return { livre: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
    } catch {
      const pai = dirname(atual);
      if (pai === atual) return null;
      atual = pai;
    }
  }
}

interface RegistroRodada {
  em: number;
  ok: boolean;
  resumo: unknown;
}

function ultimaRodada(tipo: 'backup' | 'verificacao', destino: string, somenteOk = false): RegistroRodada | null {
  const linha = banco
    .prepare(
      `SELECT concluidoEm, ok, resumo FROM registros_armazenamento
        WHERE tipo = ? AND destino = ? ${somenteOk ? 'AND ok = 1' : ''}
        ORDER BY concluidoEm DESC, id DESC LIMIT 1`,
    )
    .get(tipo, destino) as { concluidoEm: number; ok: number; resumo: string } | undefined;
  if (!linha) return null;
  return { em: Number(linha.concluidoEm), ok: Number(linha.ok) === 1, resumo: JSON.parse(linha.resumo) };
}

export function configuracaoBackup() {
  return { pasta: resolve(PASTA_BACKUP), dias: DIAS, desligado: DESLIGADO, destinos: DESTINOS };
}

/** Situação do armazenamento para a tela Sistema, com os alertas. */
export function situacaoArmazenamento() {
  const alertas: Array<{ nivel: 'erro' | 'aviso'; mensagem: string }> = [];
  const discoDados = dispositivo(dirname(resolve(ARQUIVO_BANCO)));
  const espacoDados = espacoLivre(dirname(resolve(ARQUIVO_BANCO)));
  if (espacoDados && espacoDados.total > 0 && espacoDados.livre / espacoDados.total < 0.1) {
    alertas.push({ nivel: 'aviso', mensagem: 'Menos de 10% de espaço livre no disco dos dados.' });
  }
  if (DESLIGADO) {
    alertas.push({ nivel: 'erro', mensagem: 'O backup automático está desligado (BACKUP_DESLIGADO=1).' });
  }

  const lista = lugares().map((lugar) => {
    const ultima = ultimaRodada('backup', lugar.raiz);
    const sucesso = ultimaRodada('backup', lugar.raiz, true);
    const mesmoDisco = discoDados !== null && dispositivo(lugar.raiz) === discoDados;
    if (ultima && !ultima.ok) {
      alertas.push({
        nivel: 'erro',
        mensagem: `O último backup em ${lugar.rotulo} falhou. Confira se o disco ou a pasta de rede está acessível.`,
      });
    }
    return {
      rotulo: lugar.rotulo,
      caminho: lugar.raiz,
      externo: lugar.externo,
      mesmoDisco,
      espaco: espacoLivre(lugar.raiz),
      ultimaRodada: ultima,
      ultimoSucesso: sucesso?.em ?? null,
    };
  });
  if (!lista.some((l) => l.externo && !l.mesmoDisco)) {
    alertas.push({
      nivel: 'erro',
      mensagem:
        'Nenhum destino de backup fora do disco dos dados. Se esse disco falhar, os documentos se perdem. ' +
        'Configure BACKUP_DESTINOS com uma pasta em outro disco ou na rede.',
    });
  }

  const verificacao = ultimaRodada('verificacao', '');
  if (!verificacao) {
    alertas.push({ nivel: 'aviso', mensagem: 'A verificação de integridade dos documentos ainda não rodou.' });
  } else if (!verificacao.ok) {
    alertas.push({
      nivel: 'erro',
      mensagem: 'A última verificação de integridade encontrou documento sem cópia íntegra. Veja os detalhes.',
    });
  }
  const contar = (sql: string) => Number((banco.prepare(sql).get() as { n: number }).n);
  // Aprovados antes de a aprovação exigir o arquivo: o montador não tem o que baixar.
  const semArquivo = contar(
    `SELECT COUNT(*) AS n FROM certificados c
      WHERE NOT EXISTS (SELECT 1 FROM certificados_anexos a WHERE a.numero = c.numero)`,
  );
  if (semArquivo) {
    alertas.push({
      nivel: 'aviso',
      mensagem:
        `${semArquivo} certificado(s) sem arquivo anexado. Anexe em Aprovações → Certificados emitidos ` +
        'para o montador poder baixar.',
    });
  }
  return {
    destinos: lista,
    verificacao,
    documentos: {
      pdfs: contar('SELECT COUNT(*) AS n FROM pdfs_emitidos'),
      certificados: contar('SELECT COUNT(*) AS n FROM certificados_anexos'),
      fotos: contar("SELECT COUNT(DISTINCT uid) AS n FROM midias_protegidas WHERE situacao = 'recebida'"),
      comProblema: contar("SELECT COUNT(*) AS n FROM integridade_arquivos WHERE situacao IN ('ausente', 'corrompido')"),
    },
    alertas,
  };
}
