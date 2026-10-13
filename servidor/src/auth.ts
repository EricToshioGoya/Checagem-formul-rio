import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { banco, type Usuario } from './banco';

/** Como a sessão foi aberta: pelo login de montador ou pelo de administrador. */
export type Perfil = 'montador' | 'admin';

/**
 * 30 dias para o montador: a montagem de um painel leva semanas e o galpão tem
 * sinal ruim. 12 horas para o administrador: é trabalho de mesa, e uma sessão
 * esquecida aberta não deve valer por um mês.
 */
const VALIDADE_MS: Record<Perfil, number> = {
  montador: 30 * 24 * 60 * 60 * 1000,
  admin: 12 * 60 * 60 * 1000,
};

export function criarHash(senha: string): string {
  const sal = randomBytes(16);
  const derivada = scryptSync(senha, sal, 64);
  return `${sal.toString('hex')}:${derivada.toString('hex')}`;
}

export function conferirSenha(senha: string, guardado: string): boolean {
  const [salHex, hashHex] = guardado.split(':');
  if (!salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const derivada = scryptSync(senha, Buffer.from(salHex, 'hex'), esperado.length);
  // Comparação de tempo constante: um `===` vaza o tamanho do prefixo correto.
  return esperado.length === derivada.length && timingSafeEqual(esperado, derivada);
}

/**
 * Hash de uma senha que ninguém tem. Quando o e-mail não existe, a senha é
 * conferida contra ele mesmo assim: sem isso, a resposta para e-mail
 * inexistente saía em 4 ms e a de senha errada em 80 ms, e a demora contava
 * quem tem conta, apesar da mensagem de erro igual.
 */
const HASH_FICTICIO = criarHash(randomUUID());

/** Confere a senha de uma conta que pode não existir, sempre no mesmo tempo. */
export function conferirSenhaDaConta(senha: string, guardado: string | undefined): boolean {
  const confere = conferirSenha(senha, guardado ?? HASH_FICTICIO);
  return guardado !== undefined && confere;
}

export function abrirSessao(
  usuarioId: number,
  perfil: Perfil = 'montador',
): { token: string; expiraEm: number } {
  const token = randomUUID();
  const agora = Date.now();
  const expiraEm = agora + VALIDADE_MS[perfil];
  banco
    .prepare(
      'INSERT INTO sessoes (token, usuarioId, criadoEm, expiraEm, perfil) VALUES (?, ?, ?, ?, ?)',
    )
    .run(token, usuarioId, agora, expiraEm, perfil);
  return { token, expiraEm };
}

export function fecharSessao(token: string): void {
  banco.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
}

/** Derruba as sessões de administrador de uma conta — usado ao tirar o papel. */
export function fecharSessoesAdmin(usuarioId: number): void {
  banco.prepare("DELETE FROM sessoes WHERE usuarioId = ? AND perfil = 'admin'").run(usuarioId);
}

/** Dono e perfil da sessão, ou `null` se o token não existe ou venceu. */
export function sessaoDoToken(
  token: string | null,
): { usuario: Usuario; perfil: Perfil } | null {
  if (!token) return null;
  const linha = banco
    .prepare(
      `SELECT u.*, s.perfil AS perfilSessao FROM sessoes s
       JOIN usuarios u ON u.id = s.usuarioId
       WHERE s.token = ? AND s.expiraEm > ? AND u.ativo = 1`,
    )
    .get(token, Date.now()) as (Usuario & { perfilSessao: Perfil }) | undefined;
  if (!linha) return null;
  const { perfilSessao, ...usuario } = linha;
  return { usuario, perfil: perfilSessao };
}

export function tokenDoCabecalho(cabecalho: string | undefined): string | null {
  if (!cabecalho) return null;
  const [tipo, valor] = cabecalho.split(' ');
  return tipo?.toLowerCase() === 'bearer' && valor ? valor : null;
}
