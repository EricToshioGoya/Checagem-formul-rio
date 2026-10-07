/** Importação de um backup adulterado: validação, isolamento e recuperação. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { BASE, SAIDA, abrir, checa, lerStore, resumo } from './lib.mjs';

const pasta = join(SAIDA, 'pacote-adulterado');
mkdirSync(join(pasta, 'fotos'), { recursive: true });
writeFileSync(join(pasta, 'projeto.json'), JSON.stringify({
  versao: 1,
  exportadoEm: 'qualquer coisa',
  projeto: {
    id: 999,                                   // chave primária escolhida pelo arquivo
    empresa: { nao: 'e uma string' },           // tipo errado
    nomeProjeto: 'X'.repeat(5000),
    operador: 'A',
    criadoEm: 'ontem',
    atualizadoEm: null,
    campoDesconhecido: { qualquer: 'coisa' },
  },
  tags: [{ chave: 1, nome: 'TAG-A', ordem: -5 }],
  preenchimentos: [{
    chave: 1, tagChave: 1, formId: 'formulario-inexistente', formRevisao: 99,
    cabecalho: 'nem e um objeto',
    respostas: { 'S1.1': { valor: { objeto: 'onde deveria ser booleano' } } },
    atualizadoEm: 'agora',
  }],
  midias: [],
}, null, 2));
const zip = join(SAIDA, 'adulterado.zip');
execSync(`cd "${pasta}" && rm -f "${zip}" && zip -q -r "${zip}" projeto.json fotos`);
writeFileSync(join(SAIDA, 'nao-e-zip.zip'), Buffer.from('isto nao e um arquivo zip'));

const { navegador, pagina: p } = await abrir();
console.log('\n=== 04. IMPORTAÇÃO DE BACKUP ADULTERADO ===');

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.locator('input[type=file]').first().setInputFiles(zip);
await p.waitForTimeout(3500);

const projetos = await lerStore(p, 'projetos');
checa('04.1 recusa pacote com campos fora do formato',
  projetos.length === 0 && (await p.getByRole('alert').count()) > 0,
  `${projetos.length} projeto(s) gravado(s) a partir do arquivo`);
checa('04.2 ignora o "id" de projeto vindo do arquivo', !projetos.some((x) => x.id === 999),
  projetos.some((x) => x.id === 999) ? 'projeto gravado com o id 999 escolhido pelo arquivo' : '');

const conteudo = await p.locator('#root').innerHTML();
checa('04.3 a tela continua desenhada depois da importação', conteudo.length > 200,
  conteudo.length <= 200 ? 'a aplicação virou uma tela em branco' : '');

await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const depoisDoReload = await p.locator('#root').innerHTML();
checa('04.4 a aplicação volta a abrir depois de recarregar', depoisDoReload.length > 200,
  depoisDoReload.length <= 200
    ? 'tela em branco permanente: o registro inválido fica no IndexedDB e derruba a tela inicial a cada abertura'
    : '');

await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
if (await p.locator('input[type=file]').first().count()) {
  await p.locator('input[type=file]').first().setInputFiles(join(SAIDA, 'nao-e-zip.zip'));
  await p.waitForTimeout(2500);
  checa('04.5 mensagem clara para arquivo que não é um backup',
    (await p.getByRole('alert').count()) > 0);
}

await navegador.close();
process.exit(resumo('04') ? 1 : 0);
