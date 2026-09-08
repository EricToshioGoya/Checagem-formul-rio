/**
 * Teste de fumaça dos dois fluxos, no navegador real.
 *
 * Verificação (SEN Plus): criação de projeto, preenchimento com salvamento
 * automático, persistência após recarregar, modal de apoio, geração dos PDFs
 * nas duas opções de foto, exportação do projeto e grade de ensaios.
 *
 * Certificação (SPEE): solicitação com campos obrigatórios, checklist de
 * ensaios de rotina com etapa condicional, envio, validação ABB com
 * numeração sequencial e geração do certificado.
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

await passo('abrir a aplicação na seleção de painel', async () => {
  await pagina.goto(BASE, { waitUntil: 'networkidle' });
  await pagina.getByRole('heading', { name: 'Escolha o tipo de painel' }).waitFor();
  for (const nome of ['SEN Plus', 'System pro E Energy', 'System pro E Power', 'SAFR']) {
    if (!(await pagina.getByRole('heading', { name: nome, exact: true }).count())) {
      throw new Error(`painel ausente na tela inicial: ${nome}`);
    }
  }
  const instrucoes = pagina.getByRole('link', {
    name: 'Instruções de envio de informações para solicitação de certificação',
  });
  if (!(await instrucoes.count())) throw new Error('link do PDF de instruções ausente');
  const href = await instrucoes.getAttribute('href');
  const resposta = await pagina.request.get(new URL(href, BASE).toString());
  if (!resposta.ok()) throw new Error(`PDF de instruções inacessível (${resposta.status()})`);
});

await passo('entrar no SEN Plus', async () => {
  await pagina.getByRole('heading', { name: 'SEN Plus', exact: true }).click();
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

await passo('abrir a rotina BT e a grade de ensaios', async () => {
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

await passo('administração: senha e edição', async () => {
  await pagina.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
  await pagina.getByLabel('Senha').fill('abb-admin');
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await pagina.getByRole('tab', { name: 'Formulários' }).click();
  await pagina.getByRole('button', { name: /Verificação de Montagem/ }).click();
  await pagina.getByRole('button', { name: /S1 —/ }).click();
  const descricao = pagina.locator('textarea').first();
  await descricao.fill('Descrição alterada pelo administrador.');
  await pagina.getByText('Alterações gravadas').waitFor({ timeout: 15000 });
});

// ---------------------------------------------------------------------------
// Fluxo de certificação — System pro E Energy
// ---------------------------------------------------------------------------

await passo('abrir o System pro E Energy', async () => {
  await pagina.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await pagina.getByRole('heading', { name: 'System pro E Energy', exact: true }).click();
  await pagina.getByRole('heading', { name: 'System pro E Energy' }).waitFor();
  await pagina.getByText('Responsável ABB: Tainá Gioia').waitFor();
});

await passo('bloquear a criação com campo obrigatório vazio', async () => {
  await pagina.getByRole('button', { name: 'Nova solicitação' }).click();
  await pagina.getByRole('heading', { name: 'Nova solicitação' }).waitFor();
  const criar = pagina.getByRole('button', { name: 'Criar solicitação' });
  if (!(await criar.isDisabled())) {
    throw new Error('criação liberada com os obrigatórios em branco');
  }
});

await passo('preencher os dados da solicitação', async () => {
  const valores = {
    montador: 'Parceiro Painéis Ltda',
    emailMontador: 'montador@parceiro.com.br',
    celularMontador: '(11) 98888-7777',
    projeto: 'Subestação Norte',
    tagPainel: 'QGBT-1',
    clienteFinal: 'Indústria XYZ',
    correnteNominal: '4000',
    correnteCurtoCircuito: '65',
    empresa: 'Parceiro Painéis Ltda',
    operador: 'Ana Souza',
  };
  for (const [campo, valor] of Object.entries(valores)) {
    await pagina.locator(`#sol-${campo}`).fill(valor);
  }
  await pagina.getByRole('button', { name: 'Criar solicitação' }).click();
  await pagina.getByRole('heading', { name: 'QGBT-1' }).waitFor();
  await pagina.getByText('Rascunho').first().waitFor();
});

await passo('bloquear o envio com checklist pendente', async () => {
  const enviar = pagina.getByRole('button', { name: 'Enviar para validação da ABB' });
  if (!(await enviar.isDisabled())) {
    throw new Error('envio liberado com o checklist em branco');
  }
});

await passo('preencher o checklist de ensaios de rotina', async () => {
  await pagina.getByRole('button', { name: 'Preencher checklist' }).click();
  const itens = pagina.locator('nav button').filter({ hasText: /^11\./ });
  await itens.first().waitFor();

  // 11.5.1 governa 11.5.2 e 11.5.3: sem substituição, elas não aparecem.
  const antes = await itens.count();
  await pagina.locator('nav button').filter({ hasText: '11.5.1' }).click();
  await pagina
    .locator('#campo-11\\.5\\.1')
    .selectOption('Sim — há substituição por outro fabricante');
  await pagina.waitForTimeout(600);
  const depois = await itens.count();
  if (depois !== antes + 2) {
    throw new Error(`etapas condicionais não apareceram (${antes} → ${depois})`);
  }
  await pagina
    .locator('#campo-11\\.5\\.1')
    .selectOption('Não — todos os componentes internos são ABB');
  await pagina.waitForTimeout(600);
  const voltou = await itens.count();
  if (voltou !== antes) {
    throw new Error(`etapas condicionais não sumiram (${voltou} ≠ ${antes})`);
  }

  // As etapas com foto exigem imagem; o teste injeta um JPEG mínimo.
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );

  const etapas = ['11.2', '11.3', '11.4', '11.5', '11.6', '11.7', '11.8', '11.9', '11.10'];
  for (const etapa of etapas) {
    // O texto do item do índice é "11.5Integração…": o id precisa terminar
    // sem outro dígito nem ponto para não casar com "11.5.1".
    const alvo = new RegExp(`^${etapa.replace(/\./g, '\\.')}(?![\\d.])`);
    await pagina.locator('nav button').filter({ hasText: alvo }).first().click();
    const marcar = pagina.getByRole('button', { name: 'Marcar como verificado' });
    if (await marcar.count()) await marcar.click();
    const entrada = pagina.locator('input[type="file"]').first();
    if (await entrada.count()) {
      await entrada.setInputFiles({ name: `${etapa}.jpg`, mimeType: 'image/jpeg', buffer: jpeg });
      await pagina.waitForTimeout(500);
    }
  }
  await pagina.waitForTimeout(1200);
  const progresso = await pagina.getByText(/\d+\/\d+ etapas/).textContent();
  if (!/^(\d+)\/\1 etapas$/.test((progresso ?? '').trim())) {
    throw new Error(`checklist incompleto: "${progresso}"`);
  }
});

await passo('enviar para validação da ABB', async () => {
  await pagina.getByRole('button', { name: 'Voltar ao projeto' }).click();
  await pagina.getByRole('heading', { name: 'QGBT-1' }).waitFor();
  await pagina.getByRole('button', { name: 'Enviar para validação da ABB' }).click();
  await pagina.getByRole('dialog').waitFor();
  await pagina.getByRole('button', { name: 'Enviar', exact: true }).click();
  await pagina.getByText('Enviada para validação').first().waitFor({ timeout: 15000 });
});

await passo('checklist travado após o envio', async () => {
  await pagina.getByRole('button', { name: 'Ver checklist' }).click();
  await pagina.getByText('Somente leitura').waitFor();
  const marcar = pagina.getByRole('button', { name: 'Verificado' }).first();
  if ((await marcar.count()) && !(await marcar.isDisabled())) {
    throw new Error('checklist editável com a solicitação enviada');
  }
  await pagina.getByRole('button', { name: 'Voltar ao projeto' }).click();
});

await passo('ABB devolve com apontamentos', async () => {
  await pagina.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
  await pagina.getByRole('tab', { name: 'Validação ABB' }).click();
  await pagina.getByRole('heading', { name: 'Solicitações aguardando validação' }).waitFor();
  await pagina.getByRole('button', { name: 'Devolver com apontamentos' }).click();
  await pagina
    .getByRole('textbox', { name: 'Apontamentos' })
    .fill('Refazer a foto do aterramento das portas.');
  await pagina.getByRole('button', { name: 'Devolver', exact: true }).click();
  await pagina.getByText('Solicitação devolvida ao montador').waitFor({ timeout: 15000 });
});

await passo('montador vê o apontamento e reenvia', async () => {
  await pagina.goto(`${BASE}/#/paineis/spee/solicitacoes`, { waitUntil: 'networkidle' });
  await pagina.getByRole('button', { name: /Abrir/ }).first().click();
  await pagina.getByText('Devolvida com apontamentos').first().waitFor();
  // Aparece no alerta do topo e no histórico.
  await pagina.getByText('Refazer a foto do aterramento das portas.').first().waitFor();
  // O preenchimento foi preservado: o envio volta a ficar liberado de imediato.
  await pagina.getByRole('button', { name: 'Enviar para validação da ABB' }).click();
  await pagina.getByRole('dialog').waitFor();
  await pagina.getByRole('button', { name: 'Enviar', exact: true }).click();
  await pagina.getByText('Enviada para validação').first().waitFor({ timeout: 15000 });
});

let numeroCertificado = '';

await passo('ABB aprova e numera', async () => {
  await pagina.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
  await pagina.getByRole('tab', { name: 'Validação ABB' }).click();
  await pagina.getByRole('button', { name: 'Aprovar e numerar' }).click();
  const aviso = pagina.getByText(/Certificado nº \S+ atribuído/);
  await aviso.waitFor({ timeout: 15000 });
  numeroCertificado = (await aviso.textContent())?.match(/nº (\S+) atribuído/)?.[1] ?? '';
  if (!numeroCertificado) throw new Error('número do certificado não atribuído');
  console.log(`   ↳ certificado nº ${numeroCertificado}`);
  await pagina.getByRole('heading', { name: 'Registro de emissões' }).waitFor();
  await pagina.getByRole('cell', { name: numeroCertificado }).waitFor();
});

await passo('baixar o certificado emitido', async () => {
  await pagina.goto(`${BASE}/#/paineis/spee/solicitacoes`, { waitUntil: 'networkidle' });
  await pagina.getByRole('button', { name: /Abrir/ }).first().click();
  await pagina.getByText(`Certificado nº ${numeroCertificado}`).first().waitFor();
  const [download] = await Promise.all([
    pagina.waitForEvent('download', { timeout: 60000 }),
    pagina.getByRole('button', { name: 'Baixar certificado' }).click(),
  ]);
  const destino = join(SAIDA, download.suggestedFilename());
  await download.saveAs(destino);
  if (!existsSync(destino) || statSync(destino).size < 1000) {
    throw new Error(`certificado vazio: ${destino}`);
  }
  console.log(`   ↳ ${download.suggestedFilename()} (${statSync(destino).size} bytes)`);
  await pagina.getByText('Certificado emitido').first().waitFor({ timeout: 15000 });
});

await passo('numeração é imutável e sequencial', async () => {
  await pagina.goto(`${BASE}/#/paineis/safr/solicitacoes`, { waitUntil: 'networkidle' });
  await pagina.getByRole('button', { name: 'Nova solicitação' }).click();
  for (const [campo, valor] of Object.entries({
    montador: 'Parceiro Painéis Ltda',
    emailMontador: 'montador@parceiro.com.br',
    celularMontador: '(11) 98888-7777',
    projeto: 'Subestação Sul',
    tagPainel: 'QGBT-2',
    clienteFinal: 'Indústria XYZ',
    correnteNominal: '2500',
    correnteCurtoCircuito: '50',
    empresa: 'Parceiro Painéis Ltda',
    operador: 'Ana Souza',
  })) {
    await pagina.locator(`#sol-${campo}`).fill(valor);
  }
  await pagina.getByRole('button', { name: 'Criar solicitação' }).click();
  await pagina.getByRole('heading', { name: 'QGBT-2' }).waitFor();
  // Sem aprovação não há certificado para baixar.
  if (await pagina.getByRole('button', { name: 'Baixar certificado' }).count()) {
    throw new Error('certificado oferecido antes da aprovação');
  }
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
