import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

/**
 * Apoio aos testes de integração: sobe o servidor de verdade num banco e numa
 * pasta temporários, sem e-mail nem webhook, e conversa com ele pela API —
 * como o aplicativo conversa.
 */

export const ADMIN = { email: 'admin@teste.local', senha: 'senha-do-admin', nome: 'Administradora Teste' };

export interface Ambiente {
  url: string;
  pasta: string;
  /** Pasta do banco, das mídias e do backup local. */
  dados: string;
  /** Destino externo de backup (`BACKUP_DESTINOS`). */
  destino: string;
  saida(): string;
  /** Para o servidor (SIGTERM) e mantém as pastas, para conferir o que ficou. */
  parar(): Promise<void>;
  encerrar(): Promise<void>;
}

async function portaLivre(): Promise<number> {
  const servidor = createServer();
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const porta = (servidor.address() as { port: number }).port;
  servidor.close();
  await once(servidor, 'close');
  return porta;
}

async function esperar(condicao: () => boolean, ms: number, descricao: () => string): Promise<void> {
  const limite = Date.now() + ms;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error(`Tempo esgotado esperando o servidor.\n${descricao()}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function subirServidor(extra: Record<string, string> = {}): Promise<Ambiente> {
  const pasta = mkdtempSync(join(tmpdir(), 'verificacao-teste-'));
  const dados = join(pasta, 'dados');
  const destino = join(pasta, 'destino-externo');
  const porta = await portaLivre();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BANCO: join(dados, 'acesso.db'),
    PORTA: String(porta),
    ADMIN_INICIAL: ADMIN.email,
    RESPONSAVEL_PADRAO: ADMIN.email,
    APP_PASTA: join(pasta, 'sem-aplicativo'),
    BACKUP_DESTINOS: destino,
    BACKUP_ATRASO_MS: '30',
    // Nada sai da máquina durante os testes, mesmo com servidor/.env presente.
    SMTP_HOST: '',
    AVISO_WEBHOOK_URL: '',
    CODESPACES: '',
    APP_URL: '',
    ...extra,
  };
  const filho: ChildProcess = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'servidor/src/index.ts'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  filho.stdout!.on('data', (d) => (saida += d));
  filho.stderr!.on('data', (d) => (saida += d));
  await esperar(() => saida.includes('ouvindo em') || filho.exitCode !== null, 30_000, () => saida);
  if (filho.exitCode !== null) throw new Error(`O servidor não subiu:\n${saida}`);

  return {
    url: `http://127.0.0.1:${porta}`,
    pasta,
    dados,
    destino,
    saida: () => saida,
    parar: async () => {
      if (filho.exitCode === null && filho.signalCode === null) {
        filho.kill('SIGTERM');
        await once(filho, 'exit');
      }
    },
    encerrar: async () => {
      if (filho.exitCode === null && filho.signalCode === null) {
        filho.kill('SIGTERM');
        await once(filho, 'exit');
      }
      rmSync(pasta, { recursive: true, force: true });
    },
  };
}

export function sha256(dados: Buffer): string {
  return createHash('sha256').update(dados).digest('hex');
}

export function pdfFalso(texto: string): Buffer {
  return Buffer.from(`%PDF-1.7\n% ${texto}\n%%EOF\n`, 'latin1');
}

export function jpegFalso(texto: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(texto)]);
}

export function novoUid(): string {
  return randomUUID();
}

export interface Resposta<T = any> {
  status: number;
  dados: T;
}

/** Cliente da API com a sessão de uma conta. */
export class Cliente {
  token: string | null = null;
  usuario: { id: number; email: string; nome: string; papel: string } | null = null;

  constructor(readonly url: string) {}

  private cabecalhos(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...extra };
  }

  async pedir<T = any>(metodo: string, caminho: string, corpo?: unknown): Promise<Resposta<T>> {
    const r = await fetch(this.url + caminho, {
      method: metodo,
      headers: this.cabecalhos(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    return { status: r.status, dados: (texto ? JSON.parse(texto) : {}) as T };
  }

  /** Faz o pedido e exige o status esperado, mostrando o erro do servidor se vier outro. */
  async ok<T = any>(metodo: string, caminho: string, corpo?: unknown, esperado = 200): Promise<T> {
    const r = await this.pedir<T>(metodo, caminho, corpo);
    assert.equal(r.status, esperado, `${metodo} ${caminho}: ${JSON.stringify(r.dados)}`);
    return r.dados;
  }

  async enviarArquivo(caminho: string, dados: Buffer, tipo: string): Promise<Resposta> {
    const r = await fetch(this.url + caminho, {
      method: 'PUT',
      headers: this.cabecalhos({ 'Content-Type': tipo }),
      body: dados,
    });
    const texto = await r.text();
    return { status: r.status, dados: texto ? JSON.parse(texto) : {} };
  }

  async baixar(caminho: string): Promise<{ status: number; bytes: Buffer; tipo: string | null }> {
    const r = await fetch(this.url + caminho, { headers: this.cabecalhos() });
    return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') };
  }
}

/** A conta de `ADMIN_INICIAL` nasce administradora; entra pela porta de administrador. */
export async function entrarComoAdmin(url: string): Promise<Cliente> {
  const c = new Cliente(url);
  const cadastro = await c.pedir('POST', '/api/cadastro', { ...ADMIN, perfil: 'admin' });
  if (cadastro.status !== 200 && cadastro.status !== 409) {
    throw new Error(`Cadastro do administrador falhou: ${JSON.stringify(cadastro.dados)}`);
  }
  const sessao = await c.ok('POST', '/api/sessao', { email: ADMIN.email, senha: ADMIN.senha, perfil: 'admin' });
  c.token = sessao.token;
  c.usuario = sessao.usuario;
  return c;
}

/** Cria um montador e libera, sem prazo, o acesso dele a todos os painéis. */
export async function novoMontador(url: string, admin: Cliente, email: string, nome = 'Montador Teste'): Promise<Cliente> {
  const c = new Cliente(url);
  const r = await c.ok('POST', '/api/cadastro', { email, senha: 'senha-do-montador', nome });
  c.token = r.token;
  c.usuario = r.usuario;
  const { paineis } = await admin.ok('GET', '/api/admin/paineis');
  await admin.ok('POST', '/api/admin/acessos', {
    usuarioId: c.usuario!.id,
    painelIds: (paineis as Array<{ id: number }>).map((p) => p.id),
    validade: { tipo: 'indeterminado' },
  });
  return c;
}

export interface PainelDeTeste {
  id: number;
  slug: string;
  formularios: Array<{ id: string; tipo: string; definicao: any }>;
}

export async function painelPorSlug(montador: Cliente, slug: string): Promise<PainelDeTeste> {
  const { paineis } = await montador.ok('GET', '/api/paineis');
  const painel = (paineis as Array<{ id: number; slug: string }>).find((p) => p.slug === slug);
  assert.ok(painel, `painel ${slug} não encontrado`);
  const { formularios } = await montador.ok('GET', `/api/paineis/${painel.id}/formularios`);
  return { id: painel.id, slug: painel.slug, formularios };
}

/** Primeira etapa (id) do checklist. */
export function primeiraEtapa(definicao: any): string {
  return definicao.secoes.flatMap((s: any) => s.etapas)[0].id as string;
}
