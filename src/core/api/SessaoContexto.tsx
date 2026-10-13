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
  api,
  ErroApi,
  EVENTO_SESSAO_ENCERRADA,
  gravarToken,
  gravarUsuarioGuardado,
  lerToken,
  lerUsuarioGuardado,
  type Perfil,
  type UsuarioSessao,
} from './cliente';

interface RespostaSessao {
  token: string;
  expiraEm: number;
  perfil: Perfil;
  usuario: UsuarioSessao;
}

/**
 * Criar conta de administrador não abre sessão: a conta nasce com o pedido
 * aguardando outro administrador aprovar.
 */
export type ResultadoCadastro = 'entrou' | 'aguardando-aprovacao';

/** Tempo máximo para conferir a sessão na abertura antes de seguir sem rede. */
const ESPERA_CONFERENCIA_MS = 6000;

interface Valor {
  usuario: UsuarioSessao | null;
  /** Como a sessão foi aberta; só `admin` mostra a administração. */
  perfil: Perfil | null;
  carregando: boolean;
  /** O servidor não respondeu na abertura: a conta veio do que o aparelho guardou. */
  offline: boolean;
  entrar: (email: string, senha: string, perfil?: Perfil) => Promise<void>;
  cadastrar: (
    email: string,
    senha: string,
    nome: string,
    perfil?: Perfil,
  ) => Promise<ResultadoCadastro>;
  /** Conta existente pedindo para ser administrador. */
  pedirAdmin: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
}

const Contexto = createContext<Valor | null>(null);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [offline, setOffline] = useState(false);

  const limpar = useCallback(() => {
    gravarToken(null);
    gravarUsuarioGuardado(null);
    setUsuario(null);
    setPerfil(null);
  }, []);

  // Na abertura, confere com o servidor o token guardado. A sessão só é
  // descartada quando o servidor a recusa (401). Sem rede, com o servidor fora
  // do ar ou lento demais, o montador entra com a conta que o aparelho guardou
  // — é o que mantém o preenchimento funcionando dentro do galpão. Antes,
  // qualquer falha que não fosse "sem rede" apagava a sessão.
  useEffect(() => {
    let ativo = true;
    (async () => {
      if (!lerToken()) {
        if (ativo) setCarregando(false);
        return;
      }
      try {
        const r = await Promise.race([
          api.get<{ usuario: UsuarioSessao; perfil: Perfil }>('/api/sessao'),
          new Promise<never>((_, rejeitar) =>
            setTimeout(() => rejeitar(new ErroApi(0, 'tempo esgotado')), ESPERA_CONFERENCIA_MS),
          ),
        ]);
        if (!ativo) return;
        setUsuario(r.usuario);
        setPerfil(r.perfil);
        gravarUsuarioGuardado({ usuario: r.usuario, perfil: r.perfil });
      } catch (erro) {
        if (!ativo) return;
        if (erro instanceof ErroApi && erro.precisaEntrar) {
          limpar();
          return;
        }
        setOffline(true);
        const guardado = lerUsuarioGuardado();
        if (guardado) {
          setUsuario(guardado.usuario);
          setPerfil(guardado.perfil);
        }
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [limpar]);

  // O servidor recusou a sessão no meio do uso: volta para o login.
  useEffect(() => {
    window.addEventListener(EVENTO_SESSAO_ENCERRADA, limpar);
    return () => window.removeEventListener(EVENTO_SESSAO_ENCERRADA, limpar);
  }, [limpar]);

  const aplicar = useCallback((r: RespostaSessao) => {
    gravarToken(r.token);
    gravarUsuarioGuardado({ usuario: r.usuario, perfil: r.perfil });
    setUsuario(r.usuario);
    setPerfil(r.perfil);
    setOffline(false);
  }, []);

  const entrar = useCallback(
    async (email: string, senha: string, comoPerfil: Perfil = 'montador') => {
      aplicar(
        await api.post<RespostaSessao>('/api/sessao', { email, senha, perfil: comoPerfil }),
      );
    },
    [aplicar],
  );

  const cadastrar = useCallback(
    async (
      email: string,
      senha: string,
      nome: string,
      comoPerfil: Perfil = 'montador',
    ): Promise<ResultadoCadastro> => {
      const r = await api.post<RespostaSessao | { pedidoAdmin: 'pendente' }>('/api/cadastro', {
        email,
        senha,
        nome,
        perfil: comoPerfil,
      });
      if ('pedidoAdmin' in r) return 'aguardando-aprovacao';
      aplicar(r);
      return 'entrou';
    },
    [aplicar],
  );

  const pedirAdmin = useCallback(async (email: string, senha: string) => {
    await api.post('/api/pedidos-admin', { email, senha });
  }, []);

  const sair = useCallback(async () => {
    try {
      await api.delete('/api/sessao');
    } catch {
      // Servidor fora do ar não pode prender o usuário na conta:
      // o token local sai de qualquer maneira.
    }
    limpar();
  }, [limpar]);

  const valor = useMemo(
    () => ({ usuario, perfil, carregando, offline, entrar, cadastrar, pedirAdmin, sair }),
    [usuario, perfil, carregando, offline, entrar, cadastrar, pedirAdmin, sair],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): Valor {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useSessao precisa estar dentro de <ProvedorSessao>.');
  return valor;
}
