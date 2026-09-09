/**
 * Teste de fumaça do controle de acesso, no navegador real.
 *
 * Percorre o fluxo inteiro como ele acontece em campo: o montador pede
 * acesso, o responsável recebe o e-mail e clica em aprovar, o aplicativo
 * libera sozinho, e a autorização sobrevive a recarregar a página e a
 * ficar sem rede.
 *
 * O script é auto-contido: gera a chave de sessão, compila e sobe a API,
 * gera o build do aplicativo apontado para ela e serve o resultado.
 *
 * Uso:
 *   npm i -D playwright && npx playwright install chromium
 *   npm run fumaca-autorizacao
 *
 * Exige Go instalado (o mesmo já necessário para o servidor portátil).
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORTA_API = Number(process.env.PORTA_API ?? 8092);
const PORTA_APP = Number(process.env.PORTA_APP ?? 8093);
const URL_API = `http://localhost:${PORTA_API}`;
const URL_APP = `http://localhost:${PORTA_APP}`;

const trabalho = mkdtempSync(join(tmpdir(), 'fumaca-autorizacao-'));
const arquivoLog = join(trabalho, 'api.log');
const processos = [];
let navegador;
let pagina;

const passo = async (nome, fn) => {
  process.stdout.write(`• ${nome}… `);
  const resultado = await fn();
  console.log('ok');
  return resultado;
};

/** Espera uma condição virar verdadeira, com limite de tempo. */
async function aguardar(descricao, condicao, limiteMs = 30_000) {
  const fim = Date.now() + limiteMs;
  for (;;) {
    const valor = await condicao();
    if (valor) return valor;
    if (Date.now() > fim) throw new Error(`tempo esgotado esperando: ${descricao}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

function encerrar() {
  for (const p of processos) p.kill('SIGTERM');
  rmSync(trabalho, { recursive: true, force: true });
}

try {
  const jwk = await passo('gerar a chave de sessão', () => {
    writeFileSync(
      join(trabalho, 'paineis.json'),
      JSON.stringify([
        {
          id: 'system-pro-e-power',
          nome: 'System Pro E Power',
          emailResponsavel: 'responsavel@empresa.com.br',
        },
      ]),
    );
    execFileSync('go', ['build', '-o', join(trabalho, 'api'), '.'], { cwd: 'cmd/api' });

    const saida = execFileSync(join(trabalho, 'api'), ['-gerar-chave'], {
      env: { ...process.env, CHAVE_PRIVADA: join(trabalho, 'chave.pem') },
      encoding: 'utf8',
    });
    const achado = saida.match(/VITE_AUTH_CHAVE_PUBLICA='(\{.*\})'/);
    if (!achado) throw new Error(`não foi possível ler a chave pública:\n${saida}`);
    return achado[1];
  });

  await passo('subir a API de autorização', async () => {
    writeFileSync(arquivoLog, '');
    const api = spawn(join(trabalho, 'api'), [], {
      env: {
        ...process.env,
        PORTA: String(PORTA_API),
        URL_BASE: URL_API,
        ORIGENS: URL_APP,
        DADOS: join(trabalho, 'dados.json'),
        CHAVE_PRIVADA: join(trabalho, 'chave.pem'),
        PAINEIS: join(trabalho, 'paineis.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    processos.push(api);
    api.stdout.on('data', (d) => writeFileSync(arquivoLog, d, { flag: 'a' }));
    api.stderr.on('data', (d) => writeFileSync(arquivoLog, d, { flag: 'a' }));

    await aguardar('a API responder', async () => {
      try {
        return (await fetch(`${URL_API}/api/saude`)).ok;
      } catch {
        return false;
      }
    });
  });

  await passo('gerar o build apontado para a API', () => {
    execFileSync('npm', ['run', 'build'], {
      env: { ...process.env, VITE_API_URL: URL_API, VITE_AUTH_CHAVE_PUBLICA: jwk },
      stdio: 'pipe',
    });
  });

  await passo('servir o aplicativo', async () => {
    const preview = spawn('npx', ['vite', 'preview', '--port', String(PORTA_APP)], {
      stdio: 'ignore',
    });
    processos.push(preview);
    await aguardar('o aplicativo responder', async () => {
      try {
        return (await fetch(URL_APP)).ok;
      } catch {
        return false;
      }
    });
  });

  navegador = await chromium.launch(
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
  );
  const contexto = await navegador.newContext({ locale: 'pt-BR' });
  pagina = await contexto.newPage();

  await passo('o aplicativo abre bloqueado', async () => {
    await pagina.goto(URL_APP, { waitUntil: 'networkidle' });
    await pagina.getByRole('heading', { name: 'Acesso ao sistema' }).waitFor();

    // O que o montador NÃO pode ver antes de ser autorizado.
    if (await pagina.getByRole('heading', { name: 'Meus projetos' }).isVisible()) {
      throw new Error('a lista de projetos apareceu sem autorização');
    }
  });

  await passo('enviar a solicitação', async () => {
    await pagina.getByLabel('Seu e-mail').fill('montador@empresa.com.br');
    await pagina.getByLabel('Painel').selectOption('system-pro-e-power');
    await pagina
      .getByLabel('Observação para o responsável')
      .fill('teste de fumaça do controle de acesso');
    await pagina.getByRole('button', { name: 'Enviar solicitação' }).click();
    await pagina.getByRole('heading', { name: 'Aguardando aprovação' }).waitFor();
  });

  const link = await passo('o responsável recebe o link por e-mail', async () =>
    aguardar('o e-mail sair', () => {
      const achado = readFileSync(arquivoLog, 'utf8').match(
        /(http:\/\/\S+\/api\/decisao\/aprovar\?\S+)/,
      );
      return achado?.[1];
    }),
  );

  await passo('o responsável aprova pelo link', async () => {
    const outraAba = await contexto.newPage();
    await outraAba.goto(link, { waitUntil: 'networkidle' });
    await outraAba.getByRole('heading', { name: 'Acesso aprovado' }).waitFor();
    await outraAba.close();
  });

  await passo('o aplicativo libera sozinho', async () => {
    // Sem recarregar: a tela de espera consulta o servidor e entra sozinha.
    await pagina.getByRole('heading', { name: 'Meus projetos' }).waitFor({ timeout: 30_000 });
    await pagina.getByText('montador@empresa.com.br').first().waitFor();
  });

  await passo('a autorização sobrevive a recarregar', async () => {
    await pagina.reload({ waitUntil: 'domcontentloaded' });
    await pagina.getByRole('heading', { name: 'Meus projetos' }).waitFor({ timeout: 30_000 });
  });

  await passo('a autorização vale offline', async () => {
    // A condição real de campo: sem rede, quem já foi aprovado continua
    // trabalhando.
    await contexto.setOffline(true);
    await pagina.reload({ waitUntil: 'domcontentloaded' });
    await pagina.getByRole('heading', { name: 'Meus projetos' }).waitFor({ timeout: 30_000 });
    await contexto.setOffline(false);
  });

  await passo('o link de aprovação não serve duas vezes', async () => {
    const outraAba = await contexto.newPage();
    await outraAba.goto(link, { waitUntil: 'networkidle' });
    await outraAba.getByRole('heading', { name: 'Não foi possível concluir' }).waitFor();
    await outraAba.close();
  });

  await passo('encerrar o acesso volta a bloquear', async () => {
    await pagina.getByRole('button', { name: 'Encerrar acesso' }).click();
    await pagina.getByRole('heading', { name: 'Acesso ao sistema' }).waitFor();
  });

  console.log('\nControle de acesso: fluxo completo aprovado.');
} catch (erro) {
  console.error('\nFALHOU:', erro.message);
  // O que estava na tela quando falhou: sem isso, um passo vermelho não diz
  // quase nada sobre a causa.
  try {
    if (pagina) {
      console.error('\n--- título visível na tela ---');
      console.error(await pagina.locator('h1').first().textContent());
      console.error('\n--- texto da tela ---');
      console.error((await pagina.locator('body').innerText()).slice(0, 1200));
    }
  } catch {
    // A página pode ter fechado junto com a falha.
  }
  try {
    console.error('\n--- log da API ---\n' + readFileSync(arquivoLog, 'utf8').slice(-2000));
  } catch {
    // Sem log: a falha aconteceu antes de a API subir.
  }
  process.exitCode = 1;
} finally {
  await navegador?.close();
  encerrar();
}
