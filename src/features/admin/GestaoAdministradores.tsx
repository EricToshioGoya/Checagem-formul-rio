import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AdministradorApi, type PedidoAdminApi } from '../../core/api/cliente';
import { useSessao } from '../../core/api/SessaoContexto';
import { Avatar } from '../../shared/componentes/Avatar';
import { AvisoFlutuante } from '../../shared/componentes/AvisoFlutuante';
import { Botao } from '../../shared/componentes/Botao';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeChave } from '../../shared/componentes/Icones';
import { dataBr, dataHoraBr, duracaoCurta } from '../../shared/utils/texto';
import { sessaoAdminAcabou } from './sessaoAdmin';

const RELEITURA_MS = 30_000;

interface Dados {
  administradores: AdministradorApi[];
  pedidos: PedidoAdminApi[];
}

interface Props {
  onSessaoVencida: () => void;
  onAlterado?: () => void;
}

/**
 * Quem administra o sistema, e quem pediu para administrar.
 *
 * Ninguém se promove sozinho: quem cria conta de administrador entra aqui
 * como pedido, e outro administrador aprova ou recusa. Tirar alguém do papel
 * derruba a sessão de administrador dessa pessoa na hora.
 */
export function GestaoAdministradores({ onSessaoVencida, onAlterado }: Props) {
  const { usuario } = useSessao();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [paraAprovar, setParaAprovar] = useState<PedidoAdminApi | null>(null);
  const [paraRemover, setParaRemover] = useState<AdministradorApi | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const temporizador = useRef<number | undefined>(undefined);

  const carregar = useCallback(async () => {
    try {
      setDados(await api.get<Dados>('/api/admin/administradores'));
      setErro(null);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível ler os administradores.');
    }
  }, [onSessaoVencida]);

  useEffect(() => {
    void carregar();
    // Um pedido novo aparece sem recarregar a página.
    const releitura = window.setInterval(() => {
      if (document.visibilityState === 'visible') void carregar();
    }, RELEITURA_MS);
    return () => window.clearInterval(releitura);
  }, [carregar]);

  useEffect(() => () => window.clearTimeout(temporizador.current), []);

  const avisar = (texto: string) => {
    setAviso(texto);
    onAlterado?.();
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setAviso(null), 3500);
  };

  /** Executa a ação, relê a lista e confirma — ou mostra o erro. */
  const agir = async (id: number, acao: () => Promise<unknown>, sucesso: string) => {
    setOcupado(id);
    try {
      await acao();
      await carregar();
      avisar(sucesso);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(null);
    }
  };

  const decidir = (pedido: PedidoAdminApi, aprovar: boolean) => {
    setParaAprovar(null);
    const nome = pedido.usuario.nome.split(' ')[0];
    void agir(
      pedido.id,
      () => api.post(`/api/admin/pedidos-admin/${pedido.id}/decisao`, { aprovar }),
      aprovar ? `${nome} agora tem acesso de administrador.` : `Pedido de ${nome} recusado.`,
    );
  };

  const remover = (admin: AdministradorApi) => {
    setParaRemover(null);
    void agir(
      admin.id,
      () => api.delete(`/api/admin/administradores/${admin.id}`),
      `${admin.nome.split(' ')[0]} não tem mais acesso de administrador.`,
    );
  };

  const cancelarAprovar = useCallback(() => setParaAprovar(null), []);
  const cancelarRemover = useCallback(() => setParaRemover(null), []);

  if (!dados && !erro) return <Carregando mensagem="Lendo os administradores…" />;

  const pendentes = dados?.pedidos.filter((p) => p.status === 'pendente') ?? [];
  const historico = dados?.pedidos.filter((p) => p.status !== 'pendente') ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Administradores</h2>
        <p className="text-base text-abb-gray">
          Quem pode liberar acessos, cadastrar painéis e aprovar novos administradores.
        </p>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      {dados ? (
        <>
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-base font-bold">
              Pedidos para ser administrador
              {pendentes.length > 0 ? (
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sky-500 px-1.5 text-sm font-bold text-white">
                  {pendentes.length}
                </span>
              ) : null}
            </h3>

            {pendentes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-abb-line bg-white px-4 py-3 text-center text-sm text-abb-gray">
                Nenhum pedido aguardando. Quem criar uma conta de administrador
                aparece aqui para você aprovar.
              </p>
            ) : (
              <ul className="space-y-2">
                {pendentes.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-white px-3 py-2.5 shadow-sm motion-safe:animate-surgir"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar nome={p.usuario.nome} chave={p.usuario.email} pequeno />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{p.usuario.nome}</p>
                        <p className="truncate text-xs text-abb-gray">{p.usuario.email}</p>
                        <p className="mt-0.5 text-xs text-abb-gray">
                          Pediu há {duracaoCurta(Date.now() - p.criadoEm)} · conta criada em{' '}
                          {dataBr(p.usuario.criadoEm)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Botao
                        tamanho="compacto"
                        variante="primario"
                        disabled={ocupado === p.id}
                        onClick={() => setParaAprovar(p)}
                      >
                        Aprovar
                      </Botao>
                      <Botao
                        tamanho="compacto"
                        variante="perigo"
                        disabled={ocupado === p.id}
                        onClick={() => decidir(p, false)}
                      >
                        Recusar
                      </Botao>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-bold">
              Administradores ({dados.administradores.length})
            </h3>
            <ul className="divide-y divide-abb-line/70 overflow-hidden rounded-xl border border-abb-line bg-white shadow-sm">
              {dados.administradores.map((a) => {
                const souEu = a.id === usuario?.id;
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar nome={a.nome} chave={a.email} pequeno />
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-sm font-semibold">
                          {a.nome}
                          {souEu ? (
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-bold text-abb-gray">
                              você
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-abb-gray">{a.email}</p>
                      </div>
                    </div>
                    <p className="flex items-center gap-1.5 text-xs text-abb-gray">
                      <IconeChave className="h-3.5 w-3.5 shrink-0" />
                      {a.aprovadoEm === null
                        ? 'Administrador inicial'
                        : a.aprovadoPor
                          ? `Aprovado por ${a.aprovadoPor} em ${dataBr(a.aprovadoEm)}`
                          : `Promovido no servidor em ${dataBr(a.aprovadoEm)}`}
                    </p>
                    {souEu ? null : (
                      <Botao
                        tamanho="compacto"
                        variante="perigo"
                        disabled={ocupado === a.id}
                        onClick={() => setParaRemover(a)}
                      >
                        Remover
                      </Botao>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {historico.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-base font-semibold text-abb-gray">Decisões recentes</h3>
              <ul className="space-y-1.5">
                {historico.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl bg-white/60 px-3 py-2 text-sm"
                  >
                    <span className="font-semibold">{p.usuario.nome}</span>
                    <span className="text-abb-gray">{p.usuario.email}</span>
                    <span className="text-abb-gray">
                      · {p.status === 'recusado' ? 'pedido recusado' : 'removido do papel'}
                      {p.decididoPor ? ` por ${p.decididoPor}` : ''} em{' '}
                      {dataHoraBr(p.decididoEm ?? undefined)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      <Confirmacao
        aberto={paraAprovar !== null}
        titulo="Aprovar administrador"
        mensagem={
          paraAprovar
            ? `${paraAprovar.usuario.nome} passa a poder liberar e retirar acessos, cadastrar painéis e checklists, e aprovar outros administradores.\n\nConfira se ${paraAprovar.usuario.email} é mesmo dessa pessoa: a conta não passa por confirmação de e-mail.`
            : ''
        }
        textoConfirmar="Aprovar"
        onConfirmar={() => paraAprovar && decidir(paraAprovar, true)}
        onCancelar={cancelarAprovar}
      />

      <Confirmacao
        aberto={paraRemover !== null}
        titulo="Remover administrador"
        mensagem={
          paraRemover
            ? `${paraRemover.nome} perde agora o acesso de administrador, e a sessão de administração cai na hora.\n\nA conta continua valendo para entrar como montador, e pode pedir o papel de novo.`
            : ''
        }
        textoConfirmar="Remover"
        onConfirmar={() => paraRemover && remover(paraRemover)}
        onCancelar={cancelarRemover}
      />

      <AvisoFlutuante texto={aviso} />
    </div>
  );
}
