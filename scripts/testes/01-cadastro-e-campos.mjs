/** Cadastro de projeto, TAGs e os oito tipos de campo. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASE, SAIDA, PNG_MINIMO, PDF_MINIMO,
  abrir, checa, ok, criarProjeto, lerStore, resumo,
} from './lib.mjs';

const { navegador, pagina: p } = await abrir();
console.log('\n=== 01. CADASTRO E TIPOS DE CAMPO ===');

await p.goto(BASE, { waitUntil: 'networkidle' });
checa('01.1 abre na lista de projetos', (await p.getByRole('heading', { name: 'Meus projetos' }).count()) === 1);

await p.getByRole('button', { name: 'Novo projeto' }).click();
await p.getByRole('button', { name: 'Criar projeto' }).click();
checa('01.2 exige empresa e nome do projeto', (await p.getByText('Informe a empresa e o nome do projeto.').count()) === 1);
await p.locator('#empresa').fill('ACME');
await p.locator('#nomeProjeto').fill('Obra 1');
await p.getByRole('button', { name: 'Criar projeto' }).click();
checa('01.3 exige operador', (await p.getByText(/Informe o nome do operador/).count()) === 1);

await p.locator('#operador').fill('Eric');
await p.locator('#quantidade').fill('2');
await p.locator('#tag-0').fill('QGBT-01');
await p.locator('#tag-1').fill('CCM-02');
await p.locator('#quantidade').fill('');
await p.locator('#quantidade').fill('2');
checa('01.4 nomes de TAG sobrevivem a limpar a quantidade',
  (await p.locator('#tag-0').inputValue()) === 'QGBT-01',
  `tag-0 = "${await p.locator('#tag-0').inputValue()}"`);

await p.locator('#tag-0').fill('QGBT-01');
await p.locator('#tag-1').fill('CCM-02');
await p.getByRole('button', { name: 'Criar projeto' }).click();
await p.getByRole('heading', { name: 'Obra 1' }).waitFor();
ok('01.5 cria projeto com 2 TAGs');

await p.getByRole('button', { name: 'Adicionar TAG' }).click();
await p.getByLabel('Nome da TAG').fill('TSA-03');
await p.getByRole('button', { name: 'Adicionar', exact: true }).click();
await p.getByRole('heading', { name: 'TSA-03' }).waitFor();
ok('01.6 adiciona TAG');

await p.locator('li').filter({ has: p.getByRole('heading', { name: 'CCM-02' }) })
  .getByRole('button', { name: 'Renomear' }).click();
await p.getByLabel('Novo nome').fill('CCM-02B');
await p.getByRole('button', { name: 'Salvar' }).click();
await p.getByRole('heading', { name: 'CCM-02B' }).waitFor();
ok('01.7 renomeia TAG');

// --- Montagem: cabeçalho, check_com_foto, seleção, número
await p.locator('li').filter({ has: p.getByRole('heading', { name: 'QGBT-01' }) })
  .getByRole('button', { name: /Montagem/ }).click();
await p.getByText('Dados do painel').first().waitFor();

await p.locator('#cab-fabricante').fill('ACME');
await p.locator('#cab-un').fill('380');
await p.locator('#cab-norma').selectOption('IEC 61439-2');
await p.waitForTimeout(900);
const cab = (await lerStore(p, 'preenchimentos'))[0]?.cabecalho ?? {};
checa('01.8 cabeçalho grava texto, número e seleção',
  cab.fabricante === 'ACME' && cab.un === '380' && cab.norma === 'IEC 61439-2', JSON.stringify(cab));

await p.locator('nav button').filter({ hasText: /^S1\.1/ }).click();
await p.getByRole('button', { name: 'Marcar como verificado' }).click();
writeFileSync(join(SAIDA, 'foto.png'), PNG_MINIMO);
await p.locator('input[type=file]').last().setInputFiles(join(SAIDA, 'foto.png'));
await p.waitForTimeout(1300);
const midias = await lerStore(p, 'midias');
checa('01.9 check_com_foto grava confirmação e imagem recomprimida em JPEG',
  midias.length === 1 && midias[0].mime === 'image/jpeg', JSON.stringify(midias.map((m) => m.mime)));

await p.locator('textarea[id^="obs-"]').fill('Conferido com o desenho aprovado.');
await p.waitForTimeout(900);
let pre = (await lerStore(p, 'preenchimentos'))[0];
checa('01.10 observação grava',
  pre.respostas['S1.1']?.observacao === 'Conferido com o desenho aprovado.');

await p.getByRole('button', { name: 'Verificado', exact: false }).first().click();
await p.waitForTimeout(900);
pre = (await lerStore(p, 'preenchimentos'))[0];
checa('01.11 desmarcar preserva a observação',
  pre.respostas['S1.1']?.observacao === 'Conferido com o desenho aprovado.');

for (let i = 0; i < 5; i += 1) {
  if (await p.getByRole('button', { name: 'Anexar arquivo' }).isDisabled()) break;
  await p.locator('input[type=file]').last().setInputFiles(join(SAIDA, 'foto.png'));
  await p.waitForTimeout(900);
}
checa('01.12 respeita o limite de 4 fotos por etapa', (await lerStore(p, 'midias')).length === 4,
  `${(await lerStore(p, 'midias')).length} fotos`);
await p.getByRole('button', { name: 'Remover arquivo' }).first().click();
await p.waitForTimeout(700);
checa('01.13 remove foto', (await lerStore(p, 'midias')).length === 3);

await p.locator('nav button').filter({ hasText: /^S1\.4/ }).click();
await p.locator('#campo-S1\\.4').selectOption({ index: 1 });
await p.waitForTimeout(900);
pre = (await lerStore(p, 'preenchimentos'))[0];
checa('01.14 tipo "selecao" grava a opção', typeof pre.respostas['S1.4']?.valor === 'string');

const def = JSON.parse(readFileSync('public/forms/sen-plus-montagem.json', 'utf8'));
const etapaNumero = def.secoes.flatMap((s) => s.etapas).find((e) => e.tipoResposta === 'numero');
const seletorNumero = `#campo-${etapaNumero.id.replace('.', '\\.')}`;
await p.locator('nav button').filter({ hasText: new RegExp(`^${etapaNumero.id.replace('.', '\\.')}`) }).click();
await p.locator(seletorNumero).fill('12.5');
await p.waitForTimeout(900);
pre = (await lerStore(p, 'preenchimentos'))[0];
checa('01.15 tipo "numero" grava com ponto decimal', pre.respostas[etapaNumero.id]?.valor === 12.5);

await p.locator(seletorNumero).fill('');
await p.locator(seletorNumero).click();
await p.locator(seletorNumero).pressSequentially('12,5');
await p.waitForTimeout(900);
pre = (await lerStore(p, 'preenchimentos'))[0];
const comVirgula = pre.respostas[etapaNumero.id]?.valor;
checa('01.16 tipo "numero" aceita a vírgula decimal do pt-BR', comVirgula === 12.5,
  `digitado "12,5" → gravado ${JSON.stringify(comVirgula)} (campo na tela: "${await p.locator(seletorNumero).inputValue()}")`);

await p.locator('nav button').filter({ hasText: /^S1\.1/ }).click();
await p.getByRole('button', { name: /Ver ajuda da etapa/ }).first().click();
await p.getByRole('dialog').waitFor();
await p.waitForTimeout(2500);
const modal = await p.getByRole('dialog').innerText();
checa('01.17 apoio ausente vira aviso, sem quebrar a tela', /não disponível|não tem conteúdo de apoio/.test(modal));
await p.getByRole('button', { name: 'Fechar' }).first().click();

await p.reload({ waitUntil: 'networkidle' });
const progresso = await p.getByText(/\d+\/38 etapas/).textContent();
checa('01.18 progresso persiste após recarregar', /[1-9]\d*\/38/.test(progresso), progresso);

const antes = ['todas', 'pendentes', 'respondidas'];
const contagens = {};
for (const f of antes) {
  await p.getByRole('button', { name: f, exact: true }).click();
  await p.waitForTimeout(400);
  contagens[f] = await p.locator('nav button').filter({ hasText: /^S\d/ }).count();
}
checa('01.19 filtros pendentes + respondidas = todas',
  contagens.pendentes + contagens.respondidas === contagens.todas, JSON.stringify(contagens));

// --- Rotina BT: check, grade numérica e anexo PDF
await p.getByRole('button', { name: 'Voltar ao projeto' }).click();
await p.getByRole('heading', { name: 'Obra 1' }).waitFor();
await p.locator('li').filter({ has: p.getByRole('heading', { name: 'QGBT-01' }) })
  .getByRole('button', { name: /Rotina/ }).click();
await p.getByText('Dados do painel').first().waitFor();

await p.locator('nav button').filter({ hasText: 'R5.1' }).click();
await p.getByLabel('L1 – L2 — Megger antes').fill('150');
await p.waitForTimeout(900);
let rotina = (await lerStore(p, 'preenchimentos')).find((x) => x.formId === 'rotina-bt');
checa('01.20 grade_numerica grava o valor',
  JSON.stringify(rotina?.respostas['R5.1']?.valor ?? {}).includes('150'));

await p.getByLabel('L1 – L2 — Megger antes').fill('1e999');
await p.waitForTimeout(900);
const naoFinito = await p.evaluate(() => new Promise((r) => {
  const q = indexedDB.open('verificacao-montagem');
  q.onsuccess = () => {
    const g = q.result.transaction('preenchimentos', 'readonly').objectStore('preenchimentos').getAll();
    g.onsuccess = () => {
      const x = g.result.find((v) => v.formId === 'rotina-bt');
      r(String(x?.respostas?.['R5.1']?.valor?.['l1-l2']?.meggerAntes));
    };
  };
}));
checa('01.21 grade descarta valor não finito', naoFinito !== 'Infinity', `gravado: ${naoFinito}`);

writeFileSync(join(SAIDA, 'doc.pdf'), PDF_MINIMO);
writeFileSync(join(SAIDA, 'falso.pdf'), Buffer.from('MZ nao sou um pdf'));
await p.locator('nav button').filter({ hasText: 'R10.3' }).click();
await p.locator('input[type=file]').last().setInputFiles(join(SAIDA, 'doc.pdf'));
await p.waitForTimeout(1200);
checa('01.22 anexo_pdf grava o arquivo',
  (await lerStore(p, 'midias')).some((m) => m.mime === 'application/pdf'));

await p.locator('input[type=file]').last().setInputFiles(join(SAIDA, 'falso.pdf'));
await p.waitForTimeout(1200);
const anexos = (await lerStore(p, 'midias')).filter((m) => m.mime === 'application/pdf');
checa('01.23 recusa arquivo que só tem a extensão .pdf', anexos.length === 1,
  `${anexos.length} anexos aceitos como PDF`);

await navegador.close();
process.exit(resumo('01') ? 1 : 0);
