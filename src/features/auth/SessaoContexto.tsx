import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ehAdministrador, emailValido, normalizarEmail } from '../../core/auth/acesso';
import {
  gravarPainel,
  gravarSessao,
  lerPainel,
  lerSessao,
  limparPainel,
  limparSessao,
} from '../../core/auth/sessao';
import { obterPainel, paineisAtivos } from '../../core/paineis/catalogo';
import type { Painel } from '../../core/paineis/tipos';
import { AcessoRepository } from '../../core/db/repositorios';

interface ValorSessao {
  /** E-mail em sessão, ou `null` quando ninguém entrou. */
  email: string | null;
  /** Painéis do catálogo, para a tela de escolha. */
  paineis: Painel[];
  /** Painel escolhido depois do login, ou `null` enquanto não escolheu. */
  painel: Painel | null;
  /** O responsável já aprovou este e-mail neste painel? */
  aprovado: boolean;
  /** O e-mail administra o painel ativo (edita formulários e valida)? */
  administra: boolean;
  /** Verdadeiro enquanto a sessão gravada é revalidada contra o catálogo. */
  carregando: boolean;
  entrar: (email: string) => Promise<void>;
  escolherPainel: (painelId: string) => Promise<void>;
  trocarPainel: () => void;
  sair: () => void;
  /** Relê a permissão do par e-mail + painel (após digitar o código). */
  revalidarAcesso: () => Promise<void>;
}

const Contexto = createContext<ValorSessao | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [paineis, setPaineis] = useState<Painel[]>([]);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [aprovado, setAprovado] = useState(false);
  const [carregando, setCarregando] = useState(true);

  // Sessão e painel gravados são revalidados a cada abertura: um painel que
  // saiu do catálogo, ou uma permissão apagada, devolvem o montador ao passo
  // anterior em vez de deixá-lo numa tela sem acesso.
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const doCatalogo = await paineisAtivos();
        if (ativo) setPaineis(doCatalogo);
        const sessao = lerSessao();
        if (!sessao) return;
        if (ativo) setEmail(sessao.email);
        const gravado = lerPainel();
        const escolhido = doCatalogo.find((p) => p.id === gravado) ?? null;
        if (!escolhido) {
          limparPainel();
          return;
        }
        const liberado = await AcessoRepository.estaAprovado(sessao.email, escolhido.id);
        if (!ativo) return;
        setPainel(escolhido);
        setAprovado(liberado);
      } catch {
        // Catálogo indisponível: as telas mostram o próprio erro.
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
    gravarSessao(alvo);
    limparPainel();
    setEmail(alvo);
    setPainel(null);
    setAprovado(false);
  }, []);

  const escolherPainel = useCallback(
    async (painelId: string) => {
      const escolhido = await obterPainel(painelId);
      gravarPainel(escolhido.id);
      setPainel(escolhido);
      setAprovado(email ? await AcessoRepository.estaAprovado(email, escolhido.id) : false);
    },
    [email],
  );

  const trocarPainel = useCallback(() => {
    limparPainel();
    setPainel(null);
    setAprovado(false);
  }, []);

  const sair = useCallback(() => {
    limparSessao();
    limparPainel();
    setEmail(null);
    setPainel(null);
    setAprovado(false);
  }, []);

  const revalidarAcesso = useCallback(async () => {
    if (!email || !painel) return;
    setAprovado(await AcessoRepository.estaAprovado(email, painel.id));
  }, [email, painel]);

  const valor = useMemo<ValorSessao>(
    () => ({
      email,
      paineis,
      painel,
      aprovado,
      administra: ehAdministrador(email, painel),
      carregando,
      entrar,
      escolherPainel,
      trocarPainel,
      sair,
      revalidarAcesso,
    }),
    [
      email,
      paineis,
      painel,
      aprovado,
      carregando,
      entrar,
      escolherPainel,
      trocarPainel,
      sair,
      revalidarAcesso,
    ],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): ValorSessao {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useSessao exige <SessaoProvider> acima na árvore.');
  return valor;
}
