import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { obterPainel, paineisAtivos } from '../../core/paineis/catalogo';
import {
  gravarIdentificacao,
  lerIdentificacao,
  limparIdentificacao,
  type Identificacao,
} from '../../core/paineis/identificacao';
import {
  PERMISSAO_LIVRE,
  dominioPermitido,
  permissaoDoPainel,
  type PermissaoPainel,
} from '../../core/paineis/permissoes';
import { gravarPainel, lerPainel, limparPainel } from '../../core/paineis/preferencia';
import type { Painel } from '../../core/paineis/tipos';

interface ValorPainel {
  /** Painéis do catálogo, para a tela de escolha. */
  paineis: Painel[];
  /** Painel em uso, ou `null` enquanto o operador não escolheu. */
  painel: Painel | null;
  /** Permissões de uso do painel em uso. */
  permissao: PermissaoPainel;
  /** Quem declarou estar usando o painel, neste aparelho. */
  identificacao: Identificacao | null;
  /** O painel exige identificação e a que existe não serve? */
  precisaIdentificar: boolean;
  /** Verdadeiro enquanto a escolha gravada é revalidada contra o catálogo. */
  carregando: boolean;
  escolherPainel: (painelId: string) => Promise<void>;
  trocarPainel: () => void;
  identificar: (dados: Omit<Identificacao, 'em'>) => void;
  esquecerIdentificacao: () => void;
  /** Relê as regras do painel e a identificação gravada. */
  revalidarPermissao: () => Promise<void>;
}

const Contexto = createContext<ValorPainel | null>(null);

export function PainelProvider({ children }: { children: ReactNode }) {
  const [paineis, setPaineis] = useState<Painel[]>([]);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [permissao, setPermissao] = useState<PermissaoPainel>(PERMISSAO_LIVRE);
  const [identificacao, setIdentificacao] = useState<Identificacao | null>(null);
  const [carregando, setCarregando] = useState(true);

  // A escolha gravada é revalidada a cada abertura: painel que saiu do
  // catálogo devolve o operador à escolha, em vez de deixá-lo numa tela vazia.
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const doCatalogo = await paineisAtivos();
        if (!ativo) return;
        setPaineis(doCatalogo);
        const escolhido = doCatalogo.find((p) => p.id === lerPainel()) ?? null;
        if (!escolhido) {
          limparPainel();
          return;
        }
        const regras = await permissaoDoPainel(escolhido.id);
        if (!ativo) return;
        setPainel(escolhido);
        setPermissao(regras);
        setIdentificacao(lerIdentificacao(escolhido.id));
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

  const escolherPainel = useCallback(async (painelId: string) => {
    const escolhido = await obterPainel(painelId);
    gravarPainel(escolhido.id);
    setPainel(escolhido);
    setPermissao(await permissaoDoPainel(escolhido.id));
    setIdentificacao(lerIdentificacao(escolhido.id));
  }, []);

  const trocarPainel = useCallback(() => {
    limparPainel();
    setPainel(null);
    setPermissao(PERMISSAO_LIVRE);
    setIdentificacao(null);
  }, []);

  const identificar = useCallback(
    (dados: Omit<Identificacao, 'em'>) => {
      if (!painel) return;
      setIdentificacao(gravarIdentificacao(painel.id, dados));
    },
    [painel],
  );

  const revalidarPermissao = useCallback(async () => {
    if (!painel) return;
    setPermissao(await permissaoDoPainel(painel.id));
    setIdentificacao(lerIdentificacao(painel.id));
  }, [painel]);

  const esquecerIdentificacao = useCallback(() => {
    if (!painel) return;
    limparIdentificacao(painel.id);
    setIdentificacao(null);
  }, [painel]);

  // A identificação guardada é reconferida contra as regras em vigor: mudar a
  // lista de domínios tira do fluxo quem deixou de ser aceito.
  const precisaIdentificar =
    !!painel &&
    permissao.exigirIdentificacao &&
    (!identificacao || !dominioPermitido(identificacao.email, permissao));

  const valor = useMemo<ValorPainel>(
    () => ({
      paineis,
      painel,
      permissao,
      identificacao,
      precisaIdentificar,
      carregando,
      escolherPainel,
      trocarPainel,
      identificar,
      esquecerIdentificacao,
      revalidarPermissao,
    }),
    [
      paineis,
      painel,
      permissao,
      identificacao,
      precisaIdentificar,
      carregando,
      escolherPainel,
      trocarPainel,
      identificar,
      esquecerIdentificacao,
      revalidarPermissao,
    ],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function usePainelAtivo(): ValorPainel {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('usePainelAtivo exige <PainelProvider> acima na árvore.');
  return valor;
}
