import { registrar } from './auditoria';
import { banco, emTransacao, type Usuario } from './banco';

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

/**
 * Dá o papel de administrador e fecha o pedido, se houver. Único caminho para
 * isso: a decisão na tela (`autor` é quem aprovou) e o comando de socorro no
 * servidor (`autor` nulo, que o histórico mostra como "Sistema").
 *
 * `reativar` religa a conta desativada — só o socorro precisa disso, e fica
 * registrado como qualquer outra reativação.
 */
export function promoverAdmin(
  usuarioId: number,
  autor: Pick<Usuario, 'id' | 'nome'> | null,
  { reativar = false }: { reativar?: boolean } = {},
): void {
  const conta = banco.prepare('SELECT nome, email, ativo FROM usuarios WHERE id = ?').get(usuarioId) as
    | { nome: string; email: string; ativo: number }
    | undefined;
  if (!conta) throw new Error('Conta não encontrada.');
  const agora = Date.now();
  emTransacao(() => {
    banco.prepare("UPDATE usuarios SET papel = 'admin' WHERE id = ?").run(usuarioId);
    if (reativar && !conta.ativo) {
      banco.prepare('UPDATE usuarios SET ativo = 1, desativadoEm = NULL WHERE id = ?').run(usuarioId);
      registrar({ autor, acao: 'reativou a conta', alvoTipo: 'conta', alvoId: usuarioId, alvo: `${conta.nome} (${conta.email})` });
    }
    banco
      .prepare(
        `INSERT INTO pedidos_admin (usuarioId, status, criadoEm, decididoEm, decididoPor)
         VALUES (?, 'aprovado', ?, ?, ?)
         ON CONFLICT (usuarioId) DO UPDATE SET
           status = 'aprovado', decididoEm = excluded.decididoEm, decididoPor = excluded.decididoPor`,
      )
      .run(usuarioId, agora, agora, autor?.id ?? null);
    registrar({
      autor,
      acao: 'aprovou como administrador',
      alvoTipo: 'administrador',
      alvoId: usuarioId,
      alvo: `${conta.nome} (${conta.email})`,
    });
  });
}

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
    registrarInicial();
  } else {
    console.warn(
      `Nenhum administrador ainda. A conta ${ADMIN_INICIAL} vira administradora ` +
        'ao ser criada — crie-a logo, antes de publicar o endereço.',
    );
  }
}

/** O administrador inicial também deixa rastro no histórico. */
function registrarInicial(): void {
  const conta = banco.prepare('SELECT id, nome, email FROM usuarios WHERE email = ?').get(ADMIN_INICIAL) as
    | { id: number; nome: string; email: string }
    | undefined;
  if (!conta) return;
  registrar({
    autor: null,
    acao: 'definiu como administrador inicial',
    alvoTipo: 'administrador',
    alvoId: conta.id,
    alvo: `${conta.nome} (${conta.email})`,
  });
}
