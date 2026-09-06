/**
 * Teste de fumaça do fluxo completo, no navegador real.
 *
 * Percorre login por e-mail, escolha do painel, criação de projeto, preenchimento com salvamento automático,
 * persistência após recarregar, modal de apoio, geração dos PDFs nas duas
 * opções de foto, exportação do projeto, grade de ensaios e aba de
 * administração.
 *
 * Uso:
 *   npm run build && npx vite preview --port 8099
 *   npm i -D playwright && npx playwright install chromium
 *   BASE_URL=http://localhost:8099 node scripts/fumaca.mjs
 *
 * Em ambientes com o Chromium já instalado, aponte o executável:
 *   CHROMIUM=/caminho/para/chromium node scripts/fumaca.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:8099';
/** Precisa constar como administrador (ou liberado) em public/forms/index.json. */
const EMAIL = process.env.EMAIL_TESTE ?? 'ericg10456@gmail.com';
/** Painel escolhido logo após o login — precisa constar no catálogo. */
const PAINEL = process.env.PAINEL_TESTE ?? 'SEN Plus';
/** Segundo painel, usado para conferir a troca de painel e a rotina BT. */
const PAINEL_ROTINA = process.env.PAINEL_ROTINA ?? 'Baixa tensão';
const SAIDA = process.env.SAIDA ?? join(process.cwd(), 'saida-fumaca');
mkdirSync(SAIDA, { recursive: true });

const erros = [];
const executavel = process.env.CHROMIUM;
const navegador = await chromium.launch(executavel ? { executablePath: executavel } : {});
const contexto = await navegador.newContext({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
  locale: 'pt-BR',
});
const pagina = await contexto.newPage();
pagina.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
pagina.on('console', (m) => {
  if (m.type() === 'error') erros.push(`console: ${m.text()}`);
});

const passo = async (nome, fn) => {
  process.stdout.write(`• ${nome}… `);
  await fn();
  console.log('ok');
};

await passo('entrar com o e-mail liberado e escolher o painel', async () => {
  await pagina.goto(BASE, { waitUntil: 'networkidle' });
  await pagina.getByLabel('E-mail').fill(EMAIL);
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await pagina.getByRole('heading', { name: 'Escolha o painel' }).waitFor();
  await pagina.getByRole('button', { name: new RegExp(PAINEL) }).click();
  await pagina.getByRole('heading', { name: 'Meus projetos' }).waitFor();
});

await passo('criar projeto com 2 TAGs', async () => {
  await pagina.getByRole('button', { name: 'Novo projeto' }).click();
  await pagina.locator('#empresa').fill('SENPLUS IND');
  await pagina.locator('#nomeProjeto').fill('Linha 3');
  await pagina.locator('#operador').fill('Carlos Silva');
  await pagina.locator('#numeroPedido').fill('PED-99120');
  await pagina.locator('#quantidade').fill('2');
  await pagina.locator('#tag-0').fill('QGBT-01');
  await pagina.locator('#tag-1').fill('CCM-02');
  await pagina.getByRole('button', { name: 'Criar projeto' }).click();
  await pagina.getByRole('heading', { name: 'Linha 3' }).waitFor();
  if (await pagina.getByText('Baixa tensão').count()) {
    throw new Error('formulário de outro painel apareceu no projeto');
  }
});

await passo('abrir a Montagem da primeira TAG', async () => {
  await pagina.getByRole('button', { name: /Montagem/ }).first().click();
  await pagina.getByText('Dados do painel').first().waitFor();
});

await passo('preencher o cabeçalho', async () => {
  await pagina.locator('#cab-fabricante').fill('Parceiro Painéis Ltda');
  await pagina.locator('#cab-clienteFinal').fill('Indústria XYZ');
  await pagina.locator('#cab-un').fill('440');
  await pagina.locator('#cab-grauProtecao').fill('IP54');
  await pagina.locator('#cab-norma').selectOption('IEC 61439-2');
  await pagina.waitForTimeout(900);
});

await passo('marcar 5 etapas e uma observação', async () => {
  await pagina.getByRole('button', { name: 'Dados do painel' }).click();
  const itens = pagina.locator('nav button', { hasText: /^S[12]\./ });
  for (let i = 0; i < 5; i += 1) {
    await pagina.locator('nav button').filter({ hasText: /^S/ }).nth(i + 1).click();
    const marcar = pagina.getByRole('button', { name: 'Marcar como verificado' });
    if (await marcar.count()) await marcar.click();
  }
  const obs = pagina.locator('textarea[id^="obs-"]');
  if (await obs.count()) await obs.first().fill('Conferido com o desenho aprovado.');
  await pagina.waitForTimeout(900);
  if (!(await itens.count())) throw new Error('nenhuma etapa listada no índice');
});

await passo('conferir gravação após recarregar', async () => {
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.getByText(/\d+\/38 etapas/).waitFor();
  const texto = await pagina.getByText(/\d+\/38 etapas/).textContent();
  if (!/[1-9]\d*\/38/.test(texto ?? '')) {
    throw new Error(`progresso não persistiu: "${texto}"`);
  }
});

