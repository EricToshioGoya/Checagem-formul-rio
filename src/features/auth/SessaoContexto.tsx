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
  acessosDoEmail,
  emailValido,
  normalizarEmail,
  type AcessoAoPainel,
} from '../../core/auth/acesso';
import { gravarSessao, limparSessao, lerSessao } from '../../core/auth/sessao';

interface ValorSessao {
  /** E-mail em sessão, ou `null` quando ninguém está autenticado. */
  email: string | null;
  /** Painéis liberados para o e-mail em sessão, com o papel em cada um. */
  acessos: AcessoAoPainel[];
  /** Verdadeiro enquanto a sessão gravada é revalidada contra o catálogo. */
  carregando: boolean;
  entrar: (email: string) => Promise<void>;
  sair: () => void;
}

const Contexto = createContext<ValorSessao | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [acessos, setAcessos] = useState<AcessoAoPainel[]>([]);
  const [carregando, setCarregando] = useState(true);

  // A sessão gravada é revalidada a cada abertura: se o catálogo tirou o
  // acesso do e-mail, o usuário volta para a tela de login.
  useEffect(() => {
    let ativo = true;
    (async () => {
      const sessao = lerSessao();
      if (!sessao) {
        if (ativo) setCarregando(false);
        return;
      }
      try {
        const encontrados = await acessosDoEmail(sessao.email);
        if (!ativo) return;
        if (encontrados.length) {
          setEmail(sessao.email);
          setAcessos(encontrados);
        } else {
          limparSessao();
        }
      } catch {
        // Catálogo indisponível: mantém a sessão e deixa a tela tratar o erro.
        if (ativo) setEmail(sessao.email);
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  const entrar = useCallback(async (informado: string) => {
    const alvo = normalizarEmail(informado);
    if (!emailValido(alvo)) throw new Error('Informe um e-mail válido.');
    const encontrados = await acessosDoEmail(alvo);
    if (!encontrados.length) {
      throw new Error(
        'Este e-mail não está liberado em nenhum painel. Peça a liberação ao administrador do painel.',
      );
    }
    gravarSessao(alvo);
    setEmail(alvo);
    setAcessos(encontrados);
  }, []);

  const sair = useCallback(() => {
    limparSessao();
    setEmail(null);
    setAcessos([]);
  }, []);

  const valor = useMemo<ValorSessao>(
    () => ({ email, acessos, carregando, entrar, sair }),
    [email, acessos, carregando, entrar, sair],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): ValorSessao {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useSessao exige <SessaoProvider> acima na árvore.');
  return valor;
}
