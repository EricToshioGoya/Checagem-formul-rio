/** Geração de PDF, ZIP de fotos e exportação/importação do projeto. */
import { writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { BASE, SAIDA, PNG_MINIMO, abrir, checa, criarProjeto, lerStore, resumo } from './lib.mjs';

const { navegador, pagina: p } = await abrir();
console.log('\n=== 03. EXPORTAÇÃO, PDF E ZIP ===');
writeFileSync(join(SAIDA, 'foto.png'), PNG_MINIMO);

// Uma observação de campo bem mais longa que a folha, para saber se o registro
// do montador chega inteiro ao documento ou é cortado.
const OBSERVACAO_LONGA = Array.from(
  { length: 120 },
  (_, i) => `Ponto ${i + 1}: folga acima do tolerado no perfil lateral, corrigida com calço.`,
).join(' ');
writeFileSync(join(SAIDA, 'observacao.txt'), OBSERVACAO_LONGA);

const baixados = [];
p.on('download', async (d) => {
  const destino = join(SAIDA, d.suggestedFilename());
  await d.saveAs(destino);
  baixados.push(destino);
});

// Duas TAGs cujo nome normaliza para o mesmo texto.
await criarProjeto(p, { nome: 'Exportacao', tags: ['QGBT-01', 'QGBT 01'] });
for (let i = 0; i < 2; i += 1) {
  await p.locator('li').nth(i).getByRole('button', { name: /Montagem/ }).click();
  await p.locator('nav button').filter({ hasText: /^S1\.1/ }).click();
  await p.getByRole('button', { name: 'Marcar como verificado' }).click();
  await p.locator('input[type=file]').last().setInputFiles(join(SAIDA, 'foto.png'));
  await p.waitForTimeout(1300);
  if (i === 0) {
    await p.locator('textarea[id^="obs-"]').fill(OBSERVACAO_LONGA);
    await p.waitForTimeout(1200);
  }
  await p.getByRole('button', { name: 'Voltar ao projeto' }).click();
  await p.getByRole('heading', { name: 'Exportacao' }).waitFor();
}

await p.getByRole('button', { name: 'Gerar PDF' }).click();
await p.getByRole('button', { name: 'Gerar e baixar' }).click();
await p.getByText('Arquivos gerados:').waitFor({ timeout: 120000 });
await p.waitForTimeout(3000);
const pdfs = baixados.filter((f) => f.endsWith('.pdf'));
checa('03.1 gera um PDF por tipo de verificação, com fotos embutidas', pdfs.length >= 2,
  pdfs.map((f) => f.split('/').pop()).join(', '));

const pdfMontagem = pdfs.find((f) => f.includes('MONTAGEM'));
if (pdfMontagem) {
  const analise = JSON.parse(
    execSync(
      `node scripts/testes/inspecionar-pdf.mjs "${pdfMontagem}" --contem "${join(SAIDA, 'observacao.txt')}"`,
    ).toString(),
  );
  checa('03.2 nenhum texto do PDF invade o rodapé nem sai da página', analise.foraDaArea === 0,
    `${analise.foraDaArea} trecho(s) abaixo do rodapé; exemplo: ${JSON.stringify(analise.amostras[0] ?? null)}`);
  checa('03.3 a observação longa chega inteira ao PDF', analise.contem,
    `${analise.caracteresPresentes} de ${analise.caracteresEsperados} caracteres registrados chegaram ao documento`);
}

baixados.length = 0;
await p.getByText('PDF sem fotos + arquivo ZIP separado com as imagens').click();
await p.getByRole('button', { name: 'Gerar e baixar' }).click();
await p.waitForTimeout(9000);
const zipFotos = baixados.find((f) => f.includes('MONTAGEM-FOTOS'));
checa('03.4 gera o ZIP de fotos', !!zipFotos, baixados.map((f) => f.split('/').pop()).join(', '));
if (zipFotos) {
  const dentro = execSync(`unzip -Z1 "${zipFotos}"`).toString().trim().split('\n');
  checa('03.5 ZIP entrega as fotos das duas TAGs homônimas', dentro.length === 2,
    `${dentro.length} arquivo(s) para 2 fotos: ${dentro.join(', ')}`);
}
await p.getByRole('button', { name: 'Fechar' }).last().click();

baixados.length = 0;
await p.getByRole('button', { name: 'Exportar projeto' }).click();
await p.waitForTimeout(5000);
const backup = baixados.find((f) => f.includes('BACKUP'));
checa('03.6 exporta o projeto em .zip', !!backup && statSync(backup).size > 500,
  backup ? `${statSync(backup).size} bytes` : 'sem arquivo');

const antes = {
  projetos: (await lerStore(p, 'projetos')).length,
  midias: (await lerStore(p, 'midias')).length,
  preenchimentos: (await lerStore(p, 'preenchimentos')).length,
};
await p.getByRole('button', { name: 'Voltar aos projetos' }).click();
await p.getByRole('heading', { name: 'Meus projetos' }).waitFor();
await p.locator('input[type=file]').first().setInputFiles(backup);
await p.waitForTimeout(5000);
const depois = {
  projetos: (await lerStore(p, 'projetos')).length,
  midias: (await lerStore(p, 'midias')).length,
  preenchimentos: (await lerStore(p, 'preenchimentos')).length,
};
checa('03.7 importa o projeto de volta com respostas e fotos',
  depois.projetos === antes.projetos + 1 &&
  depois.midias === antes.midias * 2 &&
  depois.preenchimentos === antes.preenchimentos * 2,
  JSON.stringify({ antes, depois }));
checa('03.8 projeto importado ganha o sufixo "(importado)"',
  (await lerStore(p, 'projetos')).some((x) => /\(importado\)$/.test(x.nomeProjeto)));

const importado = (await lerStore(p, 'projetos')).find((x) => /\(importado\)$/.test(x.nomeProjeto));
await p.getByRole('button', { name: `Excluir projeto ${importado.nomeProjeto}` }).click();
await p.getByRole('button', { name: 'Excluir', exact: true }).last().click();
await p.waitForTimeout(2000);
const fim = {
  projetos: (await lerStore(p, 'projetos')).length,
  midias: (await lerStore(p, 'midias')).length,
  preenchimentos: (await lerStore(p, 'preenchimentos')).length,
};
checa('03.9 excluir projeto remove TAGs, preenchimentos e mídias em cascata',
  JSON.stringify(fim) === JSON.stringify(antes), JSON.stringify(fim));

await navegador.close();
process.exit(resumo('03') ? 1 : 0);
