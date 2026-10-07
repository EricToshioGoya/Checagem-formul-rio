import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createServerHttps } from 'node:https';
import { limparSessoesVencidas, semearPaineis } from './banco';
import { garantirFormularioPorPainel, semearFormularios } from './formularios';
import { garantirAdminInicial } from './admin';
import { sessaoDoToken, tokenDoCabecalho } from './auth';
import { limparAvisosAntigos, processarFila } from './avisos';
import { backupDoDia } from './backup';
import {
  CONFIAR_PROXY,
  HTTPS_ATIVO,
  HTTPS_CERTIFICADO,
  HTTPS_CHAVE,
  enderecoDoCliente,
} from './configuracao';
import { POLITICA_SEGURANCA, aplicativoDisponivel, servirArquivo } from './estaticos';
import { limparTentativasVencidas } from './limite';
import { faxinarMidias } from './midias';
import { ErroHttp, RespostaArquivo, rotas as rotasBase, type Contexto } from './rotas';
import { rotasGestao } from './rotasGestao';
import { rotasSync } from './rotasSync';
import { rotasApoio, TAMANHO_MAXIMO_APOIO } from './rotasApoio';

/**
 * Servidor de acesso: contas, painéis, aprovação, sincronização das
 * checagens — e, depois de `npm run build`, o próprio aplicativo.
 *
 * Deliberadamente sem framework: `node:http` e `node:sqlite` dão conta, e o
 * projeto inteiro carrega oito dependências.
 */

const PORTA = Number(process.env.PORTA ?? 3001);

const rotas = { ...rotasBase, ...rotasGestao, ...rotasSync, ...rotasApoio };

/**
 * 1 MB para JSON. O de 64 KB não comportava um checklist grande: a partir de
 * umas cem etapas, gravar falhava — e a tela dizia "sem conexão".
 */
const LIMITE_JSON = 1024 * 1024;
/** Rotas com limite próprio: o projeto sincronizado e o arquivo de uma foto. */
const LIMITES: Record<string, number> = {
  'PUT /api/sync/projetos/:uid': 8 * 1024 * 1024,
  'PUT /api/sync/midias/:uid': 26 * 1024 * 1024,
  'PUT /api/admin/apoio/:uid': TAMANHO_MAXIMO_APOIO + 1024,
};
/** Rotas que recebem arquivo, e não JSON. */
const ROTAS_ARQUIVO = new Set(['PUT /api/sync/midias/:uid', 'PUT /api/admin/apoio/:uid']);

/**
 * `decodeURIComponent` lança erro com "%" malformado. Fora do `try` do
 * servidor, um único endereço como `/api/paineis/%E0%A4%A` derrubava o
 * processo inteiro.
 */
function decodificar(parte: string): string {
  try {
    return decodeURIComponent(parte);
  } catch {
    throw new ErroHttp(400, 'Endereço inválido.');
  }
}

/** Casa "POST /api/paineis/7/solicitacoes" com "POST /api/paineis/:id/solicitacoes". */
function casar(metodo: string, caminho: string) {
  const partesUrl = caminho.split('/').filter(Boolean);

  for (const chave of Object.keys(rotas)) {
    const [metodoRota, padrao] = chave.split(' ');
    if (metodoRota !== metodo) continue;

    const partesPadrao = padrao.split('/').filter(Boolean);
    if (partesPadrao.length !== partesUrl.length) continue;

    const params: Record<string, string> = {};
    let bate = true;
    for (let i = 0; i < partesPadrao.length; i++) {
      const p = partesPadrao[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodificar(partesUrl[i]);
      else if (p !== partesUrl[i]) {
        bate = false;
        break;
      }
    }
    if (bate) return { chave, manipulador: rotas[chave], params };
  }
  return null;
}

function lerBytes(req: IncomingMessage, limite: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    let excedeu = false;
    req.on('data', (parte: Buffer) => {
      if (excedeu) return;
      total += parte.length;
      if (total > limite) {
        // O resto do corpo é lido e descartado, sem guardar. Derrubar a conexão
        // aqui impedia a resposta 413 de chegar, e a tela dizia "sem conexão".
        excedeu = true;
        partes.length = 0;
        reject(new ErroHttp(413, 'Conteúdo grande demais para enviar de uma vez.'));
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      if (!excedeu) resolve(Buffer.concat(partes));
    });
    req.on('error', reject);
  });
}

async function lerJson(req: IncomingMessage, limite: number): Promise<unknown> {
  const bruto = (await lerBytes(req, limite)).toString('utf8').trim();
  if (!bruto) return {};
  try {
    return JSON.parse(bruto);
  } catch {
    throw new ErroHttp(400, 'Corpo não é JSON válido.');
  }
}

/** Cabeçalhos de segurança de toda resposta; HSTS só quando a conexão é HTTPS. */
function cabecalhosSeguranca(req: IncomingMessage): Record<string, string> {
  const cabecalhos: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  };
  const viaProxyHttps = CONFIAR_PROXY > 0 && req.headers['x-forwarded-proto'] === 'https';
  if (HTTPS_ATIVO || viaProxyHttps) {
    cabecalhos['Strict-Transport-Security'] = 'max-age=15552000';
  }
  return cabecalhos;
}

