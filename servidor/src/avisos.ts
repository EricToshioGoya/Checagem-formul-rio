import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { hostname } from 'node:os';
import tls from 'node:tls';
import { banco } from './banco';

/**
 * Avisos de pedidos novos — de acesso a painel e para ser administrador —
 * por e-mail (SMTP) e por webhook (Teams, Slack ou qualquer serviço que
 * receba JSON). Os dois canais são opcionais e se configuram por variável de
 * ambiente; sem nenhum configurado, nada é enviado e a tela Sistema avisa.
 *
 * Todo aviso entra numa fila no banco antes de sair. Se o servidor de e-mail
 * estiver fora do ar, o aviso é tentado de novo depois — não se perde.
 *
 * O cliente SMTP é próprio, de propósito: o projeto evita dependências, e o
 * que se precisa aqui é pouco — conexão com TLS, autenticação e uma mensagem
 * de texto.
 */

interface ConfigSmtp {
  host: string;
  porta: number;
  /** TLS desde a conexão (porta 465). Senão, STARTTLS. */
  seguro: boolean;
  usuario?: string;
  senha?: string;
  remetente: string;
  /** Só para servidor de teste local: permite enviar sem TLS. */
  semTls: boolean;
}

type FormatoWebhook = 'teams' | 'slack' | 'json';

function configSmtp(): ConfigSmtp | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const porta = Number(process.env.SMTP_PORTA ?? 587);
  return {
    host,
    porta,
    seguro: process.env.SMTP_SEGURO === '1' || porta === 465,
    usuario: process.env.SMTP_USUARIO || undefined,
    senha: process.env.SMTP_SENHA || undefined,
    remetente: process.env.SMTP_REMETENTE || process.env.SMTP_USUARIO || `verificacao@${host}`,
    semTls: process.env.SMTP_SEM_TLS === '1',
  };
}

function configWebhook(): { url: string; formato: FormatoWebhook } | null {
  const url = process.env.AVISO_WEBHOOK_URL?.trim();
  if (!url) return null;
  const formato = (process.env.AVISO_WEBHOOK_FORMATO ?? 'teams') as FormatoWebhook;
  return { url, formato: ['teams', 'slack', 'json'].includes(formato) ? formato : 'teams' };
}

/** Endereço público do aplicativo, para os avisos levarem direto à tela certa. */
function urlApp(): string {
  return (process.env.APP_URL ?? '').trim().replace(/\/+$/, '');
}

// ------------------------------------------------------------------ fila

/** Esperas entre as tentativas: 1 min, 5 min, 15 min, 1 h, 6 h. */
const ESPERAS_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];
const MAX_TENTATIVAS = ESPERAS_MS.length + 1;

interface Aviso {
  id: number;
  canal: 'email' | 'webhook';
  destino: string;
  assunto: string;
  texto: string;
  tentativas: number;
}

/**
 * Enfileira um aviso para os e-mails indicados e para o webhook. `rota` é o
 * trecho depois do endereço do aplicativo, como `#/aprovacoes`.
 */
export function avisar(aviso: { assunto: string; texto: string; emails: string[]; rota?: string }): void {
  const smtp = configSmtp();
  const webhook = configWebhook();
  if (!smtp && !webhook) return;

  const base = urlApp();
  const corpo = base && aviso.rota ? `${aviso.texto}\n\nAbrir: ${base}/${aviso.rota}` : aviso.texto;
  const agora = Date.now();
  const inserir = banco.prepare(
    'INSERT INTO avisos (canal, destino, assunto, texto, criadoEm, proximaEm) VALUES (?, ?, ?, ?, ?, ?)',
  );
  if (smtp) {
    for (const email of new Set(aviso.emails.map((e) => e.toLowerCase()))) {
      inserir.run('email', email, aviso.assunto, corpo, agora, agora);
    }
  }
  if (webhook) inserir.run('webhook', 'webhook', aviso.assunto, corpo, agora, agora);
  agendarEnvio();
}

let enviando = false;
let temporizador: NodeJS.Timeout | undefined;

/** Pede uma passada na fila logo depois da resposta atual sair. */
export function agendarEnvio(atrasoMs = 50): void {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => void processarFila(), atrasoMs);
  temporizador.unref();
}

