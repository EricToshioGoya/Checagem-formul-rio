/**
 * Teste de fumaça dos dois fluxos, no navegador real, com login.
 *
 * Conta: cria a conta do administrador inicial (que também é o responsável
 * semeado em todos os painéis, e por isso abre todos sem pedir acesso).
 *
 * Verificação (SEN Plus): abre o painel na lista de projetos, cria um projeto
 * (dados do painel obrigatórios), entra no checklist de montagem, confere que
 * o cabeçalho veio do cadastro, marca uma etapa e confere que a marcação
 * sobrevive a um recarregamento.
 *
 * Certificação (System Pro E Energy): solicitação com campos obrigatórios,
 * envio bloqueado enquanto falta checklist, validação ABB na administração
 * com numeração sequencial e geração do certificado.
 *
 * Uso — o servidor de acesso serve também o `dist/`, na mesma origem da API.
 * Use um banco vazio: o teste cria a conta do administrador inicial.
 *   npm run build
 *   BANCO=/tmp/fumaca.db npm run servidor
 *   npm i -D playwright && npx playwright install chromium
 *   BASE_URL=http://localhost:3001 node scripts/fumaca.mjs
 *
 * Em ambientes com o Chromium já instalado, aponte o executável:
 *   CHROMIUM=/caminho/para/chromium node scripts/fumaca.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const SAIDA = process.env.SAIDA ?? join(process.cwd(), 'saida-fumaca');
const EMAIL = process.env.ADMIN_INICIAL ?? 'ericg10456@gmail.com';
const SENHA = 'senha-de-fumaca-123';
mkdirSync(SAIDA, { recursive: true });

let falhas = 0;
function checa(nome, condicao, extra = '') {
  console.log(`  ${condicao ? 'PASS' : 'FAIL'}  ${nome}${extra ? ` — ${extra}` : ''}`);
  if (!condicao) falhas += 1;
}

const navegador = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const contexto = await navegador.newContext({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
  locale: 'pt-BR',
});
const p = await contexto.newPage();
const erros = [];
p.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
p.on('console', (m) => {
  if (m.type() === 'error') erros.push(`console: ${m.text()}`);
});

try {
  console.log('\n== Conta ==');
  await p.goto(`${BASE}/#/entrar`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await p.getByLabel('Seu nome').fill('Montador Fumaça');
  await p.locator('#campo-email').fill(EMAIL);
  await p.locator('#campo-senha').fill(SENHA);
  await p.getByRole('button', { name: 'Criar conta e entrar' }).click();
  await p.getByRole('heading', { name: 'Escolha o painel' }).waitFor();
  checa('cria a conta e cai na escolha do painel', true);

  console.log('\n== Verificação (SEN Plus) ==');
  const senPlus = p.locator('li', { hasText: 'SEN Plus' });
  await senPlus.getByRole('button', { name: 'Abrir checagens' }).waitFor();
  await senPlus.getByRole('button', { name: 'Abrir checagens' }).click();
  await p.waitForURL(/#\/paineis\/\d+\/projetos$/);
  await p.getByText('Nenhum projeto neste painel').waitFor();
  checa('o painel abre na lista de projetos, vazia', true);
  await p.getByRole('button', { name: 'Novo projeto' }).first().click();
  await p.waitForURL(/projetos\/novo$/);
  await p.getByLabel('Nome do projeto').fill('Obra Fumaça');
  await p.getByLabel('Empresa').fill('Montadora Fumaça');
  const tag1 = p.getByRole('region', { name: 'TAG 1' });
  await tag1.getByLabel('Nome da TAG').fill('QGBT-01');
  await tag1.getByRole('checkbox', { name: /Montagem/ }).check();
  await p.getByRole('button', { name: 'Criar projeto' }).click();
  checa(
    'criar exige os dados do painel',
    (await p.getByText(/TAG 1: \d+ campos dos dados do painel/).count()) === 1 &&
      /novo$/.test(p.url()),
  );
  for (const [rotulo, valor] of [
    ['Fabricante do conjunto', 'ABB Parceira'],
    ['Cliente final', 'Cliente Fumaça'],
    ['Número do pedido', 'PED-1'],
    ['Tensão de operação (Un)', '380'],
    ['Grau de proteção (IP)', 'IP54'],
  ]) {
    await tag1.getByLabel(rotulo).fill(valor);
  }
  await tag1.getByLabel('Norma atendida').selectOption({ index: 1 });
  await p.getByRole('button', { name: 'Criar projeto' }).click();
  await p.waitForURL(/#\/projetos\/\d+$/);
  await p.locator('button', { hasText: 'Montagem' }).first().waitFor();
  checa(
    'a TAG mostra só o checklist escolhido',
    (await p.locator('button', { hasText: 'Rotina' }).count()) === 0,
  );
  await p.locator('button', { hasText: 'Montagem' }).first().click();
  await p.waitForURL(/formularios/);
  await p.getByRole('button', { name: 'Dados do painel' }).first().click();
  checa(
    'o cabeçalho do checklist vem do cadastro da TAG',
    (await p.getByLabel('Fabricante do conjunto').inputValue()) === 'ABB Parceira',
  );
  const primeira = p.locator('nav[aria-label="Etapas do formulário"] li button').first();
  await primeira.click();
  await p.getByRole('button', { name: 'Marcar como verificado' }).click();
  await p.getByRole('status').filter({ hasText: 'Salvo' }).waitFor();
  await p.reload({ waitUntil: 'networkidle' });
  await primeira.click();
  const progresso = await p.locator('header').getByText(/\d+\/\d+ etapas/).innerText();
  checa('a marcação sobrevive ao recarregamento', progresso.startsWith('1/'), progresso);

  console.log('\n== Certificação (System Pro E Energy) ==');
  await p.goto(`${BASE}/#/paineis`, { waitUntil: 'networkidle' });
  const energy = p.locator('li', { hasText: 'System Pro E Energy' });
  await energy.getByRole('button', { name: 'Abrir solicitações' }).waitFor();
  await energy.getByRole('button', { name: 'Abrir solicitações' }).click();
  await p.getByRole('button', { name: 'Nova solicitação' }).click();
  checa(
    'o operador vem da conta',
    (await p.locator('#sol-operador').inputValue()) === 'Montador Fumaça',
  );
  checa(
    'criar fica bloqueado com obrigatório vazio',
    await p.getByRole('button', { name: 'Criar solicitação' }).isDisabled(),
  );
  const campos = {
    montador: 'Montadora X',
    emailMontador: 'montador@x.com.br',
    celularMontador: '11999999999',
    projeto: 'Obra 1',
    tagPainel: 'QGBT-01',
    clienteFinal: 'Cliente Y',
    correnteNominal: '1000',
    correnteCurtoCircuito: '50',
    empresa: 'Parceiro Z',
  };
  for (const [id, valor] of Object.entries(campos)) await p.locator(`#sol-${id}`).fill(valor);
  await p.getByRole('button', { name: 'Criar solicitação' }).click();
  await p.getByRole('heading', { name: 'QGBT-01' }).waitFor();
  checa(
    'envio bloqueado com o checklist em branco',
    await p.getByRole('button', { name: 'Enviar para validação da ABB' }).isDisabled(),
  );

  await p.getByRole('button', { name: 'Preencher checklist' }).click();
  await p.waitForURL(/checklist$/);
  const condicional = await p.getByText('11.5.2', { exact: true }).count();
  checa('a etapa condicional 11.5.2 começa escondida', condicional === 0);

  // Preencher as dez etapas com foto pela interface tomaria o teste inteiro;
  // a solicitação é dada como enviada direto no banco do aparelho, e o que se
  // confere daqui em diante é a validação e a emissão.
  await p.evaluate(
    () =>
      new Promise((ok, erro) => {
        const req = indexedDB.open('verificacao-montagem');
        req.onerror = () => erro(req.error);
        req.onsuccess = () => {
          const loja = req.result
            .transaction('solicitacoes', 'readwrite')
            .objectStore('solicitacoes');
          const todas = loja.getAll();
          todas.onsuccess = () => {
            const s = todas.result[0];
            s.estado = 'enviada';
            s.historico.push({ estado: 'enviada', em: Date.now(), por: 'fumaça' });
            loja.put(s).onsuccess = () => ok();
          };
        };
      }),
  );

  console.log('\n== Validação ABB ==');
  await p.goto(`${BASE}/#/paineis`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Sair' }).click();
  await p.waitForURL(/#\/entrar/);
  await p.getByRole('button', { name: 'Entrar como administrador' }).click();
  await p.getByRole('heading', { name: 'Entrar como administrador' }).waitFor();
  await p.locator('#campo-email').fill(EMAIL);
  await p.locator('#campo-senha').fill(SENHA);
  await p.locator('#campo-senha').press('Enter');
  await p.waitForURL(/#\/admin/);
  await p.getByRole('tab', { name: /Validação/ }).click();
  await p.getByRole('button', { name: 'Aprovar e numerar' }).click();
  await p.getByText(/Certificado nº 0001 atribuído/).waitFor();
  checa('aprova e atribui o nº 0001', true);

  await p.goto(`${BASE}/#/paineis/system-pro-e-energy/solicitacoes`, {
    waitUntil: 'networkidle',
  });
  await p.getByRole('button', { name: 'Abrir' }).first().click();
  const [download] = await Promise.all([
    p.waitForEvent('download'),
    p.getByRole('button', { name: 'Baixar certificado' }).click(),
  ]);
  const destino = join(SAIDA, download.suggestedFilename());
  await download.saveAs(destino);
  checa(
    'gera o PDF do certificado',
    /^CERTIFICADO_0001_QGBT-01_/.test(download.suggestedFilename()) &&
      statSync(destino).size > 1000,
    download.suggestedFilename(),
  );
} catch (e) {
  falhas += 1;
  console.error('\nFalha inesperada:', e);
  await p.screenshot({ path: join(SAIDA, 'falha.png') }).catch(() => {});
} finally {
  await navegador.close();
}

checa('nenhum erro no console', erros.length === 0, erros.join(' | '));
console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nFumaça OK.');
process.exit(falhas ? 1 : 0);
