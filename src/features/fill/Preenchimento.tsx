import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  MidiaRepository,
  PreenchimentoRepository,
  ProjetoRepository,
} from '../../core/db/repositorios';
import { carregarFormulario } from '../../core/forms/catalogo';
import { temAcessoAoFormulario } from '../../core/auth/acesso';
import { useSessao } from '../auth/SessaoContexto';
import { calcularProgresso, etapaRespondida } from '../../core/forms/progresso';
import type {
  DefinicaoFormulario,
  Etapa,
  MapaRespostas,
  ValorResposta,
  ValoresCabecalho,
} from '../../core/forms/tipos';
import type { Projeto, Tag } from '../../core/db/tipos';
import { useSalvamentoAutomatico } from '../../shared/hooks/useSalvamentoAutomatico';
import { useDesktop } from '../../shared/hooks/useMediaQuery';
import { Botao } from '../../shared/componentes/Botao';
import { BarraProgresso } from '../../shared/componentes/BarraProgresso';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { Modal } from '../../shared/componentes/Modal';
import { IconeCheck, IconeVoltar } from '../../shared/componentes/Icones';
import { EtapaCard } from './EtapaCard';
import { ModalApoio } from './ModalApoio';
import { CabecalhoFormulario } from './CabecalhoFormulario';

const ID_CABECALHO = '__cabecalho__';
type Filtro = 'todas' | 'respondidas' | 'pendentes';

interface Contexto {
  projeto: Projeto;
  tag: Tag;
  definicao: DefinicaoFormulario;
  preenchimentoId: number;
}