function responder(req: IncomingMessage, res: ServerResponse, status: number, dados: unknown): void {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, {
    ...cabecalhosSeguranca(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corpo),
    'Cache-Control': 'no-store',
  });
  res.end(corpo);
}

function responderArquivo(req: IncomingMessage, res: ServerResponse, arquivo: RespostaArquivo): void {
  res.writeHead(200, {
    ...cabecalhosSeguranca(req),
    'Content-Type': arquivo.mime,
    'Content-Length': statSync(arquivo.caminho).size,
    // A mídia nunca muda depois de gravada: o `uid` é o nome dela.
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  createReadStream(arquivo.caminho).pipe(res);
}

// Tudo dentro do `try`, inclusive ler o endereço e escolher a rota: qualquer
// erro que escapasse daqui virava rejeição não tratada, e o Node encerra o
// processo — uma requisição malformada derrubava o servidor para todos.
async function atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const metodo = req.method ?? 'GET';
    const endereco = new URL(req.url ?? '/', 'http://local');
    const caminho = endereco.pathname;

    // O Vite faz proxy de /api em desenvolvimento, e em produção a aplicação e
    // a API ficam na mesma origem — então não há CORS a liberar aqui. Um
    // `Access-Control-Allow-Origin: *` numa API com sessão seria um furo.
    if (metodo === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    if (!caminho.startsWith('/api/')) {
      // O aplicativo compilado, com a política de segurança que só ele precisa.
      const cabecalhos = {
        ...cabecalhosSeguranca(req),
        'Content-Security-Policy': POLITICA_SEGURANCA,
        'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      };
      if ((metodo === 'GET' || metodo === 'HEAD') && servirArquivo(decodificar(caminho), res, cabecalhos)) {
        return;
      }
      responder(req, res, 404, { erro: 'Página não encontrada.' });
      return;
    }

    const rota = casar(metodo, caminho);
    if (!rota) {
      responder(req, res, 404, { erro: 'Rota não encontrada.' });
      return;
    }

    const token = tokenDoCabecalho(req.headers.authorization);
    const sessao = sessaoDoToken(token);
    const limite = LIMITES[rota.chave] ?? LIMITE_JSON;
    const recebeArquivo = ROTAS_ARQUIVO.has(rota.chave);
    const temCorpo = metodo !== 'GET' && metodo !== 'DELETE';
    const ctx: Contexto = {
      token,
      usuario: sessao?.usuario ?? null,
      perfil: sessao?.perfil ?? null,
      ip: enderecoDoCliente(req.headers['x-forwarded-for'], req.socket.remoteAddress ?? ''),
      corpo: temCorpo && !recebeArquivo ? await lerJson(req, limite) : {},
      corpoBruto: temCorpo && recebeArquivo ? await lerBytes(req, limite) : undefined,
      tipoConteudo: req.headers['content-type'],
      params: rota.params,
      consulta: endereco.searchParams,
    };
    const resultado = await rota.manipulador(ctx);
    if (resultado instanceof RespostaArquivo) responderArquivo(req, res, resultado);
    else responder(req, res, 200, resultado);
  } catch (erro) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (erro instanceof ErroHttp) {
      // `codigo` deixa a tela reagir ao motivo (ex.: conta sem papel de
      // administrador) sem depender do texto da mensagem.
      responder(req, res, erro.status, { erro: erro.message, codigo: erro.codigo });
      return;
    }
    if (erro instanceof TypeError && erro.message.includes('Invalid URL')) {
      responder(req, res, 400, { erro: 'Endereço inválido.' });
      return;
    }
    console.error('Falha ao tratar a requisição', erro);
    responder(req, res, 500, { erro: 'Falha interna do servidor.' });
  }
}

const servidor = HTTPS_ATIVO
  ? createServerHttps(
      { cert: readFileSync(HTTPS_CERTIFICADO), key: readFileSync(HTTPS_CHAVE) },
      (req, res) => void atender(req, res),
    )
  : createServer((req, res) => void atender(req, res));

semearPaineis();
semearFormularios();
garantirFormularioPorPainel();
garantirAdminInicial();
limparSessoesVencidas();

// Tarefas periódicas. `unref` deixa o processo encerrar sem esperar por elas.
setInterval(() => void processarFila(), 30_000).unref();
setInterval(() => {
  limparSessoesVencidas();
  limparTentativasVencidas();
  limparAvisosAntigos();
  faxinarMidias();
  backupDoDia();
}, 60 * 60 * 1000).unref();
// O backup do dia e a faxina rodam logo depois da subida, sem atrasá-la.
setTimeout(() => {
  backupDoDia();
  faxinarMidias();
  void processarFila();
}, 5_000).unref();

servidor.listen(PORTA, () => {
  const protocolo = HTTPS_ATIVO ? 'https' : 'http';
  console.log(`Servidor de acesso ouvindo em ${protocolo}://localhost:${PORTA}`);
  if (aplicativoDisponivel()) {
    console.log(`Aplicativo compilado disponível no mesmo endereço (${protocolo}://localhost:${PORTA}).`);
  }
  if (CONFIAR_PROXY) console.log(`Confiando em ${CONFIAR_PROXY} proxy(s) para o endereço do cliente.`);
});