/** Envia o que está vencido na fila. Chamado após cada aviso e a cada 30 s. */
export async function processarFila(): Promise<void> {
  if (enviando) return;
  enviando = true;
  try {
    const agora = Date.now();
    const pendentes = banco
      .prepare(
        `SELECT id, canal, destino, assunto, texto, tentativas FROM avisos
          WHERE enviadoEm IS NULL AND tentativas < ? AND proximaEm <= ?
          ORDER BY id LIMIT 20`,
      )
      .all(MAX_TENTATIVAS, agora) as unknown as Aviso[];

    for (const aviso of pendentes) {
      try {
        if (aviso.canal === 'email') {
          const smtp = configSmtp();
          if (!smtp) throw new Error('E-mail deixou de estar configurado.');
          await enviarEmail(smtp, aviso.destino, aviso.assunto, aviso.texto);
        } else {
          const webhook = configWebhook();
          if (!webhook) throw new Error('Webhook deixou de estar configurado.');
          await enviarWebhook(webhook, aviso.assunto, aviso.texto);
        }
        banco
          .prepare('UPDATE avisos SET enviadoEm = ?, tentativas = tentativas + 1, erro = NULL WHERE id = ?')
          .run(Date.now(), aviso.id);
      } catch (erro) {
        const tentativas = aviso.tentativas + 1;
        const espera = ESPERAS_MS[Math.min(tentativas - 1, ESPERAS_MS.length - 1)];
        banco
          .prepare('UPDATE avisos SET tentativas = ?, erro = ?, proximaEm = ? WHERE id = ?')
          .run(
            tentativas,
            (erro instanceof Error ? erro.message : String(erro)).slice(0, 300),
            Date.now() + espera,
            aviso.id,
          );
      }
    }
  } finally {
    enviando = false;
  }
}

/** Avisos enviados há mais de 90 dias saem da fila. */
export function limparAvisosAntigos(): void {
  banco.prepare('DELETE FROM avisos WHERE criadoEm < ?').run(Date.now() - 90 * 86_400_000);
}

/** O que a tela Sistema mostra: canais configurados e os últimos avisos. */
export function situacaoAvisos() {
  const smtp = configSmtp();
  const webhook = configWebhook();
  const contar = (sql: string) => Number((banco.prepare(sql).get() as { n: number }).n);
  const recentes = banco
    .prepare(
      `SELECT id, canal, destino, assunto, criadoEm, enviadoEm, tentativas, erro
         FROM avisos ORDER BY id DESC LIMIT 15`,
    )
    .all() as Array<Record<string, unknown>>;
  return {
    email: smtp ? { configurado: true, servidor: `${smtp.host}:${smtp.porta}` } : { configurado: false },
    webhook: webhook
      ? { configurado: true, destino: new URL(webhook.url).hostname, formato: webhook.formato }
      : { configurado: false },
    linkApp: urlApp() || null,
    pendentes: contar('SELECT COUNT(*) AS n FROM avisos WHERE enviadoEm IS NULL AND tentativas < 6'),
    falharam: contar('SELECT COUNT(*) AS n FROM avisos WHERE enviadoEm IS NULL AND tentativas >= 6'),
    recentes: recentes.map((r) => ({
      id: Number(r.id),
      canal: r.canal as 'email' | 'webhook',
      destino: String(r.destino),
      assunto: String(r.assunto),
      criadoEm: Number(r.criadoEm),
      enviadoEm: r.enviadoEm === null ? null : Number(r.enviadoEm),
      tentativas: Number(r.tentativas),
      erro: (r.erro as string | null) ?? null,
    })),
  };
}

// --------------------------------------------------------------- webhook

async function enviarWebhook(
  cfg: { url: string; formato: FormatoWebhook },
  assunto: string,
  texto: string,
): Promise<void> {
  const corpo =
    cfg.formato === 'slack'
      ? { text: `*${assunto}*\n${texto}` }
      : cfg.formato === 'json'
        ? { assunto, texto }
        : {
            // Fluxo "Postar em um canal quando uma solicitação de webhook for
            // recebida" dos Workflows do Teams: cartão adaptativo.
            type: 'message',
            attachments: [
              {
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: {
                  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                  type: 'AdaptiveCard',
                  version: '1.4',
                  body: [
                    { type: 'TextBlock', text: assunto, weight: 'Bolder', size: 'Medium', wrap: true },
                    { type: 'TextBlock', text: texto, wrap: true },
                  ],
                },
              },
            ],
          };
  const resposta = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resposta.ok) throw new Error(`O webhook respondeu ${resposta.status}.`);
}

// ------------------------------------------------------------------ smtp

