/**
 * Estado de autorização do aplicativo.
 *
 * A regra que orienta o desenho: falta de rede nunca bloqueia quem já foi
 * autorizado. A credencial guardada no aparelho é conferida offline e vale
 * por si; a revalidação contra o servidor acontece em segundo plano, e só
 * derruba o acesso quando o servidor responde que ele foi revogado.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AUTORIZACAO_DESLIGADA } from '../config';
import { SessaoRepository } from '../db/repositorios';
import { AutorizacaoApi, ErroApi } from './api';
import { verificarCredencial } from './credencial';
import type { Claims } from './tipos';

interface Sessao {
  claims: Claims;
  credencial: string;
}

interface ContextoAutorizacao {
  /** Nulo enquanto a leitura do aparelho não terminou. */
  carregando: boolean;
  sessao: Sessao | null;
  deviceId: string;
  /** Guarda a credencial recém-recebida e libera o aplicativo. */
  entrar: (credencial: string) => Promise<void>;
  /** Descarta a credencial deste aparelho. */
  sair: () => Promise<void>;
  /** Mensagem quando o servidor derrubou o acesso, para explicar o bloqueio. */
  motivoSaida: string | null;
}

const Contexto = createContext<ContextoAutorizacao | null>(null);

/**
 * Sessão usada quando a autorização está desligada. Não vem de credencial
 * assinada nenhuma: serve só para as telas terem os campos que esperam.
 */
const SESSAO_DESENVOLVIMENTO: Sessao = {
  credencial: '',
  claims: {
    sub: 'desenvolvimento',
    email: 'desenvolvimento@local',
    painelId: 'desenvolvimento',
    painelNome: 'Autorização desligada',
    deviceId: 'desenvolvimento',
    papel: 'montador',
    iat: 0,
    // Longe o bastante para a faixa de validade não aparecer no caminho.
    exp: Math.floor(Date.now() / 1000) + 365 * 86_400,
  },
};

export function ProvedorAutorizacao({ children }: { children: ReactNode }) {
  const [carregando, setCarregando] = useState(true);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [motivoSaida, setMotivoSaida] = useState<string | null>(null);

  // Evita revalidar a mesma credencial em paralelo quando a rede oscila.
  const revalidando = useRef(false);

  /**
   * Contador de sessões. Sobe a cada encerramento, para que uma revalidação
   * que já estava em voo não ressuscite o acesso que o usuário acabou de
   * encerrar — a resposta chega depois do clique, e sem isto ela venceria.
   */
  const geracao = useRef(0);

  const aplicar = useCallback(async (credencial: string, geracaoOrigem?: number) => {
    const claims = await verificarCredencial(credencial);
    if (!claims) return false;
    // A sessão foi encerrada enquanto esta resposta vinha: descarta.
    if (geracaoOrigem !== undefined && geracaoOrigem !== geracao.current) return false;

    await SessaoRepository.guardarCredencial(credencial);
    setSessao({ claims, credencial });
    setMotivoSaida(null);
    return true;
  }, []);

  const encerrar = useCallback(async (motivo: string | null) => {
    geracao.current += 1;
    await SessaoRepository.descartarCredencial();
    setSessao(null);
    setMotivoSaida(motivo);
  }, []);

  // Leitura inicial: é o que decide se a primeira tela é o bloqueio ou a
  // lista de projetos.
  useEffect(() => {
    let ativo = true;

    if (AUTORIZACAO_DESLIGADA) {
      setSessao(SESSAO_DESENVOLVIMENTO);
      setCarregando(false);
      return;
    }

    void (async () => {
      try {
        const [dispositivo, credencial] = await Promise.all([
          SessaoRepository.dispositivo(),
          SessaoRepository.credencial(),
        ]);
        if (!ativo) return;
        setDeviceId(dispositivo);

        if (credencial) {
          const claims = await verificarCredencial(credencial);
          if (!ativo) return;
          if (claims) {
            setSessao({ claims, credencial });
          } else {
            // Assinatura inválida ou prazo vencido: o aparelho precisa
            // pedir acesso de novo.
            await SessaoRepository.descartarCredencial();
          }
        }
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, []);

  /**
   * Revalidação em segundo plano: renova o prazo e é o caminho pelo qual
   * uma revogação feita pelo responsável alcança o aparelho.
   */
  const revalidar = useCallback(async () => {
    if (AUTORIZACAO_DESLIGADA) return;
    if (!sessao || revalidando.current || !navigator.onLine) return;
    revalidando.current = true;
    const minhaGeracao = geracao.current;

    try {
      const renovada = await AutorizacaoApi.revalidar(sessao.credencial);
      await aplicar(renovada, minhaGeracao);
    } catch (erro) {
      if (
        minhaGeracao === geracao.current &&
        erro instanceof ErroApi &&
        !erro.semRede &&
        erro.status !== 500
      ) {
        // O servidor respondeu que esta credencial não vale mais. Só neste
        // caso o acesso cai — sem rede, o aparelho continua trabalhando.
        await encerrar(erro.message);
      }
    } finally {
      revalidando.current = false;
    }
  }, [sessao, aplicar, encerrar]);

  useEffect(() => {
    if (!sessao) return;

    void revalidar();
    // A volta da conexão é o momento certo para checar revogação: é quando
    // o aparelho sai da obra e reencontra a rede.
    window.addEventListener('online', revalidar);
    return () => window.removeEventListener('online', revalidar);
  }, [sessao, revalidar]);

  const valor = useMemo<ContextoAutorizacao>(
    () => ({
      carregando,
      sessao,
      deviceId,
      entrar: async (credencial) => {
        await aplicar(credencial);
      },
      sair: () => encerrar(null),
      motivoSaida,
    }),
    [carregando, sessao, deviceId, aplicar, encerrar, motivoSaida],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAutorizacao(): ContextoAutorizacao {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error('useAutorizacao exige ProvedorAutorizacao acima na árvore.');
  }
  return contexto;
}
