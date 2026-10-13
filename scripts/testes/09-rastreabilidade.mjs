/**
 * Rastreabilidade do documento: o que acontece com uma resposta já registrada
 * quando o administrador altera o formulário depois do preenchimento.
 */
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { BASE, SAIDA, abrir, checa, criarProjeto, entrarNaAdministracao, lerStore, resumo } from './lib.mjs';

const { navegador, pagina: p } = await abrir();
console.log('\n=== 09. RASTREABILIDADE APÓS EDIÇÃO DO FORMULÁRIO ===');

await criarProjeto(p, { nome: 'Rastreio', tags: ['T1'] });
await p.getByRole('button', { name: /Montagem/ }).first().click();
await p.locator('nav button').filter({ hasText: /^S1\.1/ }).click();
await p.getByRole('button', { name: 'Marcar como verificado' }).click();
await p.locator('textarea[id^="obs-"]').fill('Ensaio conferido com o inspetor.');
await p.waitForTimeout(1500);
await p.getByRole('button', { name: 'Voltar ao projeto' }).click();
await p.getByRole('heading', { name: 'Rastreio' }).waitFor();

await entrarNaAdministracao(p);
await p.getByRole('button', { name: /Verificação de Montagem/ }).click();
await p.getByRole('button', { name: /S1 —/ }).click();
await p.getByRole('button', { name: 'Desativar' }).first().click();   // desativa S1.1
await p.waitForTimeout(2000);

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Abrir' }).first().click();
await p.waitForTimeout(2000);
const naTela = await p.locator('body').innerText();
const resposta = (await lerStore(p, 'preenchimentos'))
  .find((x) => x.formId === 'sen-plus-montagem')?.respostas?.['S1.1'];
checa('09.1 a aplicação avisa que há resposta em etapa desativada',
  /desativad|não aparece|oculta/i.test(naTela),
  `a resposta continua gravada (${JSON.stringify(resposta)}) e some do progresso sem aviso`);

const baixados = [];
p.on('download', async (d) => { const f = join(SAIDA, `rastreio-${d.suggestedFilename()}`); await d.saveAs(f); baixados.push(f); });
await p.getByRole('button', { name: 'Gerar PDF' }).click();
await p.getByRole('button', { name: 'Gerar e baixar' }).click();
await p.getByText('Arquivos gerados:').waitFor({ timeout: 90000 });
await p.waitForTimeout(3000);

const pdf = baixados.find((f) => f.includes('MONTAGEM'));
if (pdf) {
  const texto = execSync(`node scripts/testes/inspecionar-pdf.mjs "${pdf}" --texto`).toString();
  checa('09.2 o PDF preserva a resposta já registrada na etapa desativada',
    texto.includes('Ensaio conferido com o inspetor'),
    'a etapa S1.1 e a observação registrada sumiram do documento entregue ao inspetor');
}

await navegador.close();
process.exit(resumo('09') ? 1 : 0);