export function Preenchimento() {
  const { projetoId, tagId, formId } = useParams();
  const navegar = useNavigate();
  const desktop = useDesktop();
  const { acessos } = useSessao();

  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [respostas, setRespostas] = useState<MapaRespostas>({});
  const [cabecalho, setCabecalho] = useState<ValoresCabecalho>({});
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [selecionada, setSelecionada] = useState<string>(ID_CABECALHO);
  const [ajuda, setAjuda] = useState<Etapa | null>(null);
  const [indiceAberto, setIndiceAberto] = useState(false);

  /** Trocar de etapa recomeça a leitura pelo topo do cartão. */
  const selecionar = useCallback((id: string) => {
    setSelecionada(id);
    window.scrollTo({ top: 0 });
  }, []);

  const preenchimentoId = contexto?.preenchimentoId ?? 0;

  const fotos = useLiveQuery(
    async (): Promise<Record<string, number>> =>
      preenchimentoId ? MidiaRepository.mapaContagem(preenchimentoId) : {},
    [preenchimentoId],
    {} as Record<string, number>,
  );

  const salvamentoRespostas = useSalvamentoAutomatico<MapaRespostas>(async (valor) => {
    if (!contexto) return;
    await PreenchimentoRepository.substituirRespostas(contexto.preenchimentoId, valor);
    await ProjetoRepository.marcarAlteracao(contexto.projeto.id!);
  });

  const salvamentoCabecalho = useSalvamentoAutomatico<ValoresCabecalho>(async (valor) => {
    if (!contexto) return;
    await PreenchimentoRepository.salvarCabecalho(contexto.preenchimentoId, valor);
    await ProjetoRepository.marcarAlteracao(contexto.projeto.id!);
  });

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const idProjeto = Number(projetoId);
        const idTag = Number(tagId);
        const [projeto, tag] = await Promise.all([
          ProjetoRepository.obter(idProjeto),
          ProjetoRepository.obterTag(idTag),
        ]);
        if (!projeto || !tag) throw new Error('Projeto ou TAG não encontrados.');
        // Barra, no acesso por URL, o formulário sem liberação do
        // administrador ou que não pertence ao painel do projeto.
        if (!temAcessoAoFormulario(acessos, String(formId))) {
          throw new Error(
            'Este formulário não está liberado para o seu e-mail. Peça a liberação ao administrador do painel.',
          );
        }
        const entrada = acessos.find((a) => a.entrada.id === formId)?.entrada;
        if (projeto.painel && entrada && entrada.linhaProduto !== projeto.painel) {
          throw new Error(
            `Este formulário é do painel ${entrada.linhaProduto}, e o projeto é do painel ${projeto.painel}.`,
          );
        }
        const definicao = await carregarFormulario(String(formId));
        const preenchimento = await PreenchimentoRepository.obterOuCriar(
          idTag,
          definicao.id,
          definicao.revisao,
        );
        if (!ativo) return;
        setContexto({ projeto, tag, definicao, preenchimentoId: preenchimento.id });
        setRespostas(preenchimento.respostas ?? {});
        // O cabeçalho começa com os dados já conhecidos do projeto.
        setCabecalho({
          numeroPedido: projeto.numeroPedido ?? '',
          ...(preenchimento.cabecalho ?? {}),
        });
      } catch (e) {
        if (ativo) setErro(e instanceof Error ? e.message : 'Falha ao abrir o formulário.');
      }
    })();
    return () => {
      ativo = false;
    };
  }, [projetoId, tagId, formId, acessos]);

  const etapas = useMemo(
    () =>
      contexto
        ? contexto.definicao.secoes.flatMap((s) =>
            s.etapas.filter((e) => e.ativa !== false).map((e) => ({ etapa: e, secao: s })),
          )
        : [],
    [contexto],
  );

  const estaRespondida = useCallback(
    (etapa: Etapa) => etapaRespondida(etapa, respostas[etapa.id], fotos?.[etapa.id] ?? 0),
    [respostas, fotos],
  );

  const visiveis = useMemo(
    () =>
      etapas.filter(({ etapa }) => {
        if (filtro === 'todas') return true;
        const ok = estaRespondida(etapa);
        return filtro === 'respondidas' ? ok : !ok;
      }),
    [etapas, filtro, estaRespondida],
  );

  const progresso = useMemo(
    () =>
      contexto
        ? calcularProgresso(contexto.definicao, respostas, fotos ?? {})
        : { total: 0, respondidas: 0, pendentes: 0, percentual: 0 },
    [contexto, respostas, fotos],
  );

  const alterarValor = (etapaId: string, valor: ValorResposta | null) => {
    setRespostas((atual) => {
      const proximo = { ...atual };
      const anterior = proximo[etapaId];
      if (valor === null && !anterior?.observacao) delete proximo[etapaId];
      else proximo[etapaId] = { ...anterior, valor: valor as ValorResposta };
      salvamentoRespostas.agendar(proximo);
      return proximo;
    });
  };

  const alterarObservacao = (etapaId: string, texto: string) => {
    setRespostas((atual) => {
      const proximo = { ...atual };
      const anterior = proximo[etapaId];
      if (!texto && (anterior === undefined || anterior.valor === null)) delete proximo[etapaId];
      else proximo[etapaId] = { valor: anterior?.valor ?? null, observacao: texto };
      salvamentoRespostas.agendar(proximo);
      return proximo;
    });
  };

  const alterarCabecalho = (campoId: string, valor: string) => {
    setCabecalho((atual) => {
      const proximo = { ...atual, [campoId]: valor };
      salvamentoCabecalho.agendar(proximo);
      return proximo;
    });
  };

  const sair = async () => {
    await Promise.all([salvamentoRespostas.descarregar(), salvamentoCabecalho.descarregar()]);
    navegar(`/projetos/${projetoId}`);
  };

  if (erro) return <div className="p-4"><Erro detalhe={erro} /></div>;
  if (!contexto) return <Carregando mensagem="Abrindo o formulário…" />;

  const indiceAtual = visiveis.findIndex((v) => v.etapa.id === selecionada);
  const etapaAtual = indiceAtual >= 0 ? visiveis[indiceAtual] : null;

  const estadoSalvamento =
    salvamentoRespostas.estado === 'erro' || salvamentoCabecalho.estado === 'erro'
      ? 'erro'
      : salvamentoRespostas.estado === 'salvando' || salvamentoCabecalho.estado === 'salvando'
        ? 'salvando'
        : salvamentoRespostas.estado === 'pendente' || salvamentoCabecalho.estado === 'pendente'
          ? 'pendente'
          : 'salvo';

  const indice = (
    <nav aria-label="Etapas do formulário" className="space-y-4">
      <button
        type="button"
        onClick={() => {
          selecionar(ID_CABECALHO);
          setIndiceAberto(false);
        }}
        className={[
          'flex min-h-12 w-full items-center rounded-md border-2 px-3 text-left text-base font-semibold',
          selecionada === ID_CABECALHO
            ? 'border-abb-red bg-red-50'
            : 'border-abb-line bg-white',
        ].join(' ')}
      >
        Dados do painel
      </button>

      {contexto.definicao.secoes.map((secao) => {
        const daSecao = visiveis.filter((v) => v.secao.id === secao.id);
        if (daSecao.length === 0) return null;
        return (
          <div key={secao.id}>
            <h2 className="mb-2 border-b-2 border-abb-red pb-1 text-base font-bold">
              {secao.titulo}
            </h2>
            <ul className="space-y-1">
              {daSecao.map(({ etapa }) => {
                const ok = estaRespondida(etapa);
                return (
                  <li key={etapa.id}>
                    <button
                      type="button"
                      onClick={() => {
                        selecionar(etapa.id);
                        setIndiceAberto(false);
                      }}
                      className={[
                        'flex min-h-12 w-full items-start gap-2 rounded-md border px-3 py-2 text-left',
                        selecionada === etapa.id
                          ? 'border-abb-red bg-red-50'
                          : 'border-abb-line bg-white',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 text-xs',
                          ok
                            ? 'border-green-700 bg-green-700 text-white'
                            : 'border-abb-gray bg-white',
                        ].join(' ')}
                        aria-hidden="true"
                      >
                        {ok ? <IconeCheck className="h-4 w-4" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold">{etapa.id}</span>
                        <span className="block truncate text-sm text-abb-gray">
                          {etapa.descricao}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const painel =
    selecionada === ID_CABECALHO ? (
      <CabecalhoFormulario
        definicao={contexto.definicao}
        valores={cabecalho}
        onChange={alterarCabecalho}
      />
    ) : etapaAtual ? (
      <EtapaCard
        etapa={etapaAtual.etapa}
        resposta={respostas[etapaAtual.etapa.id]}
        respondida={estaRespondida(etapaAtual.etapa)}
        preenchimentoId={contexto.preenchimentoId}
        onAlterarValor={(v) => alterarValor(etapaAtual.etapa.id, v)}
        onAlterarObservacao={(t) => alterarObservacao(etapaAtual.etapa.id, t)}
        onAbrirAjuda={() => setAjuda(etapaAtual.etapa)}
        onFotosAlteradas={() => ProjetoRepository.marcarAlteracao(contexto.projeto.id!)}
      />
    ) : (
      <p className="rounded-lg border border-abb-line bg-white p-6 text-center text-base text-abb-gray">
        Nenhuma etapa neste filtro.
      </p>
    );

  return (
    <div className="min-h-dvh bg-abb-bg">
      <header className="sticky top-0 z-30 border-b border-abb-line bg-white shadow-sm">
        <div className="mx-auto max-w-6xl space-y-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <Botao variante="texto" onClick={sair} aria-label="Voltar ao projeto">
              <IconeVoltar />
            </Botao>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold">
                {contexto.tag.nome} — {contexto.definicao.tipo === 'montagem' ? 'Montagem' : 'Rotina'}
              </p>
              <p className="hidden truncate text-sm text-abb-gray sm:block">
                {contexto.definicao.nome} • {contexto.definicao.revisao}
              </p>
            </div>
            <span
              className={[
                'shrink-0 rounded px-2 py-1 text-sm font-semibold',
                estadoSalvamento === 'erro'
                  ? 'bg-red-100 text-abb-red'
                  : estadoSalvamento === 'salvo'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-neutral-100 text-abb-gray',
              ].join(' ')}
              role="status"
            >
              {estadoSalvamento === 'erro'
                ? 'Falha ao salvar'
                : estadoSalvamento === 'salvo'
                  ? 'Salvo'
                  : 'Salvando…'}
            </span>
          </div>

          <BarraProgresso
            percentual={progresso.percentual}
            rotulo={`${progresso.respondidas}/${progresso.total} etapas`}
            compacta
          />

          {/* Uma única linha no celular: o cabeçalho fixo não pode roubar a
              tela da etapa que está sendo respondida. */}
          <div className="flex items-center gap-2">
            <div className="flex flex-1 gap-2 overflow-x-auto">
              {(['todas', 'pendentes', 'respondidas'] as Filtro[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFiltro(f)}
                  aria-pressed={filtro === f}
                  className={[
                    'min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold capitalize sm:px-4',
                    filtro === f
                      ? 'border-abb-red bg-abb-red text-white'
                      : 'border-abb-line bg-white text-abb-black',
                  ].join(' ')}
                >
                  {f}
                </button>
              ))}
            </div>
            {!desktop ? (
              <Botao className="shrink-0 px-3" onClick={() => setIndiceAberto(true)}>
                Índice
              </Botao>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-3 py-4">
        {desktop ? (
          <div className="grid grid-cols-[20rem_1fr] gap-4">
            <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto pr-1">{indice}</div>
            <div>{painel}</div>
          </div>
        ) : (
          <div className="space-y-4">
            {painel}
            {selecionada !== ID_CABECALHO && visiveis.length > 0 ? (
              <div className="flex items-center justify-between gap-2">
                <Botao
                  disabled={indiceAtual <= 0}
                  onClick={() => selecionar(visiveis[indiceAtual - 1].etapa.id)}
                >
                  Anterior
                </Botao>
                <span className="text-sm text-abb-gray">
                  {indiceAtual + 1} de {visiveis.length}
                </span>
                <Botao
                  variante="primario"
                  disabled={indiceAtual < 0 || indiceAtual >= visiveis.length - 1}
                  onClick={() => selecionar(visiveis[indiceAtual + 1].etapa.id)}
                >
                  Próxima
                </Botao>
              </div>
            ) : null}
            {selecionada === ID_CABECALHO && visiveis.length > 0 ? (
              <Botao
                variante="primario"
                larguraTotal
                onClick={() => selecionar(visiveis[0].etapa.id)}
              >
                Começar pelas etapas
              </Botao>
            ) : null}
          </div>
        )}
      </div>

      <Modal
        aberto={indiceAberto && !desktop}
        titulo="Etapas do formulário"
        onFechar={() => setIndiceAberto(false)}
      >
        {indice}
      </Modal>

      <ModalApoio etapa={ajuda} onFechar={() => setAjuda(null)} />
    </div>
  );
}
