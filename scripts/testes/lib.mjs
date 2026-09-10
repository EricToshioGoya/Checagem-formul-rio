/**
 * Utilidades da bateria de verificação manual assistida.
 *
 * Cada bloco (01 a 08) exercita a aplicação em um Chromium real e confere o
 * resultado tanto na tela quanto no IndexedDB. Um bloco não depende dos
 * outros: cada um cria os próprios projetos e pode rodar sozinho.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8099';
export const EXECUTAVEL = process.env.CHROMIUM;
export const SAIDA = process.env.SAIDA ?? join(process.cwd(), 'saida-testes');
mkdirSync(SAIDA, { recursive: true });

export const resultados = [];
export function ok(nome, extra = '') {
  resultados.push(['PASS', nome, extra]);
  console.log(`  PASS  ${nome}${extra ? ` — ${extra}` : ''}`);
}
export function falha(nome, extra = '') {
  resultados.push(['FAIL', nome, extra]);
  console.log(`  FAIL  ${nome}${extra ? ` — ${extra}` : ''}`);
}
export function checa(nome, condicao, extra = '') {
  condicao ? ok(nome, extra) : falha(nome, extra);
  return condicao;
}

export async function abrir() {
  const navegador = await chromium.launch(EXECUTAVEL ? { executablePath: EXECUTAVEL } : {});
  const contexto = await navegador.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    locale: 'pt-BR',
  });
  const pagina = await contexto.newPage();
  const erros = [];
  pagina.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error') erros.push(`console: ${m.text()}`);
  });
  return { navegador, contexto, pagina, erros };
}

/** Lê uma store do IndexedDB da aplicação; Blobs viram `{ __blob, tipo }`. */
export function lerStore(pagina, store) {
  return pagina.evaluate(
    (nome) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('verificacao-montagem');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(nome)) return resolve([]);
          const g = db.transaction(nome, 'readonly').objectStore(nome).getAll();
          g.onsuccess = () =>
            resolve(
              JSON.parse(
                JSON.stringify(g.result, (_k, v) =>
                  v instanceof Blob ? { __blob: v.size, tipo: v.type } : v,
                ),
              ),
            );
          g.onerror = () => reject(g.error);
        };
      }),
    store,
  );
}

/** Cria um projeto pela interface e para na tela do projeto. */
export async function criarProjeto(pagina, { nome, tags, empresa = 'ACME', operador = 'Operador' }) {
  await pagina.goto(BASE, { waitUntil: 'networkidle' });
  await pagina.getByRole('button', { name: 'Novo projeto' }).click();
  await pagina.locator('#empresa').fill(empresa);
  await pagina.locator('#nomeProjeto').fill(nome);
  await pagina.locator('#operador').fill(operador);
  await pagina.locator('#quantidade').fill(String(tags.length));
  for (let i = 0; i < tags.length; i += 1) await pagina.locator(`#tag-${i}`).fill(tags[i]);
  await pagina.getByRole('button', { name: 'Criar projeto' }).click();
  await pagina.getByRole('heading', { name: nome }).waitFor();
}

export async function entrarNaAdministracao(pagina, senha = 'abb-admin') {
  await pagina.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
  if (await pagina.getByLabel('Senha').count()) {
    await pagina.getByLabel('Senha').fill(senha);
    await pagina.getByRole('button', { name: 'Entrar' }).click();
  }
}

export function resumo(titulo = '') {
  const falhas = resultados.filter((r) => r[0] === 'FAIL');
  console.log(`\n== ${titulo} ${resultados.length - falhas.length} PASS / ${falhas.length} FAIL ==`);
  falhas.forEach((f) => console.log(`   ! ${f[1]}${f[2] ? ` — ${f[2]}` : ''}`));
  return falhas.length;
}

/** Imagem PNG 2x2 e PDF mínimo, para os anexos. */
export const PNG_MINIMO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64',
);
export const PDF_MINIMO = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
