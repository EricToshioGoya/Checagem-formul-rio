/** Aba de administração: acesso, edição, importação de JSON e restauração. */
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, SAIDA, abrir, checa, falha, ok, criarProjeto, entrarNaAdministracao, lerStore, resumo } from './lib.mjs';

const { navegador, pagina: p } = await abrir();
console.log('\n=== 05. ADMINISTRAÇÃO ===');

await p.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
await p.getByLabel('Senha').fill('senha-errada');
await p.getByRole('button', { name: 'Entrar' }).click();
// A senha é conferida no servidor: a recusa chega depois da ida e volta.
await p.getByText('Senha incorreta.').waitFor({ timeout: 15000 }).catch(() => undefined);
checa('05.1 recusa senha incorreta', (await p.getByText('Senha incorreta.').count()) === 1);

await p.evaluate(() => sessionStorage.setItem('admin-liberado', '1'));
await p.reload({ waitUntil: 'networkidle' });
const liberouSemSenha =
  (await p.getByRole('heading', { name: 'Administração' }).count()) > 0 &&
  (await p.getByLabel('Senha').count()) === 0;
checa('05.2 acesso não é liberado por marcação no sessionStorage', !liberouSemSenha,
  liberouSemSenha ? 'sessionStorage["admin-liberado"]="1" abre a administração sem senha' : '');

// A senha de build continua legível no pacote (finding 4.1 da auditoria), e
// com um valor curto como "ABB" ela nem se distingue do resto do texto. O que
// dá para afirmar — e passou a valer — é que ela não é mais a tranca da fila
// de liberação: essa vive no servidor.
const semSessao = await p.evaluate(async () => {
  const resposta = await fetch('/api/admin/solicitacoes', {
    headers: { Authorization: 'Bearer token-forjado-no-console' },
  });
  return { status: resposta.status, tipo: resposta.headers.get('Content-Type') ?? '' };
});
if (!semSessao.tipo.includes('application/json')) {
  falha('05.3 a fila de liberação recusa sessão forjada',
    'servidor de liberação fora do ar: suba cmd/servidor para verificar este item');
} else {
  checa('05.3 a fila de liberação recusa sessão forjada', semSessao.status === 401,
    `esperado 401 | obtido ${semSessao.status}`);
}

await entrarNaAdministracao(p);
await p.getByRole('button', { name: /Verificação de Montagem/ }).click();
await p.getByRole('button', { name: /S1 —/ }).click();
ok('05.4 abre o editor de formulário');

const descricao = p.locator('textarea').first();
await descricao.fill('');
await p.waitForTimeout(1500);
await descricao.click();
const alvo = 'Texto digitado rapidamente pelo administrador';
await descricao.pressSequentially(alvo, { delay: 12 });
await p.waitForTimeout(3000);
const naTela = await descricao.inputValue();
checa('05.5 digitação rápida não perde caracteres', naTela === alvo,
  `esperado "${alvo}" | obtido "${naTela}"`);

await p.getByRole('button', { name: 'Desativar' }).first().click();
await p.waitForTimeout(1800);
let custom = await lerStore(p, 'formulariosCustom');
checa('05.6 desativa etapa', custom[0]?.definicao?.secoes?.[0]?.etapas?.[0]?.ativa === false);

const ordemAntes = custom[0].definicao.secoes[0].etapas.slice(0, 2).map((e) => e.id);
await p.getByRole('button', { name: /Mover .* para baixo/ }).first().click();
await p.waitForTimeout(1800);
custom = await lerStore(p, 'formulariosCustom');
const ordemDepois = custom[0].definicao.secoes[0].etapas.slice(0, 2).map((e) => e.id);
checa('05.7 reordena etapas', ordemAntes[0] === ordemDepois[1] && ordemAntes[1] === ordemDepois[0],
  `${ordemAntes} → ${ordemDepois}`);

checa('05.8 conteúdo editado muda a revisão registrada no PDF',
  custom[0]?.definicao?.revisao !== 'rev00',
  `a revisão continua "${custom[0]?.definicao?.revisao}" com o conteúdo alterado`);

const baixados = [];
p.on('download', async (d) => { const f = join(SAIDA, `admin-${d.suggestedFilename()}`); await d.saveAs(f); baixados.push(f); });
await p.getByRole('button', { name: 'Exportar JSON' }).click();
await p.waitForTimeout(2500);
checa('05.9 exporta o JSON do formulário', baixados.length === 1);

const original = JSON.parse(readFileSync('public/forms/sen-plus-montagem.json', 'utf8'));
writeFileSync(join(SAIDA, 'outro-id.json'), JSON.stringify({ ...original, id: 'outro-id' }));
await p.locator('input[type=file]').first().setInputFiles(join(SAIDA, 'outro-id.json'));
await p.waitForTimeout(1800);
checa('05.10 recusa JSON de outro formulário', (await p.getByText(/id "outro-id"/).count()) > 0);

writeFileSync(join(SAIDA, 'invalido.json'), JSON.stringify({ id: 'sen-plus-montagem', nome: 123 }));
await p.locator('input[type=file]').first().setInputFiles(join(SAIDA, 'invalido.json'));
await p.waitForTimeout(1800);
checa('05.11 erro de validação legível para JSON inválido',
  /•/.test(await p.getByRole('alert').last().innerText()));

const comLinkExterno = JSON.parse(JSON.stringify(original));
comLinkExterno.secoes[0].etapas[0].midiaApoio = [
  { tipo: 'imagem', src: '//example.com/rastreio.png', legenda: 'externo' },
];
writeFileSync(join(SAIDA, 'externo.json'), JSON.stringify(comLinkExterno));
await p.locator('input[type=file]').first().setInputFiles(join(SAIDA, 'externo.json'));
await p.waitForTimeout(2500);
const aceitos = (await lerStore(p, 'formulariosCustom'))[0]
  ?.definicao?.secoes?.[0]?.etapas?.[0]?.midiaApoio?.map((m) => m.src) ?? [];
checa('05.12 recusa conteúdo de apoio apontando para fora da aplicação',
  !aceitos.some((s) => /example\.com/.test(s)), `aceito: ${JSON.stringify(aceitos)}`);

const externas = [];
p.on('request', (r) => { if (/example\.com/.test(r.url())) externas.push(r.url()); });
await criarProjeto(p, { nome: 'Apoio', tags: ['T1'] });
await p.getByRole('button', { name: /Montagem/ }).first().click();
await p.locator('nav button').filter({ hasText: /^S1\./ }).first().click();
const ajuda = p.getByRole('button', { name: /Ver ajuda da etapa/ });
if (await ajuda.count()) { await ajuda.first().click(); await p.waitForTimeout(3500); }
checa('05.13 a aplicação não busca recursos fora do próprio servidor', externas.length === 0,
  `requisições externas: ${JSON.stringify(externas)}`);

await entrarNaAdministracao(p);
await p.getByRole('button', { name: /Verificação de Montagem/ }).click();
await p.getByRole('button', { name: 'Restaurar original' }).click();
await p.getByRole('button', { name: 'Restaurar', exact: true }).last().click();
await p.waitForTimeout(2500);
checa('05.14 "Restaurar original" descarta a customização',
  (await lerStore(p, 'formulariosCustom')).length === 0);

await navegador.close();
process.exit(resumo('05') ? 1 : 0);
