/**
 * Gera o valor de `VITE_SENHA_ADMIN_HASH` a partir da senha da administração.
 *
 * Uso:  npm run gerar-hash-senha
 *
 * A senha é lida do terminal sem eco (ou da primeira linha da entrada padrão)
 * e nunca é gravada: só o hash PBKDF2-SHA256 com sal aleatório sai na tela.
 * O formato é o lido por `src/core/seguranca/senha.ts`.
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const ITERACOES = 600_000;
const TAMANHO_MINIMO = 12;

async function lerDaEntradaPadrao(): Promise<string> {
  const partes: Buffer[] = [];
  for await (const parte of process.stdin) partes.push(parte as Buffer);
  return Buffer.concat(partes).toString('utf-8').split(/\r?\n/)[0] ?? '';
}

function lerSemEco(rotulo: string): Promise<string> {
  process.stderr.write(rotulo);
  return new Promise((resolve) => {
    const entrada = process.stdin;
    let valor = '';
    const aoDigitar = (teclas: string) => {
      for (const c of teclas) {
        if (c === '\r' || c === '\n') {
          entrada.off('data', aoDigitar);
          entrada.setRawMode(false);
          entrada.pause();
          process.stderr.write('\n');
          resolve(valor);
          return;
        }
        if (c === '\u0003') {
          process.stderr.write('\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') {
          valor = valor.slice(0, -1);
          continue;
        }
        valor += c;
      }
    };
    entrada.setRawMode(true);
    entrada.setEncoding('utf8');
    entrada.resume();
    entrada.on('data', aoDigitar);
  });
}

let senha: string;
if (process.stdin.isTTY) {
  senha = await lerSemEco('Nova senha da administração: ');
  const confirmacao = await lerSemEco('Repita a senha: ');
  if (senha !== confirmacao) {
    console.error('As senhas não conferem.');
    process.exit(1);
  }
} else {
  senha = await lerDaEntradaPadrao();
}

if (senha.length < TAMANHO_MINIMO) {
  console.error(`A senha precisa ter pelo menos ${TAMANHO_MINIMO} caracteres.`);
  process.exit(1);
}

const sal = randomBytes(16);
const hash = pbkdf2Sync(senha, sal, ITERACOES, 32, 'sha256');
const valor = `pbkdf2-sha256:${ITERACOES}:${sal.toString('hex')}:${hash.toString('hex')}`;

console.error('\nInforme no build (variável de ambiente ou arquivo .env.local):\n');
console.log(`VITE_SENHA_ADMIN_HASH=${valor}`);
