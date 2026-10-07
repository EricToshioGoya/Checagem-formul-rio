import { banco } from './banco';

/**
 * Administração do lado do servidor.
 *
 * Administrador é um papel da conta (`usuarios.papel`), e não uma senha
 * compartilhada: entra pela mesma tela de login, em "Entrar como
 * administrador", com o próprio e-mail e senha. Cada ação fica com o nome de
 * quem fez, e tirar alguém do papel não exige trocar nada dos outros.
 *
 * Novos administradores criam a conta pedindo o papel, e outro administrador
 * aprova ou recusa — ninguém se promove sozinho.
 */

/**
 * Primeiro administrador. Como os painéis iniciais, é semente e não
 * configuração: só vale enquanto não existir administrador nenhum.
 */
export const ADMIN_INICIAL = (process.env.ADMIN_INICIAL ?? 'ericg10456@gmail.com')
  .trim()
  .toLowerCase();

export function quantosAdmins(): number {
  const { n } = banco.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'admin'").get() as {
    n: number;
  };
  return Number(n);
}

/**
 * Na criação de conta: o e-mail inicial nasce administrador se ainda não há
 * nenhum — não existe quem aprovaria o pedido dele.
 */
export function deveNascerAdmin(email: string): boolean {
  return email === ADMIN_INICIAL && quantosAdmins() === 0;
}

/**
 * Na subida: sem administrador nenhum, promove a conta do e-mail inicial, se
 * ela já existir. Se ainda não existir, ela nasce administradora ao ser criada.
 */
export function garantirAdminInicial(): void {
  if (quantosAdmins() > 0) return;
  const r = banco
    .prepare("UPDATE usuarios SET papel = 'admin' WHERE email = ?")
    .run(ADMIN_INICIAL);
  if (Number(r.changes) > 0) {
    console.log(`Administrador inicial: ${ADMIN_INICIAL}.`);
  } else {
    console.warn(
      `Nenhum administrador ainda. A conta ${ADMIN_INICIAL} vira administradora ` +
        'ao ser criada — crie-a logo, antes de publicar o endereço.',
    );
  }
}
