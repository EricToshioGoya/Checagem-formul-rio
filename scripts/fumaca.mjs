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
 * Checklist que contém certificado: a administração responde "Sim" em
 * "Contém certificado?" e envia o modelo em PDF; o montador preenche o
 * checklist na TAG, gera o PDF e ele vai sozinho para a aba Certificados; a
 * administração aprova, o certificado sai com código único e o montador o
 * baixa na tela inicial.
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
import { PDFDocument } from 'pdf-lib';
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

/** Cria, pela API, um checklist simples (duas etapas de conferir) no painel. */
async function criarChecklistPelaApi(painelSlug, nome) {
  return p.evaluate(
    async ({ painelSlug, nome }) => {
      const token = localStorage.getItem('sessao-token');
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const { paineis } = await (await fetch('/api/admin/paineis', { headers: h })).json();
      const painel = paineis.find((x) => x.slug === painelSlug);
      let r = await fetch(`/api/admin/paineis/${painel.id}/formularios`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ tipo: 'montagem', nome }),
      });
      if (!r.ok) throw new Error(`criar checklist: ${await r.text()}`);
      const { formulario } = await r.json();
      const definicao = {
        id: formulario.id,
        nome,
        linhaProduto: 'SEN Plus',
        tipo: 'montagem',
        revisao: 'rev00',
        dataRevisao: '2026-10-19',
        cabecalho: [],
        secoes: [
          {
            id: 'S1',
            titulo: 'Conferência final',
            etapas: [
              { id: 'S1.1', descricao: 'Barramentos apertados', tipoResposta: 'check', ativa: true, observacao: true },
              { id: 'S1.2', descricao: 'Identificação dos circuitos', tipoResposta: 'check', ativa: true, observacao: true },
            ],
          },
        ],
      };
      r = await fetch(`/api/admin/formularios/${formulario.id}`, {
        method: 'PUT',
        headers: h,
        body: JSON.stringify({ nome, ativo: true, definicao }),
      });
      if (!r.ok) throw new Error(`gravar checklist: ${await r.text()}`);
      return formulario.id;
    },
    { painelSlug, nome },
  );
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

  console.log('\n== Checklist com certificado (administração) ==');
  const NOME_CERT = 'Inspeção final com certificado';
  await sair();
  await entrarComoAdmin();
  await criarChecklistPelaApi('sen-plus', NOME_CERT);
  await p.goto(`${BASE}/#/admin?aba=paineis`, { waitUntil: 'networkidle' });
  // O painel e o checklist são itens de lista aninhados: o de dentro é o último.
  await p.locator('li', { hasText: NOME_CERT }).last().getByRole('button', { name: /checklist/ }).click();
  await p.getByRole('group', { name: 'Contém certificado?' }).getByRole('radio', { name: 'Sim' }).check();
  const modelo = await PDFDocument.create();
  modelo.addPage([595, 842]);
  modelo.addPage([595, 842]);
  await p.getByLabel('Modelo do certificado em PDF').setInputFiles({
    name: 'modelo-fumaca.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await modelo.save()),
  });
  await p.getByText('Modelo: modelo-fumaca.pdf').waitFor(ESPERA);
  await p.getByText('Gravado', { exact: true }).waitFor(ESPERA);
  checa('o construtor aceita "Contém certificado? Sim" com o modelo em PDF', true);
  await sair();
  await entrarComoMontador();

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
  await tag1.getByRole('checkbox', { name: /Montagem Checklist de/ }).check();
  await tag1.getByRole('checkbox', { name: /Inspeção final com certificado/ }).check();
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
  await p.locator('button', { hasText: 'Checklist de Montagem' }).first().click();
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

  console.log('\n== Checklist com certificado (montador) ==');
  await p.goto(urlProjeto, { waitUntil: 'networkidle' });
  await p.locator('button', { hasText: NOME_CERT }).first().click();
  await p.waitForURL(/formularios/);
  const etapas = p.locator('nav[aria-label="Etapas do formulário"] li button');
  for (const i of [0, 1]) {
    await etapas.nth(i).click();
    await p.getByRole('button', { name: 'Marcar como verificado' }).click();
    await p.getByRole('status').filter({ hasText: 'Salvo' }).waitFor();
  }
  await p.getByRole('button', { name: 'Gerar PDF deste checklist' }).click();
  const dialogoCert = p.getByRole('dialog', { name: 'Gerar PDF' });
  await Promise.all([
    p.waitForEvent('download', ESPERA),
    dialogoCert.getByRole('button', { name: 'Gerar e baixar' }).click(),
  ]);
  await dialogoCert.getByText(/enviado à administração para emitir o certificado/).waitFor(ESPERA);
  checa('o PDF do checklist completo vai sozinho para a aba Certificados', true);
  await dialogoCert.getByRole('button', { name: 'Fechar' }).first().click();

  console.log('\n== Emissão do certificado (administração) ==');
  await sair();
  await entrarComoAdmin();
  await p.goto(`${BASE}/#/admin?aba=certificados`, { waitUntil: 'networkidle' });
  await p.locator('li', { hasText: 'QGBT-01' }).getByRole('button', { name: 'Analisar' }).click();
  await p.getByRole('heading', { name: /TAG QGBT-01/ }).waitFor();
  await p.getByRole('button', { name: 'Aprovar e emitir certificado' }).click();
  await p.getByRole('dialog', { name: 'Confirmar aprovação' }).getByRole('button', { name: 'Aprovar' }).click();
  const aviso = p.getByText(/Certificado nº [2-9A-Z]{4}-[2-9A-Z]{4} emitido/);
  await aviso.waitFor(ESPERA);
  const codigo = /([2-9A-Z]{4}-[2-9A-Z]{4})/.exec(await aviso.innerText())[1];
  checa('aprovar emite o certificado com código único', /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/.test(codigo), codigo);
  await p.getByRole('tab', { name: /Certificados emitidos/ }).click();
  await p.getByPlaceholder(/Código \(ex\.: 7K3F-9Q2M\)/).fill(codigo.toLowerCase());
  await p.getByRole('cell', { name: codigo }).waitFor(ESPERA);
  checa('o certificado aparece no registro, achado pelo código', true);

  await sair();
  await entrarComoMontador();
  checa('o pop-up avisa do certificado emitido', await popup(`Certificado nº ${codigo} emitido`));
  const secaoCertificados = p.getByRole('region', { name: 'Certificados disponíveis' });
  const [download] = await Promise.all([
    p.waitForEvent('download', ESPERA),
    secaoCertificados.getByRole('button', { name: 'Baixar certificado' }).first().click(),
  ]);
  const destino = join(SAIDA, download.suggestedFilename());
  await download.saveAs(destino);
  const baixado = await PDFDocument.load(readFileSync(destino));
  checa(
    'baixa na tela inicial o certificado emitido do modelo, com o código',
    download.suggestedFilename().includes(codigo) &&
      baixado.getPageCount() === 2 &&
      baixado.getTitle() === `Certificado ${codigo}`,
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
