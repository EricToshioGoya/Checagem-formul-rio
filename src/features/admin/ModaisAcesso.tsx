import { useEffect, useMemo, useState } from 'react';
import {
  api,
  consulta,
  type AcessoAdmin,
  type AcessosDaConta,
  type ContaAdmin,
  type StatusAcesso,
} from '../../core/api/cliente';
import { Avatar } from '../../shared/componentes/Avatar';
import { Botao } from '../../shared/componentes/Botao';
import { Erro } from '../../shared/componentes/Estado';
import { IconeBusca, IconeCheck } from '../../shared/componentes/Icones';
import { Modal } from '../../shared/componentes/Modal';
import { dataHoraBr, duracaoCurta } from '../../shared/utils/texto';
import {
  SeletorPrazo,
  descreverValidade,
  escolhaInicial,
  paraEntradaData,
  paraValidade,
  type EscolhaPrazo,
} from './SeletorPrazo';

const DIA = 24 * 3_600_000;

/** A aprovação com prazo vencido vale como expirada, também na tela. */
export function statusAgora(a: AcessoAdmin, agora: number): StatusAcesso {
  return a.status === 'aprovada' && a.expiraEm !== null && a.expiraEm <= agora
    ? 'expirada'
    : a.status;
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

// ------------------------------------------------------------ liberar

interface PropsLiberar {
  aberto: boolean;
  paineis: Array<{ id: number; nome: string }>;
  agora: number;
  onFechar: () => void;
  onLiberado: (mensagem: string, usuarioId: number, painelIds: number[]) => void;
}

/**
 * Liberação direta: a administração escolhe a pessoa, os painéis e o prazo,
 * sem esperar pedido. Só aparecem contas já criadas e ativas — o acesso é
 * amarrado à conta, e quem ainda não tem uma cria na tela de login. As contas
 * são buscadas no servidor conforme se digita: a lista inteira não vem mais.
 */
export function ModalLiberarAcesso({ aberto, paineis, agora, onFechar, onLiberado }: PropsLiberar) {
  const [busca, setBusca] = useState('');
  const [contas, setContas] = useState<ContaAdmin[] | null>(null);
  const [usuario, setUsuario] = useState<ContaAdmin | null>(null);
  const [daConta, setDaConta] = useState<AcessosDaConta | null>(null);
  const [painelIds, setPainelIds] = useState<number[]>([]);
  const [escolha, setEscolha] = useState<EscolhaPrazo>(() => escolhaInicial());
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Cada abertura começa do zero: sobra da liberação anterior confunde.
  useEffect(() => {
    if (!aberto) return;
    setBusca('');
    setUsuario(null);
    setDaConta(null);
    setPainelIds([]);
    setEscolha(escolhaInicial());
    setErro(null);
  }, [aberto]);

  // Busca com uma pausa curta: não sai um pedido por tecla.
  useEffect(() => {
    if (!aberto || usuario) return;
    let ativo = true;
    const espera = window.setTimeout(() => {
      api
        .get<{ usuarios: ContaAdmin[] }>(`/api/admin/usuarios${consulta({ busca: busca.trim() })}`)
        .then((r) => {
          if (ativo) setContas(r.usuarios);
        })
        .catch((e) => {
          if (ativo) setErro(e instanceof Error ? e.message : 'Não foi possível buscar as contas.');
        });
    }, 250);
    return () => {
      ativo = false;
      window.clearTimeout(espera);
    };
  }, [aberto, busca, usuario]);

  // Escolhida a pessoa, vem a situação dela em cada painel.
  useEffect(() => {
    if (!usuario) return;
    let ativo = true;
    api
      .get<AcessosDaConta>(`/api/admin/usuarios/${usuario.id}/acessos`)
      .then((r) => {
        if (ativo) setDaConta(r);
      })
      .catch(() => {
        if (ativo) setDaConta({ acessos: [], responsavelPor: [] });
      });
    return () => {
      ativo = false;
    };
  }, [usuario]);

  /** Situação da pessoa escolhida em cada painel, para mostrar no botão do painel. */
  const situacao = useMemo(() => {
    const mapa = new Map<number, { status: StatusAcesso; expiraEm: number | null }>();
    for (const a of daConta?.acessos ?? []) {
      const vencido = a.status === 'aprovada' && a.expiraEm !== null && a.expiraEm <= agora;
      mapa.set(a.painelId, { status: vencido ? 'expirada' : a.status, expiraEm: a.expiraEm });
    }
    return mapa;
  }, [daConta, agora]);

  const ehResponsavel = (painelId: number) => !!daConta?.responsavelPor.includes(painelId);

  const selecionaveis = paineis.filter((p) => !ehResponsavel(p.id)).map((p) => p.id);
  const todosMarcados =
    selecionaveis.length > 0 && selecionaveis.every((id) => painelIds.includes(id));

  const alternar = (id: number) =>
    setPainelIds((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );

  const validade = paraValidade(escolha);
  const pronto = usuario !== null && painelIds.length > 0 && typeof validade !== 'string';

  const liberar = async () => {
    if (!usuario || typeof validade === 'string') return;
    setErro(null);
    setEnviando(true);
    try {
      await api.post('/api/admin/acessos', { usuarioId: usuario.id, painelIds, validade });
      onLiberado(
        `Acesso liberado para ${usuario.nome.split(' ')[0]} em ${plural(painelIds.length, 'painel', 'painéis')}.`,
        usuario.id,
        painelIds,
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível liberar o acesso.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      aberto={aberto}
      titulo="Liberar acesso"
      onFechar={onFechar}
      rodape={
        <>
          <p className="mr-auto self-center text-sm text-abb-gray">
            {pronto
              ? `${plural(painelIds.length, 'painel', 'painéis')} · ${descreverValidade(validade)}`
              : 'Escolha o montador, os painéis e o prazo.'}
          </p>
          <Botao onClick={onFechar}>Cancelar</Botao>
          <Botao variante="primario" disabled={!pronto || enviando} onClick={liberar}>
            {enviando ? 'Liberando…' : 'Liberar acesso'}
          </Botao>
        </>
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <Passo n={1} feito={usuario !== null} /> Montador
          </h3>
          {usuario ? (
            <div className="flex items-center gap-3 rounded-xl border border-abb-red bg-red-50/40 p-3">
              <Avatar nome={usuario.nome} chave={usuario.email} pequeno />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{usuario.nome}</p>
                <p className="truncate text-sm text-abb-gray">{usuario.email}</p>
              </div>
              <Botao
                variante="texto"
                onClick={() => {
                  setUsuario(null);
                  setDaConta(null);
                  setPainelIds([]);
                }}
              >
                Trocar
              </Botao>
            </div>
          ) : contas?.length === 0 && !busca.trim() ? (
            <p className="rounded-xl bg-neutral-100 p-3 text-base text-abb-gray">
              Nenhuma conta ativa ainda. O montador cria a conta na tela de login
              e aparece aqui em seguida.
            </p>
          ) : (
            <>
              <label className="relative block">
                <span className="sr-only">Buscar montador</span>
                <IconeBusca className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-abb-gray" />
                <input
                  type="search"
                  autoFocus
                  placeholder="Buscar por nome ou e-mail"
                  className="min-h-12 w-full rounded-xl border border-abb-line bg-white pr-3 pl-10 text-base focus:border-abb-red"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </label>
              <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded-xl border border-abb-line p-1">
                {contas === null ? (
                  <li className="p-3 text-sm text-abb-gray">Buscando…</li>
                ) : contas.length === 0 ? (
                  <li className="p-3 text-sm text-abb-gray">Nenhuma conta ativa com “{busca}”.</li>
                ) : (
                  contas.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => setUsuario(u)}
                        className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-100"
                      >
                        <Avatar nome={u.nome} chave={u.email} pequeno />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{u.nome}</span>
                          <span className="block truncate text-sm text-abb-gray">{u.email}</span>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </section>

        <section className={usuario ? '' : 'pointer-events-none opacity-40'} aria-disabled={!usuario}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Passo n={2} feito={painelIds.length > 0} /> Painéis
            </h3>
            {selecionaveis.length > 1 ? (
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm font-semibold text-abb-red hover:bg-red-50"
                onClick={() => setPainelIds(todosMarcados ? [] : selecionaveis)}
              >
                {todosMarcados ? 'Limpar' : 'Marcar todos'}
              </button>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {paineis.map((p) => {
              const responsavel = ehResponsavel(p.id);
              const marcado = painelIds.includes(p.id);
              const atual = situacao.get(p.id);
              const st = atual?.status ?? null;
              const nota = responsavel
                ? 'Responsável — já tem acesso'
                : st === 'aprovada'
                  ? atual!.expiraEm === null
                    ? 'Já tem acesso sem prazo'
                    : `Já tem acesso até ${dataHoraBr(atual!.expiraEm)}`
                  : st === 'pendente'
                    ? 'Pediu acesso'
                    : st === 'expirada'
                      ? 'Acesso expirado'
                      : st === 'revogada'
                        ? 'Acesso retirado'
                        : null;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={responsavel}
                  aria-pressed={marcado}
                  onClick={() => alternar(p.id)}
                  className={[
                    'flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left transition',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    marcado
                      ? 'border-abb-red bg-red-50/60'
                      : 'border-abb-line-botao bg-abb-offwhite hover:bg-abb-offwhite-hover',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2',
                      marcado ? 'border-abb-red bg-abb-red text-white' : 'border-neutral-300',
                    ].join(' ')}
                  >
                    {marcado ? <IconeCheck className="h-4 w-4" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{p.nome}</span>
                    {nota ? <span className="block text-xs text-abb-gray">{nota}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={usuario ? '' : 'pointer-events-none opacity-40'} aria-disabled={!usuario}>
          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <Passo n={3} feito={typeof validade !== 'string'} /> Prazo
          </h3>
          <SeletorPrazo valor={escolha} onChange={setEscolha} agora={agora} />
        </section>

        {erro ? <Erro detalhe={erro} /> : null}
      </div>
    </Modal>
  );
}

function Passo({ n, feito }: { n: number; feito: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition',
        feito ? 'bg-green-600 text-white' : 'bg-neutral-200 text-abb-gray',
      ].join(' ')}
    >
      {feito ? <IconeCheck className="h-3.5 w-3.5" /> : n}
    </span>
  );
}

// -------------------------------------------------------------- prazo

export type AcaoPrazo = 'aprovar' | 'alterar' | 'reativar';

const titulos: Record<AcaoPrazo, { titulo: string; botao: string; sucesso: string }> = {
  aprovar: { titulo: 'Aprovar pedido', botao: 'Aprovar acesso', sucesso: 'Pedido aprovado' },
  alterar: { titulo: 'Alterar prazo', botao: 'Salvar prazo', sucesso: 'Prazo atualizado' },
  reativar: { titulo: 'Reativar acesso', botao: 'Reativar acesso', sucesso: 'Acesso reativado' },
};

interface PropsPrazo {
  alvo: { acesso: AcessoAdmin; acao: AcaoPrazo } | null;
  agora: number;
  onFechar: () => void;
  onSalvo: (mensagem: string, acessoId: number) => void;
}

/** Um acesso, um prazo novo: aprova o pedido, estende o ativo ou reativa o encerrado. */
export function ModalPrazoAcesso({ alvo, agora, onFechar, onSalvo }: PropsPrazo) {
  const [escolha, setEscolha] = useState<EscolhaPrazo>(() => escolhaInicial());
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!alvo) return;
    setEscolha(escolhaInicial());
    setErro(null);
  }, [alvo]);

  if (!alvo) return null;
  const { acesso, acao } = alvo;
  const texto = titulos[acao];
  const validade = paraValidade(escolha);
  const prazoAtual =
    acao === 'alterar' && acesso.expiraEm !== null && acesso.expiraEm > agora
      ? acesso.expiraEm
      : null;

  const salvar = async () => {
    if (typeof validade === 'string') return;
    setErro(null);
    setEnviando(true);
    try {
      await api.put(`/api/admin/acessos/${acesso.id}`, { validade });
      onSalvo(`${texto.sucesso}: ${acesso.usuario.nome.split(' ')[0]} em ${acesso.painel.nome}.`, acesso.id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gravar o prazo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      aberto
      titulo={texto.titulo}
      onFechar={onFechar}
      rodape={
        <>
          <Botao onClick={onFechar}>Cancelar</Botao>
          <Botao
            variante="primario"
            disabled={typeof validade === 'string' || enviando}
            onClick={salvar}
          >
            {enviando ? 'Gravando…' : texto.botao}
          </Botao>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl bg-neutral-50 p-3">
          <Avatar nome={acesso.usuario.nome} chave={acesso.usuario.email} pequeno />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{acesso.usuario.nome}</p>
            <p className="truncate text-sm text-abb-gray">{acesso.usuario.email}</p>
          </div>
          <span className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-sm font-semibold ring-1 ring-abb-line">
            {acesso.painel.nome}
          </span>
        </div>

        {acao === 'aprovar' && acesso.mensagem ? (
          <p className="rounded-xl border-l-4 border-sky-400 bg-sky-50 px-3 py-2 text-base text-sky-950">
            “{acesso.mensagem}”
          </p>
        ) : null}

        {prazoAtual !== null ? (
          <div className="rounded-xl border border-abb-line p-3">
            <p className="text-sm text-abb-gray">
              Prazo atual: até <strong className="text-abb-black">{dataHoraBr(prazoAtual)}</strong>{' '}
              (faltam {duracaoCurta(prazoAtual - agora)})
            </p>
            <p className="mt-2 text-sm font-semibold">Estender a partir do prazo atual</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {[1, 2, 7].map((dias) => (
                <button
                  key={dias}
                  type="button"
                  className="min-h-10 rounded-lg border border-abb-line-botao bg-abb-offwhite px-3 text-sm font-semibold hover:border-abb-red hover:text-abb-red"
                  onClick={() =>
                    setEscolha({
                      ...escolha,
                      opcao: 'personalizado',
                      forma: 'data',
                      data: paraEntradaData(prazoAtual + dias * DIA),
                    })
                  }
                >
                  + {dias} {dias === 1 ? 'dia' : 'dias'}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <SeletorPrazo valor={escolha} onChange={setEscolha} agora={agora} />

        {erro ? <Erro detalhe={erro} /> : null}
      </div>
    </Modal>
  );
}
