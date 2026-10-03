import { useCallback, useEffect, useState } from 'react';
import { api, consulta, type RespostaHistorico } from '../../core/api/cliente';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeBusca } from '../../shared/componentes/Icones';
import { Paginacao } from '../../shared/componentes/Paginacao';
import { dataHoraBr } from '../../shared/utils/texto';
import { sessaoAdminAcabou } from './sessaoAdmin';

type Tipo = 'todos' | 'acessos' | 'paineis' | 'contas' | 'sistema';

const TIPOS: Array<{ id: Tipo; rotulo: string }> = [
  { id: 'todos', rotulo: 'Tudo' },
  { id: 'acessos', rotulo: 'Acessos' },
  { id: 'paineis', rotulo: 'Painéis e checklists' },
  { id: 'contas', rotulo: 'Contas e administradores' },
  { id: 'sistema', rotulo: 'Sistema' },
];

/** Cor do marcador por tipo de alvo — classes por extenso, para o Tailwind gerar. */
const COR: Record<string, string> = {
  acesso: 'bg-green-500',
  painel: 'bg-sky-500',
  checklist: 'bg-sky-500',
  conta: 'bg-amber-500',
  administrador: 'bg-abb-red',
  sistema: 'bg-neutral-400',
};

/** Histórico da administração: quem liberou, editou, retirou ou excluiu o quê. */
export function Historico({ onSessaoVencida }: { onSessaoVencida: () => void }) {
  const [dados, setDados] = useState<RespostaHistorico | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tipo, setTipo] = useState<Tipo>('todos');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [pagina, setPagina] = useState(1);

  const carregar = useCallback(async () => {
    try {
      setDados(
        await api.get<RespostaHistorico>(
          `/api/admin/auditoria${consulta({ pagina, tipo: tipo === 'todos' ? null : tipo, busca: buscaAplicada })}`,
        ),
      );
      setErro(null);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível ler o histórico.');
    }
  }, [onSessaoVencida, pagina, tipo, buscaAplicada]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    const espera = window.setTimeout(() => {
      setBuscaAplicada(busca.trim());
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(espera);
  }, [busca]);

  if (!dados && !erro) return <Carregando mensagem="Lendo o histórico…" />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Histórico</h2>
        <p className="text-sm text-abb-gray">
          Quem liberou, editou, retirou ou excluiu o quê — com data e hora.
        </p>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar o histórico">
          {TIPOS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tipo === t.id}
              onClick={() => {
                setTipo(t.id);
                setPagina(1);
              }}
              className={[
                'min-h-9 rounded-full border px-3 text-sm font-semibold transition-colors',
                tipo === t.id
                  ? 'border-abb-black bg-abb-black text-white'
                  : 'border-abb-line-botao bg-abb-offwhite text-abb-black hover:bg-abb-offwhite-hover',
              ].join(' ')}
            >
              {t.rotulo}
            </button>
          ))}
        </div>
        <label className="relative sm:ml-auto sm:w-64">
          <span className="sr-only">Buscar no histórico</span>
          <IconeBusca className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-abb-gray" />
          <input
            type="search"
            placeholder="Buscar pessoa, painel, ação…"
            className="min-h-10 w-full rounded-lg border border-abb-line bg-white pr-3 pl-9 text-sm focus:border-abb-red"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
      </div>

      {dados ? (
        dados.registros.length === 0 ? (
          <p className="rounded-xl border border-abb-line bg-white p-6 text-center text-sm text-abb-gray">
            Nada registrado {buscaAplicada || tipo !== 'todos' ? 'com esses filtros' : 'ainda'}.
          </p>
        ) : (
          <>
            <ol className="divide-y divide-abb-line/70 overflow-hidden rounded-xl border border-abb-line bg-white shadow-sm">
              {dados.registros.map((r) => (
                <li key={r.id} className="flex gap-3 px-3 py-2.5">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${COR[r.alvoTipo] ?? 'bg-neutral-400'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <strong className="font-semibold">{r.autor}</strong> {r.acao}{' '}
                      <span className="font-semibold">{r.alvo}</span>
                    </p>
                    {r.detalhe ? <p className="text-xs text-abb-gray">{r.detalhe}</p> : null}
                  </div>
                  <time className="shrink-0 text-xs text-abb-gray tabular-nums" dateTime={new Date(r.em).toISOString()}>
                    {dataHoraBr(r.em)}
                  </time>
                </li>
              ))}
            </ol>
            <Paginacao pagina={dados.pagina} porPagina={dados.porPagina} total={dados.total} onMudar={setPagina} />
          </>
        )
      ) : null}
    </div>
  );
}
