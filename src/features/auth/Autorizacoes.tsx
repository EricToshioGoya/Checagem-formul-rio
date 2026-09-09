/**
 * Tela do responsável pelo painel: pendentes para decidir e acessos
 * concedidos para revogar.
 *
 * Existe porque decidir um por um pelo link do e-mail não escala quando
 * chega uma turma inteira de montadores no mesmo dia. Só quem entrou com
 * credencial de responsável daquele painel chega até aqui — o servidor
 * confere de novo em cada chamada.
 */
import { useCallback, useEffect, useState } from 'react';
import { AutorizacaoApi } from '../../core/auth/api';
import { useAutorizacao } from '../../core/auth/contexto';
import type { Solicitacao } from '../../core/auth/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { Carregando, Erro, Vazio } from '../../shared/componentes/Estado';

export function Autorizacoes() {
  const { sessao } = useAutorizacao();

  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [emAndamento, setEmAndamento] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!sessao) return;
    try {
      setSolicitacoes(
        await AutorizacaoApi.listarSolicitacoes(sessao.claims.painelId, sessao.credencial),
      );
      setErro(null);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler as solicitações.');
    }
  }, [sessao]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!sessao) return null;

  if (sessao.claims.papel !== 'responsavel') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Autorizações</h1>
        <Erro
          titulo="Área restrita"
          detalhe={
            'Só o responsável pelo painel aprova acessos. ' +
            'Se você é o responsável, entre com o e-mail cadastrado para este painel.'
          }
        />
      </div>
    );
  }

  const agir = async (id: string, acao: 'aprovar' | 'negar' | 'revogar') => {
    setEmAndamento(id);
    setErro(null);
    try {
      if (acao === 'revogar') {
        await AutorizacaoApi.revogar(id, sessao.credencial);
      } else {
        await AutorizacaoApi.decidir(id, acao === 'aprovar', sessao.credencial);
      }
      await carregar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir a operação.');
    } finally {
      setEmAndamento(null);
    }
  };

  const pendentes = solicitacoes?.filter((s) => s.status === 'pendente') ?? [];
  const ativas =
    solicitacoes?.filter((s) => s.status === 'aprovada' && !s.revogadoEm) ?? [];
  const encerradas =
    solicitacoes?.filter((s) => s.status === 'negada' || s.revogadoEm) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Autorizações</h1>
        <p className="text-base text-abb-gray">
          Painel {sessao.claims.painelNome}
        </p>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}
      {!solicitacoes && !erro ? <Carregando mensagem="Lendo as solicitações…" /> : null}

      {solicitacoes ? (
        <>
          <Secao titulo="Aguardando decisão" quantidade={pendentes.length}>
            {pendentes.length === 0 ? (
              <Vazio titulo="Nenhuma solicitação pendente" />
            ) : (
              pendentes.map((s) => (
                <Cartao key={s.id} solicitacao={s}>
                  <Botao
                    variante="primario"
                    onClick={() => void agir(s.id, 'aprovar')}
                    disabled={emAndamento === s.id}
                  >
                    Aprovar
                  </Botao>
                  <Botao
                    variante="perigo"
                    onClick={() => void agir(s.id, 'negar')}
                    disabled={emAndamento === s.id}
                  >
                    Negar
                  </Botao>
                </Cartao>
              ))
            )}
          </Secao>

          <Secao titulo="Com acesso liberado" quantidade={ativas.length}>
            {ativas.length === 0 ? (
              <Vazio titulo="Ninguém com acesso ativo neste painel" />
            ) : (
              ativas.map((s) => (
                <Cartao key={s.id} solicitacao={s}>
                  <Botao
                    variante="perigo"
                    onClick={() => void agir(s.id, 'revogar')}
                    disabled={emAndamento === s.id}
                  >
                    Revogar acesso
                  </Botao>
                </Cartao>
              ))
            )}
          </Secao>

          {encerradas.length > 0 ? (
            <Secao titulo="Encerradas" quantidade={encerradas.length}>
              {encerradas.map((s) => (
                <Cartao key={s.id} solicitacao={s} />
              ))}
            </Secao>
          ) : null}

          <p className="text-sm text-abb-gray">
            A credencial vale offline no aparelho de quem foi aprovado. Uma
            revogação só chega até ele quando o aparelho voltar a ter internet.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Secao({
  titulo,
  quantidade,
  children,
}: {
  titulo: string;
  quantidade: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">
        {titulo}
        <span className="ml-2 text-base font-normal text-abb-gray">({quantidade})</span>
      </h2>
      {children}
    </section>
  );
}

function Cartao({
  solicitacao,
  children,
}: {
  solicitacao: Solicitacao;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-abb-line bg-white p-4">
      <p className="text-base font-semibold break-all">{solicitacao.email}</p>
      <p className="mt-1 text-sm text-abb-gray">
        Pedido em {formatarData(solicitacao.criadoEm)} · aparelho{' '}
        {solicitacao.deviceId.slice(0, 8)}
      </p>
      {solicitacao.descricao ? (
        <p className="mt-2 rounded-md bg-neutral-100 p-2 text-base">{solicitacao.descricao}</p>
      ) : null}
      <p className="mt-2 text-sm">
        <Situacao solicitacao={solicitacao} />
      </p>
      {children ? <div className="mt-3 flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

function Situacao({ solicitacao }: { solicitacao: Solicitacao }) {
  if (solicitacao.revogadoEm) {
    return (
      <span className="font-semibold text-abb-red">
        Acesso revogado em {formatarData(solicitacao.revogadoEm)}
        {solicitacao.revogadoPor ? ` por ${solicitacao.revogadoPor}` : ''}
      </span>
    );
  }
  if (solicitacao.status === 'negada') {
    return <span className="font-semibold text-abb-red">Negada</span>;
  }
  if (solicitacao.status === 'aprovada') {
    return (
      <span className="font-semibold text-green-700">
        Aprovada{solicitacao.decididoEm ? ` em ${formatarData(solicitacao.decididoEm)}` : ''}
      </span>
    );
  }
  return <span className="font-semibold text-amber-700">Aguardando decisão</span>;
}

function formatarData(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? '—'
    : data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
