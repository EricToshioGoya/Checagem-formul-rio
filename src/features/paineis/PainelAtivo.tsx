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
import { gravarPainel, lerPainel, limparPainel } from '../../core/paineis/preferencia';
import type { Painel } from '../../core/paineis/tipos';

interface ValorPainel {
  /** Painéis do catálogo, para a tela de escolha. */
  paineis: Painel[];
  /** Painel em uso, ou `null` enquanto o operador não escolheu. */
  painel: Painel | null;
  /** Verdadeiro enquanto a escolha gravada é revalidada contra o catálogo. */
  carregando: boolean;
  escolherPainel: (painelId: string) => Promise<void>;
  trocarPainel: () => void;
}

const Contexto = createContext<ValorPainel | null>(null);

export function PainelProvider({ children }: { children: ReactNode }) {
  const [paineis, setPaineis] = useState<Painel[]>([]);
  const [painel, setPainel] = useState<Painel | null>(null);
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
        setPainel(escolhido);
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
  }, []);

  const trocarPainel = useCallback(() => {
    limparPainel();
    setPainel(null);
  }, []);

  const valor = useMemo<ValorPainel>(
    () => ({ paineis, painel, carregando, escolherPainel, trocarPainel }),
    [paineis, painel, carregando, escolherPainel, trocarPainel],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function usePainelAtivo(): ValorPainel {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('usePainelAtivo exige <PainelProvider> acima na árvore.');
  return valor;
}
