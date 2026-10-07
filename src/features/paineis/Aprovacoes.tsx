import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type SolicitacaoApi } from '../../core/api/cliente';
import { Botao } from '../../shared/componentes/Botao';
import { Carregando, Erro, Vazio } from '../../shared/componentes/Estado';
import { dataHoraBr } from '../../shared/utils/texto';
import { Andamento } from './Andamento';

const situacao: Record<SolicitacaoApi['status'], { texto: string; classe: string }> = {
  pendente: { texto: 'Aguardando você', classe: 'bg-amber-100 text-amber-900' },
  aprovada: { texto: 'Aprovada', classe: 'bg-green-100 text-green-800' },
  recusada: { texto: 'Recusada', classe: 'bg-neutral-200 text-abb-gray' },
  expirada: { texto: 'Expirada', classe: 'bg-neutral-200 text-abb-gray' },
  revogada: { texto: 'Retirada', classe: 'bg-neutral-200 text-abb-gray' },
};

/**
 * Tela do responsável: os pedidos de acesso aos painéis dele e o andamento
 * de quem está montando. A visão fica na URL, para voltar a ela ao recarregar.
 */
export function Aprovacoes() {
  const [parametros, setParametros] = useSearchParams();
  const ver = parametros.get('ver') === 'andamento' ? 'andamento' : 'pedidos';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {ver === 'andamento' ? 'Andamento dos montadores' : 'Solicitações de acesso'}
        </h1>
        <div className="inline-flex rounded-lg bg-neutral-200/70 p-1" role="group" aria-label="Visão">
          {(
            [
              ['pedidos', 'Pedidos'],
              ['andamento', 'Andamento'],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              key={id}
              type="button"
              aria-pressed={ver === id}
              onClick={() => setParametros(id === 'pedidos' ? {} : { ver: id }, { replace: true })}
              className={[
                'min-h-9 rounded-md px-3 text-sm font-semibold transition',
                ver === id ? 'bg-white text-abb-black shadow-sm' : 'text-abb-gray hover:text-abb-black',
              ].join(' ')}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>
      {ver === 'andamento' ? <Andamento /> : <Pedidos />}
    </div>
  );
}

/** Caixa de entrada do dono: quem pediu acesso aos painéis dele. */
function Pedidos() {
  const [lista, setLista] = useState<SolicitacaoApi[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { solicitacoes } = await api.get<{ solicitacoes: SolicitacaoApi[] }>(
        '/api/solicitacoes',
      );
      setLista(solicitacoes);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler as solicitações.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const decidir = async (id: number, aprovar: boolean) => {
    setOcupado(id);
    try {
      await api.post(`/api/solicitacoes/${id}/decisao`, { aprovar });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar a decisão.');
    } finally {
      setOcupado(null);
    }
  };

  if (!lista && !erro) return <Carregando mensagem="Lendo as solicitações…" />;

  const pendentes = lista?.filter((s) => s.status === 'pendente') ?? [];
  const decididas = lista?.filter((s) => s.status !== 'pendente') ?? [];

  return (
    <div className="space-y-5">
      {erro ? <Erro detalhe={erro} /> : null}

      {lista?.length === 0 ? (
        <Vazio titulo="Nenhuma solicitação">
          Quando alguém pedir acesso a um painel seu, o pedido aparece aqui
          para você aprovar ou recusar.
        </Vazio>
      ) : null}

      {pendentes.length > 0 ? (
        <section className="space-y-3">
          <h2 className="border-b-2 border-abb-red pb-1 text-lg font-bold">
            Aguardando decisão ({pendentes.length})
          </h2>
          <ul className="space-y-3">
            {pendentes.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border-2 border-amber-300 bg-white p-4 shadow-sm"
              >
                <p className="text-lg font-bold">{s.solicitante.nome}</p>
                <p className="text-base text-abb-gray">{s.solicitante.email}</p>
                <p className="mt-2 text-base">
                  Pediu acesso a <strong>{s.painel.nome}</strong>
                </p>
                {s.mensagem ? (
                  <p className="mt-1 text-base text-abb-gray">“{s.mensagem}”</p>
                ) : null}
                <p className="mt-1 text-sm text-abb-gray">{dataHoraBr(s.criadoEm)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Botao
                    variante="primario"
                    disabled={ocupado === s.id}
                    onClick={() => decidir(s.id, true)}
                  >
                    Aprovar
                  </Botao>
                  <Botao
                    variante="perigo"
                    disabled={ocupado === s.id}
                    onClick={() => decidir(s.id, false)}
                  >
                    Recusar
                  </Botao>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {decididas.length > 0 ? (
        <section className="space-y-3">
          <h2 className="border-b border-abb-line pb-1 text-lg font-bold">Já decididas</h2>
          <ul className="space-y-2">
            {decididas.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-abb-line bg-white p-3"
              >
                <div className="min-w-0">
                  <p className="text-base font-semibold">{s.solicitante.nome}</p>
                  <p className="text-sm text-abb-gray">
                    {s.painel.nome} • {dataHoraBr(s.decididoEm ?? undefined)}
                    {s.status === 'aprovada' && s.expiraEm !== null
                      ? ` • até ${dataHoraBr(s.expiraEm)}`
                      : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-1 text-sm font-semibold ${situacao[s.status].classe}`}
                >
                  {situacao[s.status].texto}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
