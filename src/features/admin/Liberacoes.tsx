import { useCallback, useEffect, useState } from 'react';
import {
  AdminApi,
  ErroApi,
  ServidorIndisponivel,
  type SolicitacaoAcesso,
} from '../../core/acesso/api';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Carregando, Erro, Vazio } from '../../shared/componentes/Estado';

const INTERVALO_MS = 10000;

const ROTULO_STATUS: Record<SolicitacaoAcesso['status'], string> = {
  pendente: 'Aguardando liberação',
  liberado: 'Liberado',
  negado: 'Negado',
};

const COR_STATUS: Record<SolicitacaoAcesso['status'], string> = {
  pendente: 'bg-amber-100 text-amber-900',
  liberado: 'bg-green-100 text-green-900',
  negado: 'bg-red-100 text-abb-red',
};

function quando(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '—' : data.toLocaleString('pt-BR');
}

/** Fila de pedidos de acesso: é aqui que o administrador libera o montador. */
export function Liberacoes({ token, aoExpirar }: { token: string; aoExpirar: () => void }) {
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoAcesso[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [somentePendentes, setSomentePendentes] = useState(true);
  const [observacoes, setObservacoes] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const tratar = useCallback(
    (e: unknown) => {
      if (e instanceof ErroApi && e.codigo === 401) {
        aoExpirar();
        return;
      }
      setErro(
        e instanceof ServidorIndisponivel
          ? 'Sem conexão com o servidor de liberação.'
          : e instanceof Error
            ? e.message
            : 'Falha ao falar com o servidor.',
      );
    },
    [aoExpirar],
  );

  const carregar = useCallback(async () => {
    try {
      setSolicitacoes(await AdminApi.listar(token));
      setErro(null);
    } catch (e) {
      tratar(e);
    }
  }, [token, tratar]);

  useEffect(() => {
    void carregar();
    const id = window.setInterval(() => void carregar(), INTERVALO_MS);
    return () => window.clearInterval(id);
  }, [carregar]);

  const decidir = async (
    solicitacao: SolicitacaoAcesso,
    acao: 'liberar' | 'negar' | 'revogar',
  ) => {
    setOcupado(solicitacao.id);
    try {
      const atualizada = await AdminApi.decidir(
        token,
        solicitacao.id,
        acao,
        observacoes[solicitacao.id] ?? '',
      );
      setSolicitacoes((atual) =>
        (atual ?? []).map((s) => (s.id === atualizada.id ? atualizada : s)),
      );
      setErro(null);
    } catch (e) {
      tratar(e);
    } finally {
      setOcupado(null);
    }
  };

  const excluir = async (solicitacao: SolicitacaoAcesso) => {
    setOcupado(solicitacao.id);
    try {
      await AdminApi.excluir(token, solicitacao.id);
      setSolicitacoes((atual) => (atual ?? []).filter((s) => s.id !== solicitacao.id));
    } catch (e) {
      tratar(e);
    } finally {
      setOcupado(null);
    }
  };

  if (!solicitacoes && !erro) return <Carregando mensagem="Lendo a fila de liberação…" />;

  const pendentes = (solicitacoes ?? []).filter((s) => s.status === 'pendente').length;
  const lista = (solicitacoes ?? []).filter(
    (s) => !somentePendentes || s.status === 'pendente',
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base text-abb-gray">
          {pendentes === 0
            ? 'Nenhum pedido aguardando.'
            : `${pendentes} pedido${pendentes === 1 ? '' : 's'} aguardando liberação.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Botao onClick={() => setSomentePendentes((v) => !v)}>
            {somentePendentes ? 'Mostrar todos' : 'Só os pendentes'}
          </Botao>
          <Botao onClick={() => void carregar()}>Atualizar</Botao>
        </div>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      {lista.length === 0 ? (
        <Vazio titulo="Nada na fila">
          Os pedidos aparecem aqui assim que um montador informa e-mail e painel.
        </Vazio>
      ) : (
        <ul className="space-y-3">
          {lista.map((s) => (
            <li key={s.id} className="space-y-3 rounded-lg border border-abb-line bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-bold break-all">{s.email}</p>
                  <p className="text-sm text-abb-gray">
                    {s.painelNome || s.painelId} • pedido em {quando(s.criadoEm)}
                    {s.decididoEm ? ` • decidido em ${quando(s.decididoEm)}` : ''}
                  </p>
                </div>
                <span
                  className={`rounded px-2 py-1 text-sm font-bold ${COR_STATUS[s.status]}`}
                >
                  {ROTULO_STATUS[s.status]}
                </span>
              </div>

              <CampoTexto
                rotulo="Recado ao montador (opcional)"
                valor={observacoes[s.id] ?? s.observacao ?? ''}
                onChange={(v) => setObservacoes((atual) => ({ ...atual, [s.id]: v }))}
                placeholder="Aparece na tela dele."
              />

              <div className="flex flex-wrap gap-2">
                {s.status !== 'liberado' ? (
                  <Botao
                    variante="primario"
                    disabled={ocupado === s.id}
                    onClick={() => void decidir(s, 'liberar')}
                  >
                    Liberar
                  </Botao>
                ) : (
                  <Botao disabled={ocupado === s.id} onClick={() => void decidir(s, 'revogar')}>
                    Revogar acesso
                  </Botao>
                )}
                {s.status !== 'negado' ? (
                  <Botao
                    variante="perigo"
                    disabled={ocupado === s.id}
                    onClick={() => void decidir(s, 'negar')}
                  >
                    Negar
                  </Botao>
                ) : null}
                <Botao
                  variante="texto"
                  disabled={ocupado === s.id}
                  onClick={() => void excluir(s)}
                >
                  Excluir do histórico
                </Botao>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