/** Lê as respostas do servidor SMTP, que podem vir em várias linhas ("250-…", "250 …"). */
function criarLeitor(inicial: net.Socket) {
  let socket = inicial;
  let acumulado = '';
  let linhas: string[] = [];
  const prontas: Array<{ codigo: number; texto: string }> = [];
  let aguardando: { resolver: (r: { codigo: number; texto: string }) => void; rejeitar: (e: Error) => void } | null =
    null;
  let falha: Error | null = null;

  const aoReceber = (dados: Buffer) => {
    acumulado += dados.toString('utf8');
    let fim: number;
    while ((fim = acumulado.indexOf('\r\n')) >= 0) {
      const linha = acumulado.slice(0, fim);
      acumulado = acumulado.slice(fim + 2);
      linhas.push(linha);
      if (/^\d{3} /.test(linha) || /^\d{3}$/.test(linha)) {
        const resposta = { codigo: Number(linha.slice(0, 3)), texto: linhas.join('\n') };
        linhas = [];
        if (aguardando) {
          aguardando.resolver(resposta);
          aguardando = null;
        } else prontas.push(resposta);
      }
    }
  };
  const aoFalhar = (erro: Error) => {
    falha = erro;
    aguardando?.rejeitar(erro);
    aguardando = null;
  };
  const ligar = (s: net.Socket) => {
    socket = s;
    s.on('data', aoReceber);
    s.on('error', aoFalhar);
    s.on('timeout', () => aoFalhar(new Error('O servidor de e-mail não respondeu a tempo.')));
  };
  ligar(inicial);

  return {
    proxima(): Promise<{ codigo: number; texto: string }> {
      if (prontas.length) return Promise.resolve(prontas.shift()!);
      if (falha) return Promise.reject(falha);
      return new Promise((resolver, rejeitar) => {
        aguardando = { resolver, rejeitar };
      });
    },
    /** Para trocar a conexão pela versão com TLS, depois do STARTTLS. */
    desligar(): void {
      socket.removeListener('data', aoReceber);
      socket.removeListener('error', aoFalhar);
    },
    ligar,
  };
}

/** Assunto e nome com acento vão codificados, como pede o padrão do e-mail. */
function cabecalhoUtf8(texto: string): string {
  const limpo = texto.replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7e]*$/.test(limpo) ? limpo : `=?UTF-8?B?${Buffer.from(limpo, 'utf8').toString('base64')}?=`;
}

function montarMensagem(remetente: string, para: string, assunto: string, texto: string): string {
  const corpo = Buffer.from(texto.replace(/\r?\n/g, '\r\n'), 'utf8')
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${cabecalhoUtf8('Verificação de Montagem')} <${remetente}>`,
    `To: <${para}>`,
    `Subject: ${cabecalhoUtf8(assunto)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${remetente.split('@')[1] ?? 'localhost'}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    corpo,
  ].join('\r\n');
}

export async function enviarEmail(
  cfg: ConfigSmtp,
  para: string,
  assunto: string,
  texto: string,
): Promise<void> {
  let socket: net.Socket = cfg.seguro
    ? tls.connect({ host: cfg.host, port: cfg.porta, servername: cfg.host })
    : net.connect({ host: cfg.host, port: cfg.porta });
  socket.setTimeout(20_000);
  const leitor = criarLeitor(socket);

  const esperar = async (aceitos: number[]) => {
    const r = await leitor.proxima();
    if (!aceitos.includes(r.codigo)) throw new Error(`Servidor de e-mail: ${r.texto.slice(0, 200)}`);
    return r;
  };
  const comando = async (linha: string, aceitos: number[]) => {
    socket.write(`${linha}\r\n`);
    return esperar(aceitos);
  };
  const ehlo = async () => (await comando(`EHLO ${hostname() || 'localhost'}`, [250])).texto;

  try {
    await esperar([220]);
    let capacidades = await ehlo();
    if (!cfg.seguro) {
      if (/STARTTLS/i.test(capacidades)) {
        await comando('STARTTLS', [220]);
        leitor.desligar();
        socket = await new Promise<net.Socket>((resolver, rejeitar) => {
          const seguro = tls.connect({ socket, servername: cfg.host }, () => resolver(seguro));
          seguro.once('error', rejeitar);
        });
        socket.setTimeout(20_000);
        leitor.ligar(socket);
        capacidades = await ehlo();
      } else if (!cfg.semTls) {
        throw new Error('O servidor de e-mail não oferece TLS (STARTTLS); a senha iria aberta.');
      }
    }
    if (cfg.usuario) {
      const b64 = (t: string) => Buffer.from(t, 'utf8').toString('base64');
      // PLAIN quando o servidor oferece; o Office 365 costuma oferecer só LOGIN.
      if (/AUTH[^\n]*\bPLAIN\b/i.test(capacidades)) {
        await comando(`AUTH PLAIN ${b64(`\0${cfg.usuario}\0${cfg.senha ?? ''}`)}`, [235]);
      } else {
        await comando('AUTH LOGIN', [334]);
        await comando(b64(cfg.usuario), [334]);
        await comando(b64(cfg.senha ?? ''), [235]);
      }
    }
    await comando(`MAIL FROM:<${cfg.remetente}>`, [250]);
    await comando(`RCPT TO:<${para}>`, [250, 251]);
    await comando('DATA', [354]);
    socket.write(`${montarMensagem(cfg.remetente, para, assunto, texto)}\r\n.\r\n`);
    await esperar([250]);
    socket.write('QUIT\r\n');
  } finally {
    socket.destroy();
  }
}
