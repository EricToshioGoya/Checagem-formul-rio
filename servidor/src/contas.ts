import { banco, emTransacao, type Usuario } from './banco';
import { anonimizar, registrar } from './auditoria';
import { moverParaLixeira, removerRegistrosDeMidias } from './midias';

/**
 * Desativar, reativar e excluir contas. Fica fora das rotas porque o comando
 * de socorro (`npm run admin`) faz o mesmo, e as duas portas precisam seguir
 * exatamente as mesmas regras.
 */

type Autor = Pick<Usuario, 'id' | 'nome'> | null;

function obter(id: number): Usuario {
  const conta = banco.prepare('SELECT * FROM usuarios WHERE id = ?').get(id) as Usuario | undefined;
  if (!conta) throw new Error('Conta não encontrada.');
  return conta;
}

/** A conta não entra mais, e as sessões abertas caem na hora. Os dados ficam. */
export function desativarConta(id: number, autor: Autor): void {
  const conta = obter(id);
  if (!conta.ativo) return;
  emTransacao(() => {
    banco.prepare('UPDATE usuarios SET ativo = 0, desativadoEm = ? WHERE id = ?').run(Date.now(), id);
    banco.prepare('DELETE FROM sessoes WHERE usuarioId = ?').run(id);
    registrar({ autor, acao: 'desativou a conta', alvoTipo: 'conta', alvoId: id, alvo: `${conta.nome} (${conta.email})` });
  });
}

export function reativarConta(id: number, autor: Autor): void {
  const conta = obter(id);
  if (conta.ativo) return;
  emTransacao(() => {
    banco.prepare('UPDATE usuarios SET ativo = 1, desativadoEm = NULL WHERE id = ?').run(id);
    registrar({ autor, acao: 'reativou a conta', alvoTipo: 'conta', alvoId: id, alvo: `${conta.nome} (${conta.email})` });
  });
}

/** Painéis em que o e-mail da conta aparece como responsável. */
export function paineisComoResponsavel(email: string): string[] {
  return (
    banco
      .prepare(
        `SELECT p.nome FROM painel_responsaveis r JOIN paineis p ON p.id = r.painelId
          WHERE r.email = ? ORDER BY p.nome`,
      )
      .all(email) as Array<{ nome: string }>
  ).map((p) => p.nome);
}

/**
 * Exclusão definitiva, para atender a LGPD: some a conta, os pedidos, as
 * sessões, as cópias sincronizadas e as fotos (que passam 30 dias na lixeira
 * antes de sumir do disco e do backup). O e-mail sai da lista de responsáveis
 * dos painéis, e o histórico fica com "[conta excluída]" no lugar do nome.
 *
 * O que estiver só no aparelho da pessoa não é alcançado daqui.
 */
export function excluirConta(id: number, autor: Autor): { paineis: string[] } {
  const conta = obter(id);
  const paineis = paineisComoResponsavel(conta.email);

  const fotos = emTransacao(() => {
    banco.prepare('DELETE FROM painel_responsaveis WHERE email = ?').run(conta.email);
    // Decisões que a pessoa tomou continuam valendo, só sem o autor.
    banco.prepare('UPDATE solicitacoes SET decididoPor = NULL WHERE decididoPor = ?').run(id);
    banco.prepare('UPDATE pedidos_admin SET decididoPor = NULL WHERE decididoPor = ?').run(id);
    const uids = removerRegistrosDeMidias({ usuarioId: id });
    anonimizar(conta);
    banco.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    registrar({
      autor,
      acao: 'excluiu a conta',
      alvoTipo: 'conta',
      alvoId: id,
      alvo: '[conta excluída]',
      detalhe: paineis.length ? `Deixou de ser responsável por: ${paineis.join(', ')}` : null,
    });
    return uids;
  });
  moverParaLixeira(fotos);

  return { paineis };
}
