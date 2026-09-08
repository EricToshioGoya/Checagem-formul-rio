/**
 * Gera a demonstração compartilhável: a aplicação inteira num arquivo HTML.
 *
 * A demonstração roda dentro de um iframe de terceiro, sem servidor por trás.
 * Por isso ela não pode buscar arquivo nenhum: o catálogo de painéis, os
 * formulários e os modelos de certificado entram embutidos, e um envelope no
 * `fetch` os devolve no lugar da rede. Também não há service worker nem envio
 * de e-mail — o pedido de aprovação cai no caminho manual, como em qualquer
 * publicação sem backend.
 *
 * Uso:  npm run build-demo
 * Saída: demo/verificacao-paineis.html
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saidaBuild = join(raiz, 'dist-demo');
const saida = join(raiz, 'demo');
const arquivoSaida = join(saida, 'verificacao-paineis.html');

/** Pastas de dados que a aplicação lê por `fetch` em tempo de execução. */
const PASTAS_DE_DADOS = ['forms', 'paineis', 'certificados'];

console.log('==> Gerando o pacote de página única');
execFileSync('npx', ['vite', 'build', '--outDir', 'dist-demo'], {
  cwd: raiz,
  stdio: 'inherit',
  env: { ...process.env, VITE_ALVO: 'demo', VITE_BASE: './' },
});

const indice = readFileSync(join(saidaBuild, 'index.html'), 'utf8');
const [, caminhoJs] = indice.match(/src="\.?\/?(assets\/[^"]+\.js)"/) ?? [];
const [, caminhoCss] = indice.match(/href="\.?\/?(assets\/[^"]+\.css)"/) ?? [];
if (!caminhoJs || !caminhoCss) {
  throw new Error('Não achei o JavaScript e o CSS gerados em dist-demo/index.html.');
}

/** Todo JSON das pastas de dados, indexado pelo caminho que o `fetch` pede. */
function coletarDados() {
  const dados = {};
  for (const pasta of PASTAS_DE_DADOS) {
    const raizPasta = join(saidaBuild, pasta);
    if (!existsSync(raizPasta)) continue;
    const pilha = [raizPasta];
    while (pilha.length) {
      const atual = pilha.pop();
      for (const entrada of readdirSync(atual, { withFileTypes: true })) {
        const caminho = join(atual, entrada.name);
        if (entrada.isDirectory()) pilha.push(caminho);
        else if (entrada.name.endsWith('.json')) {
          const chave = relative(saidaBuild, caminho).split(/[\\/]/).join('/');
          dados[chave] = JSON.parse(readFileSync(caminho, 'utf8'));
        }
      }
    }
  }
  return dados;
}

const dados = coletarDados();
console.log(`==> ${Object.keys(dados).length} arquivos de dados embutidos`);

/**
 * Escapa o caractere de substituição (U+FFFD). Ele aparece de propósito nas
 * tabelas de codificação do pdf-lib, mas cru no arquivo ele parece defeito de
 * decodificação, e publicador nenhum aceita. Dentro de literal JavaScript a
 * forma escapada é o mesmo caractere.
 */
const escaparSubstituicao = (texto) => texto.replaceAll('\uFFFD', '\\uFFFD');

const pagina = `<title>Verificação de Montagem de Painéis</title>
<meta name="theme-color" content="#ff000f" />
<style>
${readFileSync(join(saidaBuild, caminhoCss), 'utf8')}
/* A demonstração não carrega os PDFs de apoio: o link fica visível, inerte. */
a[href$=".pdf"] { pointer-events: none; opacity: .45; }
</style>
<div id="root"></div>
<script>
window.__DEMO_DADOS__ = ${escaparSubstituicao(JSON.stringify(dados))};
(() => {
  const original = window.fetch.bind(window);
  window.fetch = (entrada, init) => {
    const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
    const chave = Object.keys(window.__DEMO_DADOS__).find((k) => url.endsWith(k));
    if (chave) {
      return Promise.resolve(
        new Response(JSON.stringify(window.__DEMO_DADOS__[chave]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return original(entrada, init);
  };
})();
</script>
<script type="module">
${escaparSubstituicao(readFileSync(join(saidaBuild, caminhoJs), 'utf8'))}
</script>
`;

mkdirSync(saida, { recursive: true });
writeFileSync(arquivoSaida, pagina);
console.log(`==> ${relative(raiz, arquivoSaida)} — ${(pagina.length / 1024 / 1024).toFixed(2)} MB`);
