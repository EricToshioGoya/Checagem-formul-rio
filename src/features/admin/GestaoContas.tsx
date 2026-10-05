import { useCallback, useEffect, useRef, useState } from 'react';
import { api, consulta, type ContaLinha, type RespostaContas } from '../../core/api/cliente';
import { useSessao } from '../../core/api/SessaoContexto';
import { Avatar } from '../../shared/componentes/Avatar';
import { AvisoFlutuante } from '../../shared/componentes/AvisoFlutuante';
import { Botao } from '../../shared/componentes/Botao';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeBusca } from '../../shared/componentes/Icones';
import { Modal } from '../../shared/componentes/Modal';
import { Paginacao } from '../../shared/componentes/Paginacao';
import { plural } from '../../../compartilhado/plural';
import { dataBr, dataHoraBr } from '../../shared/utils/texto';
import { sessaoAdminAcabou } from './sessaoAdmin';

type Filtro = 'todas' | 'ativas' | 'desativadas' | 'admins';

const FILTROS: Array<{ id: Filtro; rotulo: string }> = [
  { id: 'todas', rotulo: 'Todas' },
  { id: 'ativas', rotulo: 'Ativas' },
  { id: 'desativadas', rotulo: 'Desativadas' },
  { id: 'admins', rotulo: 'Administradores' },
];

interface PreviaExclusao {
  paineisComoResponsavel: string[];
  acessos: number;
  projetos: number;
  fotos: number;
}

interface Props {
  onSessaoVencida: () => void;
  onAlterado?: () => void;
}

/**
 * Contas: desativar (a pessoa não entra mais, os dados ficam) e excluir de
 * vez, para atender um pedido da LGPD. Ninguém mexe na própria conta.
 */
