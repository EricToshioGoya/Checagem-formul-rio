/**
 * Executa a bateria completa de verificação e resume o resultado.
 *
 * Uso:
 *   npm run build && npx vite preview --port 8099 &
 *   npm i -D playwright pdfjs-dist && npx playwright install chromium
 *   BASE_URL=http://127.0.0.1:8099 npm run testes
 *
 * Um bloco isolado roda direto:  node scripts/testes/02-persistencia.mjs
 * Filtro por número:             npm run testes -- 03 05
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const pasta = new URL('.', import.meta.url).pathname;
const filtro = process.argv.slice(2);

const blocos = readdirSync(pasta)
  .filter((f) => /^\d\d-.*\.(mjs|sh)$/.test(f))
  .sort()
  .filter((f) => !filtro.length || filtro.some((n) => f.startsWith(n)));

if (!blocos.length) {
  console.error('Nenhum bloco encontrado para', filtro.join(' '));
  process.exit(1);
}

const resultados = [];
for (const bloco of blocos) {
  const caminho = join(pasta, bloco);
  const r = bloco.endsWith('.sh')
    ? spawnSync('bash', [caminho], { stdio: 'inherit' })
    : spawnSync(process.execPath, [caminho], { stdio: 'inherit' });
  resultados.push([bloco, r.status === 0]);
}

console.log('\n============ RESUMO ============');
for (const [bloco, passou] of resultados) {
  console.log(`${passou ? 'ok      ' : 'FALHOU  '} ${bloco}`);
}
const falhas = resultados.filter(([, ok]) => !ok).length;
console.log(`\n${resultados.length - falhas} de ${resultados.length} blocos sem falhas.`);
process.exit(falhas ? 1 : 0);
