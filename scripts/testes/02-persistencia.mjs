/** Salvamento automático, concorrência entre telas e ordenação de TAGs. */
import { BASE, abrir, checa, criarProjeto, lerStore, resumo } from './lib.mjs';

const { navegador, contexto, pagina: p } = await abrir();
console.log('\n=== 02. PERSISTÊNCIA E SALVAMENTO AUTOMÁTICO ===');

await criarProjeto(p, { nome: 'Autosave', tags: ['T1'] });
await p.getByRole('button', { name: /Montagem/ }).first().click();
await p.locator('nav button').filter({ hasText: /^S1\.1/ }).click();
await p.getByRole('button', { name: 'Marcar como verificado' }).click();
await p.reload({ waitUntil: 'domcontentloaded' });   // antes dos 500 ms de espera
await p.waitForTimeout(2500);
let pre = (await lerStore(p, 'preenchimentos'))[0];
checa('02.1 resposta sobrevive a recarregar logo após marcar',
  pre?.respostas?.['S1.1']?.valor === true, JSON.stringify(pre?.respostas ?? {}));

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Abrir' }).first().click();
await p.getByRole('button', { name: /Montagem/ }).first().click();
await p.locator('nav button').filter({ hasText: /^S1\.2/ }).click();
await p.locator('textarea[id^="obs-"]').fill('Trinca no perfil lateral direito.');
await p.evaluate(() => history.back());              // "voltar" do navegador / gesto do Android
await p.waitForTimeout(2500);
pre = (await lerStore(p, 'preenchimentos'))[0];
checa('02.2 observação sobrevive ao "voltar" do navegador',
  pre?.respostas?.['S1.2']?.observacao === 'Trinca no perfil lateral direito.',
  JSON.stringify(pre?.respostas?.['S1.2'] ?? null));

const p2 = await contexto.newPage();
for (const pag of [p, p2]) {
  await pag.goto(BASE, { waitUntil: 'networkidle' });
  await pag.getByRole('button', { name: 'Abrir' }).first().click();
  await pag.getByRole('button', { name: /Montagem/ }).first().click();
  await pag.getByText('Dados do painel').first().waitFor();
}
await p.locator('nav button').filter({ hasText: /^S1\.5/ }).click();
await p.getByRole('button', { name: 'Marcar como verificado' }).click();
await p.waitForTimeout(1500);
await p2.locator('nav button').filter({ hasText: /^S1\.6/ }).click();
await p2.getByRole('button', { name: 'Marcar como verificado' }).click();
await p2.waitForTimeout(1500);
const respostas = (await lerStore(p, 'preenchimentos'))[0].respostas;
checa('02.3 duas telas abertas não apagam o trabalho uma da outra',
  respostas['S1.5']?.valor === true && respostas['S1.6']?.valor === true,
  JSON.stringify(Object.keys(respostas)));
await p2.close();

await criarProjeto(p, { nome: 'Ordem', tags: ['A', 'B', 'C'] });
await p.getByRole('button', { name: 'Remover TAG B' }).click();
await p.getByRole('button', { name: 'Remover', exact: true }).last().click();
await p.waitForTimeout(1200);
await p.getByRole('button', { name: 'Adicionar TAG' }).click();
await p.getByLabel('Nome da TAG').fill('D');
await p.getByRole('button', { name: 'Adicionar', exact: true }).click();
await p.waitForTimeout(1200);
const tags = (await lerStore(p, 'tags')).filter((t) => ['A', 'C', 'D'].includes(t.nome));
checa('02.4 TAGs não ficam com "ordem" duplicada',
  new Set(tags.map((t) => t.ordem)).size === tags.length,
  tags.map((t) => `${t.nome}:${t.ordem}`).join(' '));

await p.getByRole('button', { name: /Rotina/ }).first().click();
await p.getByText('Dados do painel').first().waitFor();
await p.getByRole('button', { name: 'pendentes', exact: true }).click();
await p.locator('nav button').filter({ hasText: /^R1\./ }).first().click();
await p.getByRole('button', { name: 'Marcar como verificado' }).click();
await p.waitForTimeout(700);
checa('02.5 filtro "pendentes" continua utilizável depois de responder',
  (await p.getByText('Nenhuma etapa neste filtro.').count()) === 0,
  'a tela cai em "Nenhuma etapa neste filtro" mesmo restando dezenas de pendências');

await navegador.close();
process.exit(resumo('02') ? 1 : 0);
