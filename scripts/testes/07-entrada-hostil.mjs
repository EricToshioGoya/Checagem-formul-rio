/** Rotas inválidas, texto hostil nos campos e limites de anexo. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, SAIDA, abrir, checa, criarProjeto, lerStore, resumo } from './lib.mjs';

const { navegador, pagina: p } = await abrir();
console.log('\n=== 07. ROTAS E ENTRADA HOSTIL ===');

await p.goto(`${BASE}/#/projetos/999999`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
checa('07.1 projeto inexistente mostra mensagem em vez de tela em branco',
  (await p.locator('body').innerText()).trim().length > 0);

await p.goto(`${BASE}/#/projetos/abc`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
checa('07.2 id de projeto não numérico é tratado',
  (await p.locator('body').innerText()).trim().length > 0);

await p.goto(`${BASE}/#/projetos/1/tags/1/formularios/nao-existe`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
checa('07.3 formulário inexistente na URL é tratado',
  /não/i.test(await p.locator('body').innerText()));

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Novo projeto' }).click();
await p.locator('#empresa').fill('<img src=x onerror="window.__a=1">');
await p.locator('#nomeProjeto').fill('<script>window.__b=1</script>');
await p.locator('#operador').fill('">&<');
await p.locator('#quantidade').fill('1');
await p.locator('#tag-0').fill('../../../etc/passwd');
await p.getByRole('button', { name: 'Criar projeto' }).click();
await p.waitForTimeout(2500);
const executou = await p.evaluate(() => ({ a: window.__a, b: window.__b }));
checa('07.4 texto dos campos não é executado', !executou.a && !executou.b, JSON.stringify(executou));

const baixados = [];
p.on('download', (d) => baixados.push(d.suggestedFilename()));
await p.getByRole('button', { name: 'Gerar PDF' }).click();
await p.getByRole('button', { name: 'Gerar e baixar' }).click();
await p.waitForTimeout(15000);
checa('07.5 nome do arquivo baixado é neutralizado',
  baixados.length > 0 && baixados.every((n) => !/[<>:"/\\|?*]/.test(n)), baixados.join(', '));

// anexo grande
const grande = Buffer.concat([
  Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n'),
  Buffer.alloc(60 * 1024 * 1024, 0x20),
  Buffer.from('\ntrailer<</Root 1 0 R>>\n%%EOF\n'),
]);
writeFileSync(join(SAIDA, 'grande.pdf'), grande);
await criarProjeto(p, { nome: 'Anexo', tags: ['T1'] });
await p.getByRole('button', { name: /Rotina/ }).first().click();
await p.locator('nav button').filter({ hasText: 'R10.3' }).click();
await p.locator('input[type=file]').last().setInputFiles(join(SAIDA, 'grande.pdf'));
await p.waitForTimeout(18000);
const anexos = await lerStore(p, 'midias');
const tamanho = anexos[0]?.tamanho ?? 0;
checa('07.6 recusa ou avisa sobre anexo de 60 MB',
  anexos.length === 0 || tamanho < 30 * 1024 * 1024,
  anexos.length ? `gravou ${(tamanho / 1048576).toFixed(1)} MB no aparelho sem aviso` : 'recusado');

await navegador.close();
process.exit(resumo('07') ? 1 : 0);
