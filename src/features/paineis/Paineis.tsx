import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ErroApi, type AcessoPainel, type PainelApi } from '../../core/api/cliente';
import { useSessao } from '../../core/api/SessaoContexto';
import { guardarAcessos } from '../../core/api/acessoLocal';
import { ProjetoRepository } from '../../core/db/repositorios';
import { sincronizarPaineis } from '../../core/forms/catalogo';
import { carregarCatalogoPaineis } from '../../core/paineis/catalogo';
import type { FluxoPainel } from '../../core/paineis/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';
import { dataHoraBr, duracaoCurta } from '../../shared/utils/texto';

const rotulos: Record<AcessoPainel, { texto: string; classe: string }> = {
  dono: { texto: 'Você é o responsável', classe: 'bg-abb-red text-white' },
  aprovada: { texto: 'Acesso aprovado', classe: 'bg-green-100 text-green-800' },
  pendente: { texto: 'Aguardando aprovação', classe: 'bg-amber-100 text-amber-900' },
  recusada: { texto: 'Acesso recusado', classe: 'bg-neutral-200 text-abb-gray' },
  expirada: { texto: 'Acesso expirado', classe: 'bg-neutral-200 text-abb-gray' },
  revogada: { texto: 'Acesso retirado', classe: 'bg-neutral-200 text-abb-gray' },
  nenhum: { texto: 'Sem acesso', classe: 'bg-neutral-100 text-abb-gray' },
};

/**
 * Os quatro painéis, com a situação do acesso em cada um.
 *
 * Quem decide é o servidor: `podePreencher` vem dele, painel por painel. Uma
 * aprovação em SEN Plus não abre MNS.
 */
