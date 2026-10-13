import { useCallback, useEffect, useState } from 'react';
import { api, consulta, ErroApi, type RespostaAndamento } from '../../core/api/cliente';
import { Avatar } from '../../shared/componentes/Avatar';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { Paginacao } from '../../shared/componentes/Paginacao';
import { dataHoraBr, duracaoCurta } from '../../shared/utils/texto';
import { DetalheAndamento } from './DetalheAndamento';

const RELEITURA_MS = 60_000;

/**
 * Andamento dos montadores, do que eles sincronizaram, em todos os painéis
 * (só administradores).
 * Quem tem acesso e ainda não enviou nada aparece em 0%. Tocar num projeto
 * abre o que já foi concluído, seção por seção e etapa por etapa.
 */
export function Andamento({ onSessaoVencida }: { onSessaoVencida?: () => void }) {
  const [dados, setDados] = useState<RespostaAndamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [painel, setPainel] = useState<number | 'todos'>('todos');
  const [pagina, setPagina] = useState(1);
  // Projetos abertos, pela chave `usuarioId:projetoUid`.
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());

  const carregar = useCallback(async () => {
    try {
      setDados(
        await api.get<RespostaAndamento>(
          `/api/andamento${consulta({ pagina, porPagina: 25, painel: painel === 'todos' ? null : painel })}`,
        ),
      );
      setErro(null);
    } catch (e) {
      if (onSessaoVencida && e instanceof ErroApi && e.status === 401) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível ler o andamento.');
    }
  }, [onSessaoVencida, pagina, painel]);

  useEffect(() => {
    void carregar();
    const releitura = window.setInterval(() => {
      if (document.visibilityState === 'visible') void carregar();
    }, RELEITURA_MS);
    return () => window.clearInterval(releitura);
  }, [carregar]);

  if (!dados && !erro) return <Carregando mensagem="Lendo o andamento…" />;

  return (
    <div className="space-y-3">
      {erro ? <Erro detalhe={erro} /> : null}

      {dados && dados.paineis.length === 0 ? (
        <p className="rounded-xl border border-dashed border-abb-line bg-white p-6 text-center text-sm text-abb-gray">
          Ainda não há painéis cadastrados.
        </p>
      ) : dados ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-abb-gray">
              {dados.total} {dados.total === 1 ? 'linha' : 'linhas'}: cada projeto enviado e
              quem tem acesso sem projeto ainda. Atualiza sozinho.
            </p>
            {dados.paineis.length > 1 ? (
              <select
                aria-label="Filtrar por painel"
                className="min-h-10 rounded-lg border border-abb-line bg-white px-3 text-sm focus:border-abb-red"
                value={String(painel)}
                onChange={(e) => {
                  setPainel(e.target.value === 'todos' ? 'todos' : Number(e.target.value));
                  setPagina(1);
                }}
              >
                <option value="todos">Todos os painéis</option>
                {dados.paineis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {dados.itens.length === 0 ? (
            <p className="rounded-xl border border-abb-line bg-white p-6 text-center text-sm text-abb-gray">
              Ninguém com acesso a {painel === 'todos' ? 'estes painéis' : 'este painel'} ainda.
            </p>
          ) : (
            <ul className="divide-y divide-abb-line/70 overflow-hidden rounded-xl border border-abb-line bg-white shadow-sm">
              {dados.itens.map((i) => {
                const chave = i.projeto ? `${i.usuario.id}:${i.projeto.uid}` : null;
                const aberto = chave !== null && abertos.has(chave);
                const alternar = () => {
                  if (!chave) return;
                  setAbertos((atual) => {
                    const novo = new Set(atual);
                    if (novo.has(chave)) novo.delete(chave);
                    else novo.add(chave);
                    return novo;
                  });
                };
                return (
                  <li key={`${i.painel.id}-${i.usuario.id}-${i.projeto?.uid ?? ''}`}>
                    <div
                      role={chave ? 'button' : undefined}
                      tabIndex={chave ? 0 : undefined}
                      aria-expanded={chave ? aberto : undefined}
                      title={chave ? (aberto ? 'Fechar o detalhe' : 'Ver seções e etapas') : undefined}
                      onClick={alternar}
                      onKeyDown={(e) => {
                        if (chave && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          alternar();
                        }
                      }}
                      className={[
                        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.3fr)]',
                        chave ? 'cursor-pointer hover:bg-neutral-50' : '',
                      ].join(' ')}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar nome={i.usuario.nome} chave={i.usuario.email} pequeno />
                        <div className="min-w-0">
                          <p className="truncate text-sm leading-tight font-semibold">{i.usuario.nome}</p>
                          <p className="truncate text-xs text-abb-gray">
                            {i.projeto?.nome ? `${i.projeto.nome} · ` : ''}
                            {i.empresa ? `${i.empresa} · ` : ''}
                            {i.usuario.email}
                          </p>
                        </div>
                      </div>
                      <span className="justify-self-end truncate rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-semibold md:justify-self-start">
                        {i.painel.nome}
                      </span>
                      <div className="col-span-2 min-w-0 md:col-span-1">
                        {i.enviadoEm === null ? (
                          <p className="text-xs text-abb-gray">Ainda não enviou nada.</p>
                        ) : (
                          <>
                            <p className="flex items-baseline justify-between gap-2 text-xs">
                              <span className="font-semibold tabular-nums">
                                {i.percentual}% <span className="font-normal text-abb-gray">({i.respondidas} de {i.total})</span>
                              </span>
                              <span className="truncate text-abb-gray" title={`Enviado em ${dataHoraBr(i.enviadoEm)}`}>
                                {i.alteradoEm ? `mexeu há ${duracaoCurta(Date.now() - i.alteradoEm)}` : ''}
                              </span>
                            </p>
                            <div
                              className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100"
                              role="progressbar"
                              aria-label={`Andamento de ${i.usuario.nome}`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={i.percentual}
                            >
                              <div
                                className={`h-full rounded-full ${i.percentual === 100 ? 'bg-green-600' : 'bg-abb-red'}`}
                                style={{ width: `${i.percentual}%` }}
                              />
                            </div>
                            {chave ? (
                              <p className="mt-1 text-xs font-semibold text-abb-red">
                                {aberto ? 'Fechar detalhe ▴' : 'Ver seções e etapas ▾'}
                              </p>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                    {aberto && i.projeto ? (
                      <div className="border-t border-abb-line/70 bg-white px-3 py-3">
                        <DetalheAndamento
                          usuarioId={i.usuario.id}
                          projetoUid={i.projeto.uid}
                          enviadoEm={i.enviadoEm}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <Paginacao pagina={dados.pagina} porPagina={dados.porPagina} total={dados.total} onMudar={setPagina} />
        </>
      ) : null}
    </div>
  );
}
