import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  consulta,
  type AcessoAdmin,
  type RespostaAcessosAdmin,
  type StatusAcesso,
} from '../../core/api/cliente';
import { Avatar } from '../../shared/componentes/Avatar';
import { AvisoFlutuante } from '../../shared/componentes/AvisoFlutuante';
import { Botao } from '../../shared/componentes/Botao';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeBusca, IconeInfinito, IconeMais } from '../../shared/componentes/Icones';
import { Paginacao } from '../../shared/componentes/Paginacao';
import { sessaoAdminAcabou } from './sessaoAdmin';
import { dataBr, dataHoraBr, duracaoCurta } from '../../shared/utils/texto';
import {
  ModalLiberarAcesso,
  ModalPrazoAcesso,
  statusAgora,
  type AcaoPrazo,
} from './ModaisAcesso';

/** Acesso com prazo dentro desta janela aparece como "vencendo". */
const JANELA_VENCENDO = 48 * 3_600_000;
/** A contagem regressiva anda sozinha; a lista é relida do servidor. */
const TIQUE_MS = 15_000;
const RELEITURA_MS = 30_000;

type Filtro = 'todos' | 'ativos' | 'vencendo' | 'pendentes' | 'encerrados';

const PILULA: Record<StatusAcesso, { texto: string; classe: string; ponto: string }> = {
  aprovada: { texto: 'Ativo', classe: 'bg-green-50 text-green-800 ring-green-200', ponto: 'bg-green-500' },
  pendente: { texto: 'Aguardando', classe: 'bg-sky-50 text-sky-900 ring-sky-200', ponto: 'bg-sky-500' },
  expirada: { texto: 'Expirado', classe: 'bg-neutral-100 text-neutral-600 ring-neutral-200', ponto: 'bg-neutral-400' },
  revogada: { texto: 'Retirado', classe: 'bg-red-50 text-red-800 ring-red-200', ponto: 'bg-abb-red' },
  recusada: { texto: 'Recusado', classe: 'bg-neutral-100 text-neutral-600 ring-neutral-200', ponto: 'bg-neutral-400' },
};

/** Registros por página: cabem numa tela sem rolar, com as linhas compactas. */
const POR_PAGINA = 25;

interface Props {
  /** A sessão de administrador acabou no servidor: volta para o login. */
  onSessaoVencida: () => void;
  /** Uma ação mudou os contadores — a tela de cima atualiza os selos. */
  onAlterado?: () => void;
}

/**
 * Controle de acesso aos painéis: quem pode preencher o quê, e até quando.
 *
 * A administração libera direto (sem esperar pedido), com prazo — horas, dias,
 * até uma data — ou sem prazo; estende, retira e reativa. O vencimento não
 * depende de ninguém: passada a hora, o servidor para de entregar o painel.
 */