export function GestaoContas({ onSessaoVencida, onAlterado }: Props) {
  const { usuario: eu } = useSessao();
  const [dados, setDados] = useState<RespostaContas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [pagina, setPagina] = useState(1);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [paraDesativar, setParaDesativar] = useState<ContaLinha | null>(null);
  const [paraExcluir, setParaExcluir] = useState<{ conta: ContaLinha; previa: PreviaExclusao } | null>(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const temporizador = useRef<number | undefined>(undefined);

  const carregar = useCallback(async () => {
    try {
      const r = await api.get<RespostaContas>(
        `/api/admin/contas${consulta({ pagina, porPagina: 25, filtro: filtro === 'todas' ? null : filtro, busca: buscaAplicada })}`,
      );
      if (r.contas.length === 0 && r.pagina > 1) {
        setPagina(r.pagina - 1);
        return;
      }
      setDados(r);
      setErro(null);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível ler as contas.');
    }
  }, [onSessaoVencida, pagina, filtro, buscaAplicada]);

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

  useEffect(() => () => window.clearTimeout(temporizador.current), []);

  const avisar = (texto: string) => {
    setAviso(texto);
    onAlterado?.();
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setAviso(null), 3500);
  };

  const agir = async (conta: ContaLinha, acao: () => Promise<unknown>, sucesso: string) => {
    setOcupado(conta.id);
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

  const desativar = () => {
    const conta = paraDesativar;
    setParaDesativar(null);
    if (!conta) return;
    void agir(conta, () => api.post(`/api/admin/contas/${conta.id}/desativar`, {}), `Conta de ${conta.nome} desativada.`);
  };

  const prepararExclusao = async (conta: ContaLinha) => {
    setOcupado(conta.id);
    try {
      const previa = await api.get<PreviaExclusao>(`/api/admin/contas/${conta.id}/exclusao`);
      setConfirmacao('');
      setParaExcluir({ conta, previa });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível preparar a exclusão.');
    } finally {
      setOcupado(null);
    }
  };

  const excluir = () => {
    const alvo = paraExcluir;
    setParaExcluir(null);
    if (!alvo) return;
    void agir(alvo.conta, () => api.delete(`/api/admin/contas/${alvo.conta.id}`), 'Conta excluída.');
  };

  const fecharDesativar = useCallback(() => setParaDesativar(null), []);
  const fecharExcluir = useCallback(() => setParaExcluir(null), []);

  if (!dados && !erro) return <Carregando mensagem="Lendo as contas…" />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Contas</h2>
        <p className="text-sm text-abb-gray">
          Desative quem não deve mais entrar, ou exclua a conta e os dados dela a pedido da pessoa (LGPD).
        </p>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      {dados ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar contas">
              {FILTROS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filtro === f.id}
                  onClick={() => {
                    setFiltro(f.id);
                    setPagina(1);
                  }}
                  className={[
                    'min-h-9 rounded-full border px-3 text-sm font-semibold transition-colors',
                    filtro === f.id
                      ? 'border-abb-black bg-abb-black text-white'
                      : 'border-abb-line-botao bg-abb-offwhite text-abb-black hover:bg-abb-offwhite-hover',
                  ].join(' ')}
                >
                  {f.rotulo} <span className="tabular-nums opacity-70">{dados.contagem[f.id]}</span>
                </button>
              ))}
            </div>
            <label className="relative sm:ml-auto sm:w-64">
              <span className="sr-only">Buscar por nome ou e-mail</span>
              <IconeBusca className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-abb-gray" />
              <input
                type="search"
                placeholder="Buscar por nome ou e-mail"
                className="min-h-10 w-full rounded-lg border border-abb-line bg-white pr-3 pl-9 text-sm focus:border-abb-red"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>
          </div>

          {dados.contas.length === 0 ? (
            <p className="rounded-xl border border-abb-line bg-white p-6 text-center text-sm text-abb-gray">
              Nenhuma conta com esses filtros.
            </p>
          ) : (
            <ul className="divide-y divide-abb-line/70 overflow-hidden rounded-xl border border-abb-line bg-white shadow-sm">
              {dados.contas.map((c) => {
                const souEu = c.id === eu?.id;
                const resumo = [
                  c.ultimoAcessoEm ? `último acesso ${dataHoraBr(c.ultimoAcessoEm)}` : 'nunca entrou',
                  c.acessosAtivos ? plural(c.acessosAtivos, 'acesso ativo', 'acessos ativos') : null,
                  c.projetos ? `${plural(c.projetos, 'projeto', 'projetos')} no servidor` : null,
                  c.responsavelPor ? `responsável por ${plural(c.responsavelPor, 'painel', 'painéis')}` : null,
                ].filter(Boolean);
                return (
                  <li
                    key={c.id}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 ${c.ativo ? '' : 'bg-neutral-50'}`}
                  >
                    <div className={`flex min-w-0 flex-1 items-center gap-2.5 ${c.ativo ? '' : 'opacity-60'}`}>
                      <Avatar nome={c.nome} chave={c.email} pequeno />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm leading-tight font-semibold">
                          <span className="truncate">{c.nome}</span>
                          {souEu ? (
                            <span className="rounded-full bg-neutral-100 px-1.5 text-[10px] font-bold text-abb-gray">você</span>
                          ) : null}
                          {c.papel === 'admin' ? (
                            <span className="rounded-full bg-abb-red/10 px-1.5 text-[10px] font-bold text-abb-red">Administrador</span>
                          ) : null}
                          {!c.ativo ? (
                            <span className="rounded-full bg-neutral-200 px-1.5 text-[10px] font-bold text-neutral-700">
                              Desativada {c.desativadoEm ? `em ${dataBr(c.desativadoEm)}` : ''}
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-abb-gray">{c.email}</p>
                        <p className="truncate text-xs text-abb-gray">{resumo.join(' · ')}</p>
                      </div>
                    </div>
                    {souEu ? null : (
                      <div className="flex shrink-0 gap-1.5">
                        {c.ativo ? (
                          <Botao tamanho="compacto" disabled={ocupado === c.id} onClick={() => setParaDesativar(c)}>
                            Desativar
                          </Botao>
                        ) : (
                          <Botao
                            tamanho="compacto"
                            disabled={ocupado === c.id}
                            onClick={() =>
                              void agir(c, () => api.post(`/api/admin/contas/${c.id}/reativar`, {}), `Conta de ${c.nome} reativada.`)
                            }
                          >
                            Reativar
                          </Botao>
                        )}
                        <Botao
                          tamanho="compacto"
                          variante="perigo"
                          disabled={ocupado === c.id}
                          onClick={() => void prepararExclusao(c)}
                        >
                          Excluir
                        </Botao>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <Paginacao pagina={dados.pagina} porPagina={dados.porPagina} total={dados.total} onMudar={setPagina} />
        </>
      ) : null}

      <Confirmacao
        aberto={paraDesativar !== null}
        titulo="Desativar conta"
        mensagem={
          paraDesativar
            ? `${paraDesativar.nome} não consegue mais entrar, e as sessões abertas caem agora.\n\nAcessos, projetos sincronizados e histórico ficam guardados, e você pode reativar a conta depois.`
            : ''
        }
        textoConfirmar="Desativar"
        onConfirmar={desativar}
        onCancelar={fecharDesativar}
      />

      <Modal
        aberto={paraExcluir !== null}
        titulo="Excluir conta definitivamente"
        onFechar={fecharExcluir}
        rodape={
          <>
            <Botao onClick={fecharExcluir}>Cancelar</Botao>
            <Botao
              variante="perigo"
              disabled={confirmacao.trim().toLowerCase() !== paraExcluir?.conta.email}
              onClick={excluir}
            >
              Excluir definitivamente
            </Botao>
          </>
        }
      >
        {paraExcluir ? (
          <div className="space-y-3 text-sm">
            <p className="text-base">
              Excluir <strong>{paraExcluir.conta.nome}</strong> ({paraExcluir.conta.email}) não tem volta. Saem do servidor:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>a conta e as sessões abertas;</li>
              <li>{plural(paraExcluir.previa.acessos, 'acesso ou pedido', 'acessos e pedidos')} a painéis;</li>
              <li>
                {plural(paraExcluir.previa.projetos, 'projeto sincronizado', 'projetos sincronizados')} e{' '}
                {plural(paraExcluir.previa.fotos, 'foto', 'fotos')} — as fotos ficam 30 dias na lixeira do servidor
                antes de sumir também dos backups.
              </li>
              {paraExcluir.previa.paineisComoResponsavel.length ? (
                <li>
                  o e-mail sai dos responsáveis de: {paraExcluir.previa.paineisComoResponsavel.join(', ')}.
                </li>
              ) : null}
            </ul>
            <p className="text-abb-gray">
              No histórico, o nome vira “[conta excluída]”. O que estiver só no aparelho da pessoa não é alcançado
              daqui.
            </p>
            <label className="block">
              <span className="mb-1 block font-semibold">Para confirmar, digite o e-mail da conta</span>
              <input
                type="email"
                autoComplete="off"
                className="min-h-11 w-full rounded-lg border border-abb-line bg-white px-3 text-base focus:border-abb-red"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                placeholder={paraExcluir.conta.email}
              />
            </label>
          </div>
        ) : null}
      </Modal>

      <AvisoFlutuante texto={aviso} />
    </div>
  );
}