await passo('abrir o modal de ajuda', async () => {
  const ajuda = pagina.getByRole('button', { name: /Ver ajuda da etapa/ });
  if (await ajuda.count()) {
    await ajuda.first().click();
    await pagina.getByRole('dialog').waitFor();
    await pagina.getByRole('button', { name: 'Fechar' }).first().click();
  }
});

await passo('voltar ao projeto e gerar o PDF', async () => {
  await pagina.getByRole('button', { name: 'Voltar ao projeto' }).click();
  await pagina.getByRole('button', { name: 'Gerar PDF' }).click();
  await pagina.getByRole('dialog').waitFor();
  const downloads = [];
  pagina.on('download', (d) => downloads.push(d));
  await pagina.getByRole('button', { name: 'Gerar e baixar' }).click();
  await pagina.getByText('Arquivos gerados:').waitFor({ timeout: 60000 });
  await pagina.waitForTimeout(1500);
  if (!downloads.length) throw new Error('nenhum download disparado');
  for (const d of downloads) {
    const destino = join(SAIDA, d.suggestedFilename());
    await d.saveAs(destino);
    if (!existsSync(destino) || statSync(destino).size < 1000) {
      throw new Error(`arquivo vazio: ${destino}`);
    }
    console.log(`   ↳ ${d.suggestedFilename()} (${statSync(destino).size} bytes)`);
  }
});

await passo('gerar PDF sem fotos + ZIP', async () => {
  const downloads = [];
  pagina.on('download', (d) => downloads.push(d));
  await pagina.getByText('PDF sem fotos + arquivo ZIP separado com as imagens').click();
  await pagina.getByRole('button', { name: 'Gerar e baixar' }).click();
  await pagina.waitForTimeout(4000);
  for (const d of downloads) await d.saveAs(join(SAIDA, `v2-${d.suggestedFilename()}`));
  await pagina.getByRole('button', { name: 'Fechar' }).last().click();
});

await passo('exportar projeto (.zip)', async () => {
  const [download] = await Promise.all([
    pagina.waitForEvent('download', { timeout: 30000 }),
    pagina.getByRole('button', { name: 'Exportar projeto' }).click(),
  ]);
  const destino = join(SAIDA, download.suggestedFilename());
  await download.saveAs(destino);
  console.log(`   ↳ ${download.suggestedFilename()} (${statSync(destino).size} bytes)`);
});

await passo('administração: senha e edição no painel ativo', async () => {
  await pagina.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
  await pagina.getByLabel('Senha').fill('abb-admin');
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await pagina.getByRole('button', { name: /Verificação de Montagem/ }).click();
  await pagina.getByRole('button', { name: /S1 —/ }).click();
  const descricao = pagina.locator('textarea').first();
  await descricao.fill('Descrição alterada pelo administrador.');
  await pagina.getByText('Alterações gravadas').waitFor({ timeout: 15000 });
});

await passo('trocar de painel e abrir a rotina BT', async () => {
  await pagina.goto(BASE, { waitUntil: 'networkidle' });
  await pagina.getByRole('button', { name: 'Trocar painel' }).click();
  await pagina.getByRole('heading', { name: 'Escolha o painel' }).waitFor();
  await pagina.getByRole('button', { name: new RegExp(PAINEL_ROTINA) }).click();
  await pagina.getByRole('heading', { name: 'Meus projetos' }).waitFor();

  await pagina.getByRole('button', { name: 'Novo projeto' }).click();
  await pagina.locator('#empresa').fill('SENPLUS IND');
  await pagina.locator('#nomeProjeto').fill('Ensaios BT');
  await pagina.locator('#operador').fill('Carlos Silva');
  await pagina.locator('#quantidade').fill('1');
  await pagina.locator('#tag-0').fill('QGBT-01');
  await pagina.getByRole('button', { name: 'Criar projeto' }).click();
  await pagina.getByRole('heading', { name: 'Ensaios BT' }).waitFor();

  await pagina.getByRole('button', { name: /Rotina/ }).first().click();
  await pagina.getByText('Dados do painel').first().waitFor();
  await pagina.locator('nav button').filter({ hasText: 'R5.1' }).click();
  const celula = pagina.getByLabel('L1 – L2 — Megger antes');
  await celula.fill('150');
  await pagina.waitForTimeout(900);
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.locator('nav button').filter({ hasText: 'R5.1' }).click();
  const valor = await pagina.getByLabel('L1 – L2 — Megger antes').inputValue();
  if (valor !== '150') throw new Error(`grade não persistiu: "${valor}"`);
});

await pagina.screenshot({ path: join(SAIDA, 'tela-final.png'), fullPage: false });
await navegador.close();

const ignoraveis = /favicon|Failed to load resource.*media|net::ERR_/i;
const relevantes = erros.filter((e) => !ignoraveis.test(e));
if (relevantes.length) {
  console.error('\nErros de console/página:');
  relevantes.forEach((e) => console.error(` - ${e}`));
  process.exit(1);
}
console.log('\nFluxo completo validado no navegador.');
