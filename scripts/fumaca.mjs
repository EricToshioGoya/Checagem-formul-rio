/**
 * Teste de fumaça dos dois fluxos, no navegador real, com login — da
 * geração do PDF até a correção e o download do certificado.
 *
 * Conta: cria a conta do administrador inicial (que também é o responsável
 * semeado em todos os painéis, e por isso abre todos sem pedir acesso). A
 * mesma conta entra ora como montador, ora como administrador.
 *
 * Verificação (SEN Plus): cria um projeto, marca uma etapa e gera o PDF do
 * projeto, que segue sozinho para a aprovação. A administração reprova
 * marcando a etapa com o motivo; o montador vê o pop-up e o alerta amarelo,
 * abre as correções e chega à etapa destacada. O PDF aparece na busca de
 * documentos.
 *
 * Certificação (System Pro E Energy): solicitação com campos obrigatórios; a
 * administração devolve marcando uma etapa, o montador vê o alerta; no
 * reenvio a administração aprova anexando o arquivo do certificado, e o
 * montador baixa esse mesmo arquivo na tela inicial.
 *
 * Uso — o servidor de acesso serve também o `dist/`, na mesma origem da API.
 * Use um banco vazio: o teste cria a conta do administrador inicial.
 *   npm run build
 *   BANCO=/tmp/fumaca.db ADMIN_INICIAL=fumaca@teste.local RESPONSAVEL_PADRAO=fumaca@teste.local npm run servidor
 *   npm i -D playwright && npx playwright install chromium
 *   BASE_URL=http://localhost:3001 ADMIN_INICIAL=fumaca@teste.local node scripts/fumaca.mjs
 *
 * Em ambientes com o Chromium já instalado, aponte o executável:
 *   CHROMIUM=/caminho/para/chromium node scripts/fumaca.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const SAIDA = process.env.SAIDA ?? join(process.cwd(), 'saida-fumaca');
const EMAIL = process.env.ADMIN_INICIAL ?? 'ericg10456@gmail.com';
const SENHA = 'senha-de-fumaca-123';
const ESPERA = { timeout: 60_000 };
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

/** Sai pela lista de projetos: a tela inicial abriria o pop-up desta mesma conta. */
async function sair() {
  await p.goto(`${BASE}/#/projetos`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Sair' }).click();
  await p.waitForURL(/#\/entrar/);
}

async function entrarComoMontador() {
  await p.locator('#campo-email').fill(EMAIL);
  await p.locator('#campo-senha').fill(SENHA);
  await p.locator('#campo-senha').press('Enter');
  await p.getByRole('heading', { name: 'Escolha o painel' }).waitFor();
}

async function entrarComoAdmin() {
  await p.getByRole('button', { name: 'Entrar como administrador' }).click();
  await p.getByRole('heading', { name: 'Entrar como administrador' }).waitFor();
  await p.locator('#campo-email').fill(EMAIL);
  await p.locator('#campo-senha').fill(SENHA);
  await p.locator('#campo-senha').press('Enter');
  await p.waitForURL(/#\/admin/);
}

/** Pop-up das decisões: confere o texto e fecha com "Entendi". */
async function popup(texto) {
  const dialogo = p.getByRole('dialog', { name: 'Novidades da administração' });
  await dialogo.waitFor(ESPERA);
  const ok = (await dialogo.getByText(texto).count()) > 0;
  await dialogo.getByRole('button', { name: 'Entendi' }).click();
  await dialogo.waitFor({ state: 'detached' });
  return ok;
}

/**
 * Envia a solicitação de certificação direto pela API, com o checklist em
 * branco: preencher as dez etapas com foto pela interface tomaria o teste
 * inteiro, e o servidor não exige o checklist completo para receber. A cópia
 * do aparelho passa a "enviada", como faria o botão de envio.
 */
async function enviarSolicitacaoPelaApi() {
  await p.evaluate(async () => {
    const token = localStorage.getItem('sessao-token');
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const banco = await new Promise((ok, erro) => {
      const req = indexedDB.open('verificacao-montagem');
      req.onerror = () => erro(req.error);
      req.onsuccess = () => ok(req.result);
    });
    const s = await new Promise((ok) => {
      const todas = banco.transaction('solicitacoes').objectStore('solicitacoes').getAll();
      todas.onsuccess = () => ok(todas.result[0]);
    });
    const { paineis } = await (await fetch('/api/paineis', { headers: h })).json();
    const painelId = paineis.find((x) => x.slug === s.tipoPainel).id;
    const { solicitacoes } = await (await fetch('/api/certificacoes', { headers: h })).json();
    const remota = solicitacoes.find((x) => x.uid === s.uid);
    let r = await fetch(`/api/certificacoes/${s.uid}`, {
      method: 'PUT',
      headers: h,
      body: JSON.stringify({
        versaoBase: remota?.versao ?? 0,
        painelId,
        formId: s.formId,
        criadoEm: s.criadoEm,
        dados: s.dados,
        preenchimento: { formRevisao: 'fumaca', cabecalho: {}, respostas: {} },
        midias: [],
      }),
    });
    if (!r.ok) throw new Error(`PUT: ${await r.text()}`);
    r = await fetch(`/api/certificacoes/${s.uid}/enviar`, { method: 'POST', headers: h, body: '{}' });
    if (!r.ok) throw new Error(`enviar: ${await r.text()}`);
    await new Promise((ok) => {
      const loja = banco.transaction('solicitacoes', 'readwrite').objectStore('solicitacoes');
      s.estado = 'enviada';
      s.historico.push({ estado: 'enviada', em: Date.now(), por: 'fumaça' });
      loja.put(s).onsuccess = () => ok();
    });
  });
}

/** Na análise aberta, marca a primeira etapa como não conforme, com o motivo. */
async function marcarPrimeiraEtapa(motivo) {
  const etapa = p.locator('details li', { has: p.getByRole('checkbox', { name: 'Não conforme' }) }).first();
  await etapa.getByRole('checkbox', { name: 'Não conforme' }).check();
  await etapa.getByRole('textbox', { name: 'Motivo da não conformidade' }).fill(motivo);
}

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
  await p.getByLabel('Fabricante do conjunto').fill('ABB Parceira');
  await p.getByLabel('Cliente final').fill('Cliente Fumaça');
  for (const [rotulo, valor] of [
    ['Número do pedido', 'PED-1'],
    ['Tensão de operação (Un)', '380'],
    ['Grau de proteção (IP)', 'IP54'],
  ]) {
    await tag1.getByLabel(rotulo).fill(valor);
  }
  await tag1.getByLabel('Norma atendida').selectOption({ index: 1 });
  await p.getByRole('button', { name: 'Criar projeto' }).click();
  await p.waitForURL(/#\/projetos\/\d+$/);
  const urlProjeto = p.url();
  await p.locator('button', { hasText: 'Montagem' }).first().click();
  await p.waitForURL(/formularios/);
  const primeira = p.locator('nav[aria-label="Etapas do formulário"] li button').first();
  await primeira.click();
  await p.getByRole('button', { name: 'Marcar como verificado' }).click();
  await p.getByRole('status').filter({ hasText: 'Salvo' }).waitFor();
  await p.reload({ waitUntil: 'networkidle' });
  await primeira.click();
  const progresso = await p.locator('header').getByText(/\d+\/\d+ etapas/).innerText();
  checa('a marcação sobrevive ao recarregamento', progresso.startsWith('1/'), progresso);

  await p.goto(urlProjeto, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Gerar PDF' }).first().click();
  const dialogoPdf = p.getByRole('dialog', { name: 'Gerar PDF' });
  const [pdfGerado] = await Promise.all([
    p.waitForEvent('download', ESPERA),
    dialogoPdf.getByRole('button', { name: 'Gerar e baixar' }).click(),
  ]);
  await dialogoPdf.getByText(/enviado à administração para aprovação/).waitFor(ESPERA);
  checa('o PDF do projeto sai e segue sozinho para a aprovação', true, pdfGerado.suggestedFilename());
  await dialogoPdf.getByRole('button', { name: 'Fechar' }).first().click();

  console.log('\n== Aprovação da verificação (administração) ==');
  await sair();
  await entrarComoAdmin();
  await p.goto(`${BASE}/#/admin?aba=aprovacoes`, { waitUntil: 'networkidle' });
  const envio = p.locator('li', { hasText: 'Obra Fumaça' });
  await envio.getByRole('button', { name: 'Analisar' }).click();
  await p.getByRole('heading', { name: 'Obra Fumaça' }).waitFor();
  checa('a análise mostra a TAG do envio', (await p.getByText('TAG QGBT-01', { exact: false }).count()) > 0);
  await marcarPrimeiraEtapa('A foto não está nítida.');
  checa(
    'com etapa marcada, só dá para pedir correção',
    await p.getByRole('button', { name: 'Aprovar', exact: true }).isDisabled(),
  );
  await p.getByRole('button', { name: 'Reprovar e pedir correção' }).click();
  await p.getByRole('dialog', { name: 'Confirmar pedido de correção' }).getByRole('button', { name: 'Pedir correção' }).click();
  await p.getByText(/foi avisado para corrigir 1 etapa/).waitFor(ESPERA);
  checa('reprova com a etapa marcada', true);

  await p.getByRole('tab', { name: /Documentos/ }).click();
  await p.getByPlaceholder(/Empresa, projeto, TAG/).fill('obra fumaca');
  await p.getByText('PDF de verificação').first().waitFor(ESPERA);
  checa(
    'a busca de documentos acha o PDF (sem acento) com a situação',
    (await p.getByText('Correção pedida').count()) > 0,
  );

  console.log('\n== Correção (montador) ==');
  await sair();
  await entrarComoMontador();
  checa('o pop-up avisa da reprovação', await popup('Correção pedida — Obra Fumaça'));
  const alerta = p.getByRole('alert').filter({ hasText: 'A administração pediu correções' });
  await alerta.waitFor();
  checa('o alerta amarelo aparece na tela inicial', true);
  await alerta.getByRole('link', { name: 'Corrigir' }).first().click();
  await p.waitForURL(/#\/correcoes\//);
  await p.getByText('A foto não está nítida.').waitFor();
  checa('a tela de correções mostra o motivo', (await p.getByText('Ainda não alterada').count()) === 1);
  await p.getByRole('link', { name: 'Corrigir' }).first().click();
  await p.waitForURL(/formularios\/.+\?etapa=/);
  await p.getByText('Apontado pela administração').waitFor();
  checa(
    'a etapa abre destacada, no filtro de correções',
    (await p.getByRole('button', { name: 'Correções (1)' }).count()) === 1,
  );
  await p.goto(`${BASE}/#/paineis`, { waitUntil: 'networkidle' });
  await p.getByRole('alert').filter({ hasText: 'A administração pediu correções' }).waitFor();
  checa(
    'o pop-up não volta para a mesma decisão',
    (await p.getByRole('dialog', { name: 'Novidades da administração' }).count()) === 0,
  );

  console.log('\n== Certificação (System Pro E Energy) ==');
  const energy = p.locator('li', { hasText: 'System Pro E Energy' });
  await energy.getByRole('button', { name: 'Solicitações de certificado' }).click();
  await p.getByRole('button', { name: 'Nova solicitação' }).click();
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
  await enviarSolicitacaoPelaApi();

  await sair();
  await entrarComoAdmin();
  await p.goto(`${BASE}/#/admin?aba=aprovacoes&secao=certificacoes`, { waitUntil: 'networkidle' });
  await p.locator('li', { hasText: 'QGBT-01' }).getByRole('button', { name: 'Analisar' }).click();
  await p.getByRole('heading', { name: 'QGBT-01' }).waitFor();
  await marcarPrimeiraEtapa('Falta a foto do aterramento.');
  await p.getByRole('button', { name: 'Devolver para correção' }).click();
  await p.getByRole('dialog', { name: 'Confirmar pedido de correção' }).getByRole('button', { name: 'Pedir correção' }).click();
  await p.getByText(/Solicitação devolvida/).waitFor(ESPERA);
  checa('devolve a certificação com a etapa marcada', true);

  await sair();
  await entrarComoMontador();
  checa('o pop-up avisa da devolução', await popup('Solicitação devolvida — QGBT-01'));
  await p
    .getByRole('alert')
    .getByRole('listitem')
    .filter({ hasText: 'Certificação · QGBT-01' })
    .getByRole('link', { name: 'Corrigir' })
    .click();
  await p.getByRole('region', { name: 'Correções pedidas pela administração' }).getByText('Falta a foto do aterramento.').waitFor(ESPERA);
  checa('a solicitação mostra a etapa a corrigir', (await p.getByText('Devolvida para correção').count()) > 0);
  await enviarSolicitacaoPelaApi();

  await sair();
  await entrarComoAdmin();
  await p.goto(`${BASE}/#/admin?aba=aprovacoes&secao=certificacoes`, { waitUntil: 'networkidle' });
  await p.locator('li', { hasText: 'QGBT-01' }).getByRole('button', { name: 'Analisar' }).click();
  await p.getByRole('heading', { name: 'QGBT-01' }).waitFor();
  checa(
    'aprovar exige o arquivo do certificado',
    await p.getByRole('button', { name: 'Aprovar e anexar certificado' }).isDisabled(),
  );
  const certificado = Buffer.from('%PDF-1.7\n% certificado de fumaça\n%%EOF\n', 'latin1');
  await p.getByLabel('Arquivo do certificado').setInputFiles({
    name: 'certificado-fumaca.pdf',
    mimeType: 'application/pdf',
    buffer: certificado,
  });
  await p.getByRole('button', { name: 'Aprovar e anexar certificado' }).click();
  await p.getByRole('dialog', { name: 'Confirmar aprovação' }).getByRole('button', { name: 'Aprovar' }).click();
  await p.getByText(/Solicitação aprovada e certificado anexado/).waitFor(ESPERA);
  checa('aprova anexando o certificado', true);
  await p.getByRole('tab', { name: /Certificados emitidos/ }).click();
  await p.getByRole('cell', { name: 'QGBT-01' }).waitFor(ESPERA);
  checa('o certificado entra no registro', true);

  await sair();
  await entrarComoMontador();
  checa('o pop-up avisa do certificado', await popup(/Certificado nº \S+ disponível/));
  const secaoCertificados = p.getByRole('region', { name: 'Certificados disponíveis' });
  const [download] = await Promise.all([
    p.waitForEvent('download', ESPERA),
    secaoCertificados.getByRole('button', { name: 'Baixar certificado' }).first().click(),
  ]);
  const destino = join(SAIDA, download.suggestedFilename());
  await download.saveAs(destino);
  checa(
    'baixa na tela inicial o mesmo arquivo anexado pela administração',
    download.suggestedFilename() === 'certificado-fumaca.pdf' && readFileSync(destino).equals(certificado),
    download.suggestedFilename(),
  );
} catch (e) {
  falhas += 1;
  console.error('\nFalha inesperada:', e);
  await p.screenshot({ path: join(SAIDA, 'falha.png'), fullPage: true }).catch(() => {});
} finally {
  await navegador.close();
}

checa('nenhum erro no console', erros.length === 0, erros.join(' | '));
console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nFumaça OK.');
process.exit(falhas ? 1 : 0);
