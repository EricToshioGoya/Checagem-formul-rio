import { banco } from './banco';
import { fazerBackup } from './backup';
import { desativarConta, excluirConta } from './contas';
import { emailSchema } from './esquemas';
import { verificarPublicacao } from './publicacao';

/**
 * Socorro e manutenção pela linha de comando, na máquina do servidor:
 *
 *   npm run admin -- listar                       administradores
 *   npm run admin -- promover pessoa@empresa.com  dá o papel de administrador
 *   npm run admin -- desativar pessoa@empresa.com bloqueia a conta (dados ficam)
 *   npm run admin -- excluir pessoa@empresa.com   exclui a conta e os dados dela
 *   npm run admin -- backup                       faz um backup agora
 *   npm run admin -- verificar                    "pronto para publicar?"
 *
 * Quem chega aqui já tem acesso à máquina e ao arquivo do banco, então não há
 * senha de aplicação a pedir.
 */

const [comando, argumento] = process.argv.slice(2);

function contaPorEmail(bruto: string | undefined): { id: number; papel: string; email: string } {
  const r = emailSchema.safeParse(bruto ?? '');
  if (!r.success) {
    console.error(`Informe o e-mail: npm run admin -- ${comando} pessoa@empresa.com`);
    process.exit(1);
  }
  const conta = banco.prepare('SELECT id, papel, email FROM usuarios WHERE email = ?').get(r.data) as
    | { id: number; papel: string; email: string }
    | undefined;
  if (!conta) {
    console.error(`Não existe conta com ${r.data}.`);
    process.exit(1);
  }
  return conta;
}

function listar(): void {
  const linhas = banco
    .prepare("SELECT nome, email, ativo FROM usuarios WHERE papel = 'admin' ORDER BY nome")
    .all() as Array<{ nome: string; email: string; ativo: number }>;
  if (linhas.length === 0) console.log('Nenhum administrador.');
  for (const l of linhas) console.log(`${l.email}  (${l.nome})${l.ativo ? '' : '  [desativada]'}`);
}

function promover(bruto: string | undefined): void {
  const conta = contaPorEmail(bruto);
  if (conta.papel === 'admin') {
    console.log(`${conta.email} já é administrador.`);
    return;
  }
  const agora = Date.now();
  banco.prepare("UPDATE usuarios SET papel = 'admin', ativo = 1, desativadoEm = NULL WHERE id = ?").run(conta.id);
  // Registra a promoção — sem quem decidiu, que é como a tela a reconhece
  // como feita no servidor — e atende um pedido pendente, se houver.
  banco
    .prepare(
      `INSERT INTO pedidos_admin (usuarioId, status, criadoEm, decididoEm, decididoPor)
       VALUES (?, 'aprovado', ?, ?, NULL)
       ON CONFLICT (usuarioId) DO UPDATE SET
         status = 'aprovado', decididoEm = excluded.decididoEm, decididoPor = NULL`,
    )
    .run(conta.id, agora, agora);
  console.log(`${conta.email} agora é administrador.`);
}

switch (comando) {
  case 'listar':
    listar();
    break;
  case 'promover':
    promover(argumento);
    break;
  case 'desativar': {
    const conta = contaPorEmail(argumento);
    desativarConta(conta.id, null);
    console.log(`${conta.email} desativada. As sessões abertas caíram.`);
    break;
  }
  case 'excluir': {
    const conta = contaPorEmail(argumento);
    const { paineis } = excluirConta(conta.id, null);
    console.log(`${conta.email} excluída.`);
    if (paineis.length) console.log(`Deixou de ser responsável por: ${paineis.join(', ')}.`);
    break;
  }
  case 'backup': {
    const feito = fazerBackup('manual');
    console.log(feito ? `Backup gravado: ${feito.arquivo}` : 'Já há um backup neste segundo.');
    break;
  }
  case 'verificar': {
    const itens = verificarPublicacao();
    for (const i of itens) console.log(`${i.ok ? '✓' : '⚠'} ${i.item}: ${i.detalhe}`);
    const pendentes = itens.filter((i) => !i.ok).length;
    console.log(pendentes ? `\n${pendentes} item(ns) a resolver antes de publicar.` : '\nPronto para publicar.');
    break;
  }
  default:
    console.log(
      'Uso:\n  npm run admin -- listar\n  npm run admin -- promover pessoa@empresa.com\n' +
        '  npm run admin -- desativar pessoa@empresa.com\n  npm run admin -- excluir pessoa@empresa.com\n' +
        '  npm run admin -- backup\n  npm run admin -- verificar',
    );
    process.exit(comando ? 1 : 0);
}