export function GestaoAcessos({ onSessaoVencida, onAlterado }: Props) {
  const [dados, setDados] = useState<RespostaAcessosAdmin | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Diferença entre o relógio do servidor e o do aparelho. */
  const [desvio, setDesvio] = useState(0);
  const [agoraLocal, setAgoraLocal] = useState(() => Date.now());

  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  /** A busca vai ao servidor depois de uma pausa na digitação. */
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [painelFiltro, setPainelFiltro] = useState<number | 'todos'>('todos');
  const [pagina, setPagina] = useState(1);

  const [liberarAberto, setLiberarAberto] = useState(false);
  const [prazoAlvo, setPrazoAlvo] = useState<{ acesso: AcessoAdmin; acao: AcaoPrazo } | null>(null);
  const [paraEncerrar, setParaEncerrar] = useState<AcessoAdmin | null>(null);
  const [paraApagar, setParaApagar] = useState<AcessoAdmin | null>(null);
  const [destaque, setDestaque] = useState<Set<number>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);
  const temporizadorAviso = useRef<number | undefined>(undefined);

  const agora = agoraLocal + desvio;

  // Filtro, busca e página vão ao servidor: a lista inteira não vem mais de
  // uma vez, e a ordem (pedidos primeiro, depois o que vence antes) é dele.
  const carregar = useCallback(async () => {
    try {
      const resposta = await api.get<RespostaAcessosAdmin>(
        `/api/admin/acessos${consulta({
          pagina,
          porPagina: POR_PAGINA,
          filtro: filtro === 'todos' ? null : filtro,
          busca: buscaAplicada,
          painel: painelFiltro === 'todos' ? null : painelFiltro,
        })}`,
      );
      // Página que ficou vazia (a última linha dela saiu): volta uma.
      if (resposta.acessos.length === 0 && resposta.pagina > 1) {
        setPagina(resposta.pagina - 1);
        return null;
      }
      setDesvio(resposta.agora - Date.now());
      setAgoraLocal(Date.now());
      setDados(resposta);
      setErro(null);
      return resposta;
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível ler os acessos.');
      return null;
    }
  }, [onSessaoVencida, pagina, filtro, buscaAplicada, painelFiltro]);

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

  // Contagem regressiva viva, e releitura periódica para que um pedido novo
  // apareça sem recarregar a página. Aba escondida não consulta o servidor.
  useEffect(() => {
    const tique = window.setInterval(() => setAgoraLocal(Date.now()), TIQUE_MS);
    const releitura = window.setInterval(() => {
      if (document.visibilityState === 'visible') void carregar();
    }, RELEITURA_MS);
    return () => {
      window.clearInterval(tique);
      window.clearInterval(releitura);
    };
  }, [carregar]);

  useEffect(() => () => window.clearTimeout(temporizadorAviso.current), []);

  const avisar = useCallback(
    (texto: string, ids: number[]) => {
      setAviso(texto);
      setDestaque(new Set(ids));
      onAlterado?.();
      window.clearTimeout(temporizadorAviso.current);
      temporizadorAviso.current = window.setTimeout(() => {
        setAviso(null);
        setDestaque(new Set());
      }, 3500);
    },
    [onAlterado],
  );

  // Callbacks estáveis: o modal refoca a caixa quando `onFechar` muda, e esta
  // tela se redesenha a cada tique do relógio.
  const fecharLiberar = useCallback(() => setLiberarAberto(false), []);
  const fecharPrazo = useCallback(() => setPrazoAlvo(null), []);
  const cancelarEncerrar = useCallback(() => setParaEncerrar(null), []);
  const cancelarApagar = useCallback(() => setParaApagar(null), []);

  /** Tira da lista o registro de um acesso já encerrado. */
  const apagar = useCallback(async () => {
    const alvo = paraApagar;
    if (!alvo) return;
    setParaApagar(null);
    try {
      await api.delete(`/api/admin/acessos/${alvo.id}`);
      await carregar();
      avisar(`Registro de ${alvo.usuario.nome.split(' ')[0]} em ${alvo.painel.nome} excluído.`, []);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível excluir o registro.');
    }
  }, [avisar, carregar, onSessaoVencida, paraApagar]);

  const aoLiberar = useCallback(
    async (mensagem: string, usuarioId: number, painelIds: number[]) => {
      setLiberarAberto(false);
      const novo = await carregar();
      const ids =
        novo?.acessos
          .filter((a) => a.usuario.id === usuarioId && painelIds.includes(a.painel.id))
          .map((a) => a.id) ?? [];
      avisar(mensagem, ids);
    },
    [avisar, carregar],
  );

  const aoSalvarPrazo = useCallback(
    async (mensagem: string, acessoId: number) => {
      setPrazoAlvo(null);
      await carregar();
      avisar(mensagem, [acessoId]);
    },
    [avisar, carregar],
  );

  const encerrar = useCallback(async () => {
    const alvo = paraEncerrar;
    if (!alvo) return;
    setParaEncerrar(null);
    try {
      await api.post(`/api/admin/acessos/${alvo.id}/revogar`, {});
      await carregar();
      const nome = alvo.usuario.nome.split(' ')[0];
      avisar(
        alvo.status === 'pendente'
          ? `Pedido de ${nome} recusado.`
          : `Acesso de ${nome} a ${alvo.painel.nome} retirado.`,
        [alvo.id],
      );
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível retirar o acesso.');
    }
  }, [avisar, carregar, onSessaoVencida, paraEncerrar]);

  if (!dados && !erro) return <Carregando mensagem="Lendo os acessos…" />;

  const contagem = dados?.contagem ?? { ativos: 0, temporarios: 0, vencendo: 0, pendentes: 0, encerrados: 0 };
  const visiveis = dados?.acessos ?? [];
  const filtrando = filtro !== 'todos' || busca.trim() !== '' || painelFiltro !== 'todos';
  const mudarFiltro = (novo: Filtro) => {
    setFiltro(novo);
    setPagina(1);
  };
  const limparFiltros = () => {
    setFiltro('todos');
    setBusca('');
    setBuscaAplicada('');
    setPainelFiltro('todos');
    setPagina(1);
  };

  const cartoes: Array<{ id: Filtro; rotulo: string; valor: number; detalhe: string; ponto: string }> = [
    {
      id: 'ativos',
      rotulo: 'Com acesso',
      valor: contagem.ativos,
      detalhe:
        contagem.temporarios === 0
          ? 'todos sem prazo'
          : `${contagem.temporarios} com prazo`,
      ponto: 'bg-green-500',
    },
    {
      id: 'vencendo',
      rotulo: 'Vencem em 48 h',
      valor: contagem.vencendo,
      detalhe: contagem.vencendo === 0 ? 'nada perto do fim' : 'renove ou deixe vencer',
      ponto: 'bg-amber-500',
    },
    {
      id: 'pendentes',
      rotulo: 'Aguardando',
      valor: contagem.pendentes,
      detalhe: contagem.pendentes === 0 ? 'nenhum pedido' : 'pedidos para decidir',
      ponto: 'bg-sky-500',
    },
    {
      id: 'encerrados',
      rotulo: 'Encerrados',
      valor: contagem.encerrados,
      detalhe: 'expirados, retirados, recusados',
      ponto: 'bg-neutral-400',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Acessos aos painéis</h2>
          <p className="text-sm text-abb-gray">
            Libere por um prazo ou sem prazo, estenda e retire quando quiser.
          </p>
        </div>
        {dados ? (
          <Botao variante="primario" onClick={() => setLiberarAberto(true)}>
            <IconeMais className="h-5 w-5" />
            Liberar acesso
          </Botao>
        ) : null}
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      {dados ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cartoes.map((c) => {
              const ativo = filtro === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => mudarFiltro(ativo ? 'todos' : c.id)}
                  className={[
                    'rounded-xl border bg-white px-3 py-2.5 text-left transition',
                    'hover:shadow-md',
                    ativo
                      ? 'border-abb-red shadow-md ring-2 ring-abb-red/15'
                      : 'border-abb-line shadow-sm',
                  ].join(' ')}
                >
                  <span className="flex items-center justify-between gap-2 text-xs font-semibold text-abb-gray">
                    {c.rotulo}
                    <span className={`h-2 w-2 rounded-full ${c.ponto}`} />
                  </span>
                  <span className="block text-2xl leading-tight font-bold tabular-nums">
                    {c.valor}
                  </span>
                  <span className="block truncate text-xs text-abb-gray">{c.detalhe}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
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
            <select
              aria-label="Filtrar por painel"
              className="min-h-10 rounded-lg border border-abb-line bg-white px-3 text-sm focus:border-abb-red sm:w-56"
              value={String(painelFiltro)}
              onChange={(e) => {
                setPainelFiltro(e.target.value === 'todos' ? 'todos' : Number(e.target.value));
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
          </div>

          <div className="flex items-center justify-between gap-2 text-sm text-abb-gray">
            <span>
              {dados.total} {dados.total === 1 ? 'registro' : 'registros'}
              {filtrando ? ' com estes filtros' : ''}
            </span>
            {filtrando ? (
              <button
                type="button"
                className="rounded-md px-2 py-1 font-semibold text-abb-red hover:bg-red-50"
                onClick={limparFiltros}
              >
                Limpar filtros
              </button>
            ) : null}
          </div>

          {dados.total === 0 && !filtrando ? (
            <div className="rounded-2xl border-2 border-dashed border-abb-line bg-white p-10 text-center">
              <p className="text-lg font-semibold">Nenhum acesso ainda</p>
              <p className="mt-2 text-base text-abb-gray">
                Os pedidos feitos na tela de login aparecem aqui. Você também pode
                liberar direto, sem esperar pedido.
              </p>
              <Botao variante="primario" className="mt-4" onClick={() => setLiberarAberto(true)}>
                Liberar o primeiro acesso
              </Botao>
            </div>
          ) : visiveis.length === 0 ? (
            <div className="rounded-2xl border border-abb-line bg-white p-8 text-center text-base text-abb-gray">
              Nada encontrado com esses filtros.
            </div>
          ) : (
            <ul className="divide-y divide-abb-line/70 overflow-hidden rounded-xl border border-abb-line bg-white shadow-sm">
              {visiveis.map((a) => (
                <LinhaAcesso
                  key={a.id}
                  acesso={a}
                  agora={agora}
                  destacado={destaque.has(a.id)}
                  onPrazo={(acao) => setPrazoAlvo({ acesso: a, acao })}
                  onEncerrar={() => setParaEncerrar(a)}
                  onApagar={() => setParaApagar(a)}
                />
              ))}
            </ul>
          )}

          <Paginacao
            pagina={dados.pagina}
            porPagina={dados.porPagina}
            total={dados.total}
            onMudar={setPagina}
          />

          <ModalLiberarAcesso
            aberto={liberarAberto}
            paineis={dados.paineis}
            agora={agora}
            onFechar={fecharLiberar}
            onLiberado={aoLiberar}
          />
        </>
      ) : null}

      <ModalPrazoAcesso alvo={prazoAlvo} agora={agora} onFechar={fecharPrazo} onSalvo={aoSalvarPrazo} />

      <Confirmacao
        aberto={paraEncerrar !== null}
        titulo={paraEncerrar?.status === 'pendente' ? 'Recusar pedido' : 'Retirar acesso'}
        mensagem={
          !paraEncerrar
            ? ''
            : paraEncerrar.status === 'pendente'
              ? `Recusar o pedido de ${paraEncerrar.usuario.nome} para ${paraEncerrar.painel.nome}?`
              : `${paraEncerrar.usuario.nome} perde agora o acesso a ${paraEncerrar.painel.nome}: o painel deixa de abrir no aparelho.\n\nO que já foi preenchido continua guardado no aparelho, e você pode reativar o acesso depois.`
        }
        textoConfirmar={paraEncerrar?.status === 'pendente' ? 'Recusar' : 'Retirar acesso'}
        onConfirmar={() => void encerrar()}
        onCancelar={cancelarEncerrar}
      />

      <Confirmacao
        aberto={paraApagar !== null}
        titulo="Excluir registro"
        mensagem={
          paraApagar
            ? `O registro do acesso de ${paraApagar.usuario.nome} a ${paraApagar.painel.nome} sai da lista.\n\n${paraApagar.usuario.nome} continua sem acesso a este painel e pode pedir de novo. O histórico guarda que o registro existiu.`
            : ''
        }
        textoConfirmar="Excluir"
        onConfirmar={() => void apagar()}
        onCancelar={cancelarApagar}
      />

      <AvisoFlutuante texto={aviso} />
    </div>
  );
}

interface PropsLinha {
  acesso: AcessoAdmin;
  agora: number;
  destacado: boolean;
  onPrazo: (acao: AcaoPrazo) => void;
  onEncerrar: () => void;
  /** Só nos encerrados: tira o registro da lista. */
  onApagar: () => void;
}

function LinhaAcesso({ acesso: a, agora, destacado, onPrazo, onEncerrar, onApagar }: PropsLinha) {
  const st = statusAgora(a, agora);
  const pilula = PILULA[st];

  // Uma linha por registro a partir de 768 px; no celular, quem e as ações em
  // cima e o painel com a validade embaixo — sempre denso, para caber muitos
  // registros sem rolar.
  return (
    <li
      className={[
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 transition-colors duration-700',
        'md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto]',
        destacado ? 'bg-green-50' : 'hover:bg-neutral-50',
      ].join(' ')}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar nome={a.usuario.nome} chave={a.usuario.email} pequeno />
        <div className="min-w-0">
          <p className="truncate text-sm leading-tight font-semibold">{a.usuario.nome}</p>
          <p className="truncate text-xs text-abb-gray">{a.usuario.email}</p>
        </div>
      </div>

      <div className="order-3 col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 md:order-none md:col-span-1">
        <span className="truncate rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-semibold">
          {a.painel.nome}
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${pilula.classe}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${pilula.ponto}`} />
          {pilula.texto}
        </span>
      </div>

      <div className="order-4 col-span-2 min-w-0 md:order-none md:col-span-1">
        <Validade acesso={a} status={st} agora={agora} />
      </div>

      <div className="order-2 flex justify-end gap-1.5 md:order-none">
        {st === 'pendente' ? (
          <>
            <Botao tamanho="compacto" variante="primario" onClick={() => onPrazo('aprovar')}>
              Aprovar
            </Botao>
            <Botao tamanho="compacto" variante="perigo" onClick={onEncerrar}>
              Recusar
            </Botao>
          </>
        ) : st === 'aprovada' ? (
          <>
            <Botao tamanho="compacto" onClick={() => onPrazo('alterar')}>
              Prazo
            </Botao>
            <Botao tamanho="compacto" variante="perigo" onClick={onEncerrar}>
              Retirar
            </Botao>
          </>
        ) : (
          <>
            <Botao tamanho="compacto" onClick={() => onPrazo('reativar')}>
              Reativar
            </Botao>
            <Botao tamanho="compacto" variante="perigo" onClick={onApagar}>
              Excluir
            </Botao>
          </>
        )}
      </div>
    </li>
  );
}

function Validade({ acesso: a, status, agora }: { acesso: AcessoAdmin; status: StatusAcesso; agora: number }) {
  const quem = a.decididoPor ? ` · por ${a.decididoPor}` : '';

  if (status === 'aprovada' && a.expiraEm !== null) {
    const restante = a.expiraEm - agora;
    const inicio = a.decididoEm ?? a.criadoEm;
    const fracao = Math.min(1, Math.max(0, restante / Math.max(1, a.expiraEm - inicio)));
    const urgente = restante <= JANELA_VENCENDO;
    return (
      <div className="min-w-0" title={`Até ${dataHoraBr(a.expiraEm)}${quem}`}>
        <p className="flex items-baseline gap-1.5 truncate text-xs">
          <span className={`font-semibold ${urgente ? 'text-amber-800' : 'text-abb-black'}`}>
            Faltam {duracaoCurta(restante)}
          </span>
          <span className="truncate text-abb-gray">até {dataHoraBr(a.expiraEm)}</span>
        </p>
        <div
          className="mt-1 h-1 w-full max-w-52 overflow-hidden rounded-full bg-neutral-100"
          role="progressbar"
          aria-label="Tempo restante do acesso"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fracao * 100)}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-700 ${urgente ? 'bg-amber-500' : 'bg-green-500'}`}
            style={{ width: `${fracao * 100}%` }}
          />
        </div>
      </div>
    );
  }

  if (status === 'aprovada') {
    return (
      <p
        className="flex items-center gap-1.5 truncate text-xs"
        title={`Desde ${dataHoraBr(a.decididoEm ?? a.criadoEm)}${quem}`}
      >
        <IconeInfinito className="h-4 w-4 shrink-0 text-abb-gray" />
        <span className="font-semibold">Sem prazo</span>
        <span className="truncate text-abb-gray">
          desde {dataBr(a.decididoEm ?? a.criadoEm)}
          {quem}
        </span>
      </p>
    );
  }

  if (status === 'pendente') {
    return (
      <p className="truncate text-xs" title={a.mensagem ?? undefined}>
        Pediu em {dataHoraBr(a.criadoEm)}
        {a.mensagem ? <span className="text-abb-gray"> · “{a.mensagem}”</span> : null}
      </p>
    );
  }

  const quando =
    status === 'expirada'
      ? `Venceu em ${dataHoraBr(a.expiraEm ?? undefined)}`
      : `${status === 'revogada' ? 'Retirado' : 'Recusado'} em ${dataHoraBr(a.decididoEm ?? undefined)}`;
  return (
    <p className="truncate text-xs text-abb-gray">
      {quando}
      {status !== 'expirada' && a.decididoPor ? ` · por ${a.decididoPor}` : ''}
    </p>
  );
}