export function Paineis() {
  const { usuario } = useSessao();
  const navegar = useNavigate();
  const [parametros, setParametros] = useSearchParams();

  const [paineis, setPaineis] = useState<PainelApi[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Sem rede, ou servidor fora do ar: a lista de painéis não vem. */
  const [semConexao, setSemConexao] = useState(false);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const pedidoAutomatico = useRef(false);
  /**
   * Fluxo de cada painel, pelo `slug`. Painel sem entrada no catálogo — todo
   * painel novo da administração — é de verificação.
   */
  const [fluxos, setFluxos] = useState<Record<string, FluxoPainel>>({});

  useEffect(() => {
    carregarCatalogoPaineis()
      .then((c) => setFluxos(Object.fromEntries(c.paineis.map((p) => [p.id, p.fluxo]))))
      .catch(() => {
        // Sem o catálogo, todos abrem como verificação; a certificação volta
        // a aparecer quando o arquivo puder ser lido.
      });
  }, []);

  const carregar = useCallback(async () => {
    try {
      const { paineis: lista } = await api.get<{ paineis: PainelApi[] }>('/api/paineis');
      setPaineis(lista);
      setErro(null);
      setSemConexao(false);
      // Guarda a situação de cada painel para conferir o acesso sem rede.
      if (usuario) guardarAcessos(usuario.id, lista);
      // Esta tela é o momento em que há rede garantida — é aqui que o aparelho
      // baixa os checklists dos painéis liberados, para o montador preencher
      // depois dentro do galpão, sem conexão.
      void sincronizarPaineis(lista);
      return lista;
    } catch (e) {
      if (e instanceof ErroApi && (e.semRede || e.status >= 500)) setSemConexao(true);
      else setErro(e instanceof Error ? e.message : 'Não foi possível ler os painéis.');
      return null;
    }
  }, [usuario]);

  const solicitar = useCallback(
    async (painelId: number) => {
      setOcupado(painelId);
      try {
        await api.post(`/api/paineis/${painelId}/solicitacoes`, {});
        await carregar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível enviar a solicitação.');
      } finally {
        setOcupado(null);
      }
    },
    [carregar],
  );

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * Painel escolhido na tela de login: o pedido sai sozinho, uma vez só.
   * Se a pessoa já for responsável ou já tiver pedido, o servidor recusa e o
   * cartão simplesmente mostra a situação real.
   */
  useEffect(() => {
    const escolhido = parametros.get('escolhido');
    if (!escolhido || !paineis || pedidoAutomatico.current) return;
    pedidoAutomatico.current = true;
    setParametros({}, { replace: true });

    const painel = paineis.find((p) => String(p.id) === escolhido);
    if (painel && painel.meuAcesso === 'nenhum') void solicitar(painel.id);
  }, [parametros, paineis, setParametros, solicitar]);

  /**
   * Abre o painel aprovado. O projeto local nasce na primeira abertura,
   * amarrado ao painel e ao usuário; reabrir cai no mesmo.
   */
  const abrir = async (painel: PainelApi) => {
    if (!usuario) return;
    // Na certificação não há projeto: cada painel/quadro é uma solicitação.
    if (fluxos[painel.slug] === 'certificacao') {
      navegar(`/paineis/${painel.slug}/solicitacoes`);
      return;
    }
    setOcupado(painel.id);
    try {
      const id = await ProjetoRepository.obterOuCriarPorPainel(usuario.id, painel.id, {
        // A empresa é do montador, e só ele sabe: fica em branco até ele
        // informar na tela do projeto. Antes ia o e-mail do responsável.
        empresa: '',
        nomeProjeto: painel.nome,
        operador: usuario.nome,
        painelSlug: painel.slug,
        // O painel é o tipo (SEN Plus, MNS…), não uma TAG: o projeto nasce
        // vazio e as checagens aparecem quando o montador cadastra as TAGs.
        tags: [],
      });
      navegar(`/projetos/${id}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir o painel.');
      setOcupado(null);
    }
  };

  if (!paineis && !erro && !semConexao) return <Carregando mensagem="Lendo os painéis…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Escolha o painel</h1>
          <p className="mt-1 text-base text-abb-gray">
            Você preenche as checagens apenas dos painéis em que o responsável
            aprovou o seu acesso.
          </p>
        </div>
        {/* A tela de projetos é também onde se importa um projeto de outro
            aparelho — antes não havia caminho até ela. */}
        <Link
          to="/projetos"
          className="rounded-md px-1 text-sm font-semibold text-abb-red hover:underline"
        >
          Projetos neste aparelho →
        </Link>
      </div>

      {semConexao ? (
        <Aviso>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Sem conexão com o servidor. Os painéis que você já abriu neste
              aparelho continuam disponíveis.
            </span>
            <Botao tamanho="compacto" onClick={() => navegar('/projetos')}>
              Abrir projetos
            </Botao>
          </span>
        </Aviso>
      ) : null}

      {erro ? <Erro detalhe={erro} /> : null}

      <ul className="space-y-3">
        {paineis?.map((p) => {
          const rotulo = rotulos[p.meuAcesso];
          const trabalhando = ocupado === p.id;
          const vazio = p.formularios === 0;
          return (
            <li
              key={p.id}
              className="rounded-lg border border-abb-line bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-bold">{p.nome}</p>
                  <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
                    {fluxos[p.slug] === 'certificacao'
                      ? 'Solicitação de certificação'
                      : 'Verificação de montagem'}
                  </p>
                  <p className="mt-1 text-sm text-abb-gray">
                    {p.responsaveis.length === 1 ? 'Responsável' : 'Responsáveis'}:{' '}
                    {p.responsaveis.join(', ') || '—'}
                  </p>
                  {p.acessoExpiraEm !== null && p.meuAcesso === 'aprovada' ? (
                    <p className="mt-1 text-sm font-semibold text-amber-800">
                      Acesso liberado até {dataHoraBr(p.acessoExpiraEm)} (faltam{' '}
                      {duracaoCurta(p.acessoExpiraEm - Date.now())})
                    </p>
                  ) : null}
                  {p.acessoExpiraEm !== null && p.meuAcesso === 'expirada' ? (
                    <p className="mt-1 text-sm text-abb-gray">
                      O acesso venceu em {dataHoraBr(p.acessoExpiraEm)}.
                    </p>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-1 text-sm font-semibold ${rotulo.classe}`}
                >
                  {rotulo.texto}
                </span>
              </div>

              {vazio ? (
                <div className="mt-3">
                  <Aviso>
                    O checklist desta linha ainda está em branco. O painel abre
                    sem verificações até que a administração monte as etapas.
                  </Aviso>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {p.podePreencher ? (
                  <Botao variante="primario" disabled={trabalhando} onClick={() => abrir(p)}>
                    {trabalhando
                      ? 'Abrindo…'
                      : fluxos[p.slug] === 'certificacao'
                        ? 'Abrir solicitações'
                        : 'Abrir checagens'}
                  </Botao>
                ) : p.meuAcesso === 'pendente' ? (
                  <p className="text-base text-abb-gray">
                    Pedido enviado. Assim que{' '}
                    {p.responsaveis.length === 1
                      ? 'o responsável aprovar'
                      : 'qualquer um dos responsáveis aprovar'}
                    , o painel abre aqui.
                  </p>
                ) : (
                  <Botao disabled={trabalhando} onClick={() => solicitar(p.id)}>
                    {trabalhando
                      ? 'Enviando…'
                      : p.meuAcesso === 'nenhum'
                        ? 'Solicitar acesso'
                        : 'Pedir acesso de novo'}
                  </Botao>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
