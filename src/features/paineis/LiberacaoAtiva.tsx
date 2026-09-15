import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AcessoApi,
  ErroApi,
  ServidorIndisponivel,
  type SolicitacaoAcesso,
  type StatusAcesso,
} from '../../core/acesso/api';
import {
  apagarSessao,
  gravarSessao,
  lerSessao,
  type SessaoLiberacao,
} from '../../core/acesso/sessao';
import { INTERVALO_CONSULTA_ACESSO_MS } from '../../core/config';
import { usePainelAtivo } from './PainelAtivo';

/**
 * Liberação de acesso do painel em uso.
 *
 * Nos painéis marcados com `exigirLiberacao`, o e-mail informado vira um
 * pedido no servidor e nada abre até a administração decidir. A decisão é
 * tomada em outro aparelho, então ela não pode viver no armazenamento local:
 * aqui fica só a última situação conhecida, que é o que mantém o
 * preenchimento de pé quando a rede cai.
 */

type Situacao = 'sem-pedido' | StatusAcesso;

interface ValorLiberacao {
  /** O painel em uso exige liberação? */
  exigida: boolean;
  situacao: Situacao;
  sessao: SessaoLiberacao | null;
  /** Exige liberação e ainda não foi liberado. */
  bloqueado: boolean;
  semServidor: boolean;
  consultando: boolean;
  pedir: (email: string) => Promise<SolicitacaoAcesso>;
  revalidar: () => Promise<void>;
  desistir: () => void;
}

const Contexto = createContext<ValorLiberacao | null>(null);

export function useLiberacao(): ValorLiberacao {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useLiberacao precisa estar dentro de <LiberacaoProvider>.');
  return valor;
}

export function LiberacaoProvider({ children }: { children: ReactNode }) {
  const { painel, permissao } = usePainelAtivo();
  const painelId = painel?.id ?? null;
  const exigida = permissao.exigirLiberacao === true;

  const [sessao, setSessao] = useState<SessaoLiberacao | null>(null);
  const [semServidor, setSemServidor] = useState(false);
  const [consultando, setConsultando] = useState(false);

  // Trocar de painel troca o pedido: cada painel tem a sua fila.
  useEffect(() => {
    setSessao(painelId ? lerSessao(painelId) : null);
    setSemServidor(false);
  }, [painelId]);

  const revalidar = useCallback(async () => {
    if (!painelId) return;
    const atual = lerSessao(painelId);
    if (!atual) {
      setSessao(null);
      return;
    }
    setConsultando(true);
    try {
      const solicitacao = await AcessoApi.situacao(atual.token);
      setSessao(gravarSessao(painelId, atual.token, solicitacao));
      setSemServidor(false);
    } catch (e) {
      if (e instanceof ServidorIndisponivel) {
        // Mantém a última situação conhecida: liberado continua liberado.
        setSemServidor(true);
      } else if (e instanceof ErroApi && e.codigo === 404) {
        apagarSessao(painelId);
        setSessao(null);
      }
    } finally {
      setConsultando(false);
    }
  }, [painelId]);

  const pedir = useCallback(
    async (email: string) => {
      if (!painel) throw new Error('Escolha um painel antes de pedir liberação.');
      const { token, solicitacao } = await AcessoApi.solicitar(email, painel.id, painel.nome);
      setSessao(gravarSessao(painel.id, token, solicitacao));
      setSemServidor(false);
      return solicitacao;
    },
    [painel],
  );

  const desistir = useCallback(() => {
    if (!painelId) return;
    apagarSessao(painelId);
    setSessao(null);
  }, [painelId]);

  const situacao: Situacao = sessao?.status ?? 'sem-pedido';

  // Enquanto o pedido não é decidido, a tela de espera se atualiza sozinha.
  useEffect(() => {
    if (!exigida || !painelId) return;
    if (situacao !== 'pendente' && situacao !== 'negado') return;
    void revalidar();
    const id = window.setInterval(() => void revalidar(), INTERVALO_CONSULTA_ACESSO_MS);
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void revalidar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('online', aoVoltar);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('online', aoVoltar);
    };
  }, [exigida, painelId, situacao, revalidar]);

  // Já liberado, a conferência acontece ao abrir e toda vez que o montador
  // volta ao aplicativo ou a rede retorna — é o que faz a revogação chegar ao
  // aparelho dele sem precisar de recarga.
  useEffect(() => {
    if (!exigida || situacao !== 'liberado') return;
    void revalidar();
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void revalidar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    window.addEventListener('online', aoVoltar);
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
      window.removeEventListener('online', aoVoltar);
    };
  }, [exigida, painelId, situacao, revalidar]);

  const valor = useMemo<ValorLiberacao>(
    () => ({
      exigida,
      situacao,
      sessao,
      bloqueado: exigida && situacao !== 'liberado',
      semServidor,
      consultando,
      pedir,
      revalidar,
      desistir,
    }),
    [exigida, situacao, sessao, semServidor, consultando, pedir, revalidar, desistir],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
