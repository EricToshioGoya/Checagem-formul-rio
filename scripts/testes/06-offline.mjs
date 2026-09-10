/** Operação sem rede: service worker, formulários e geração de PDF offline. */
import { BASE, abrir, checa, criarProjeto, resumo } from './lib.mjs';

const { navegador, contexto, pagina: p } = await abrir();
console.log('\n=== 06. OPERAÇÃO SEM REDE ===');

await criarProjeto(p, { nome: 'Offline', tags: ['T1'] });
await p.getByRole('button', { name: /Montagem/ }).first().click();
await p.locator('nav button').filter({ hasText: /^S1\.1/ }).click();
await p.getByRole('button', { name: 'Marcar como verificado' }).click();
await p.waitForTimeout(1200);
await p.getByRole('button', { name: 'Voltar ao projeto' }).click();
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForTimeout(3500);

checa('06.1 service worker registrado',
  (await p.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)) > 0);

await contexto.setOffline(true);
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3500);
const abriu = (await p.getByRole('heading', { name: 'Meus projetos' }).count()) > 0;
checa('06.2 a aplicação abre sem rede', abriu);

if (abriu) {
  await p.getByRole('button', { name: 'Abrir' }).first().click();
  await p.waitForTimeout(2000);
  const temFormularios = (await p.getByRole('button', { name: /Montagem/ }).count()) > 0;
  checa('06.3 formulários carregam do cache sem rede', temFormularios);

  if (temFormularios) {
    await p.getByRole('button', { name: /Montagem/ }).first().click();
    await p.waitForTimeout(2500);
    checa('06.4 o preenchimento abre sem rede', (await p.getByText('Dados do painel').count()) > 0);
    await p.getByRole('button', { name: 'Voltar ao projeto' }).click();
    await p.waitForTimeout(1200);

    const baixados = [];
    p.on('download', (d) => baixados.push(d.suggestedFilename()));
    await p.getByRole('button', { name: 'Gerar PDF' }).click();
    await p.getByRole('button', { name: 'Gerar e baixar' }).click();
    await p.waitForTimeout(20000);
    checa('06.5 gera o PDF sem rede', baixados.length > 0, baixados.join(', '));
  }
}
await contexto.setOffline(false);

await navegador.close();
process.exit(resumo('06') ? 1 : 0);
