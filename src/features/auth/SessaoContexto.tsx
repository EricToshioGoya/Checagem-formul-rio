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
  paineisAcessiveis,
  type AcessoAoPainel,
  type PainelAcessivel,
} from '../../core/auth/acesso';
import {
  gravarPainel,
  gravarSessao,
  lerPainel,
  lerSessao,
  limparPainel,
  limparSessao,
} from '../../core/auth/sessao';

interface ValorSessao {
  /** E-mail em sessão, ou `null` quando ninguém está autenticado. */
  email: string | null;
  /** Formulários liberados para o e-mail em sessão, com o papel em cada um. */
  acessos: AcessoAoPainel[];
  /** Painéis (linhas de produto) que o e-mail pode escolher. */
  paineis: PainelAcessivel[];
  /** Painel escolhido depois do login, ou `null` enquanto não escolheu. */
  painel: string | null;
  /** Verdadeiro enquanto a sessão gravada é revalidada contra o catálogo. */
  carregando: boolean;
  entrar: (email: string) => Promise<void>;
  escolherPainel: (painel: string) => void;
  trocarPainel: () => void;
  sair: () => void;
}

const Contexto = createContext<ValorSessao | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [acessos, setAcessos] = useState<AcessoAoPainel[]>([]);
  const [painel, setPainel] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const paineis = useMemo(() => paineisAcessiveis(acessos), [acessos]);

  // A sessão gravada é revalidada a cada abertura: se o catálogo tirou o
  // acesso do e-mail, o usuário volta para a tela de login; se tirou o painel
  // escolhido, volta para a tela de escolha.
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
        if (!encontrados.length) {
          limparSessao();
          limparPainel();
        } else {
          setEmail(sessao.email);
          setAcessos(encontrados);
          const gravado = lerPainel();
          const valido = paineisAcessiveis(encontrados).some(
            (p) => p.linhaProduto === gravado,
          );
          if (gravado && valido) setPainel(gravado);
          else limparPainel();
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
    limparPainel();
    setEmail(alvo);
    setAcessos(encontrados);
    setPainel(null);
  }, []);

  const escolherPainel = useCallback((escolhido: string) => {
    gravarPainel(escolhido);
    setPainel(escolhido);
  }, []);

  const trocarPainel = useCallback(() => {
    limparPainel();
    setPainel(null);
  }, []);

  const sair = useCallback(() => {
    limparSessao();
    limparPainel();
    setEmail(null);
    setAcessos([]);
    setPainel(null);
  }, []);

  const valor = useMemo<ValorSessao>(
    () => ({
      email,
      acessos,
      paineis,
      painel,
      carregando,
      entrar,
      escolherPainel,
      trocarPainel,
      sair,
    }),
    [email, acessos, paineis, painel, carregando, entrar, escolherPainel, trocarPainel, sair],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): ValorSessao {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useSessao exige <SessaoProvider> acima na árvore.');
  return valor;
}
