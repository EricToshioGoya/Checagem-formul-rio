import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { api, ErroApi, type Perfil, type PainelPublico } from '../../core/api/cliente';
import { useSessao } from '../../core/api/SessaoContexto';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeChave, IconeCheck, IconeVoltar } from '../../shared/componentes/Icones';

type Modo = 'entrar' | 'cadastrar';

const campo =
  'min-h-12 w-full rounded-md border border-abb-line bg-white px-3 text-base text-abb-black placeholder:text-neutral-400 focus:border-abb-red';

const textos: Record<Perfil, Record<Modo, { titulo: string; descricao: string; botao: string }>> = {
  montador: {
    entrar: {
      titulo: 'Entrar',
      descricao:
        'Identifique-se e escolha o painel que vai montar. O responsável pelo painel precisa aprovar o seu acesso.',
      botao: 'Entrar',
    },
    cadastrar: {
      titulo: 'Criar conta',
      descricao:
        'Identifique-se e escolha o painel que vai montar. O responsável pelo painel precisa aprovar o seu acesso.',
      botao: 'Criar conta e entrar',
    },
  },
  admin: {
    entrar: {
      titulo: 'Entrar como administrador',
      descricao:
        'Para quem controla os acessos, os painéis e os checklists. Use o seu próprio e-mail e senha.',
      botao: 'Entrar como administrador',
    },
    cadastrar: {
      titulo: 'Criar conta de administrador',
      descricao:
        'A conta é criada na hora, mas a administração só abre depois que outro administrador aprovar o seu pedido.',
      botao: 'Criar conta e pedir aprovação',
    },
  },
};

/**
 * Porta de entrada: quem é a pessoa e como ela entra.
 *
 * O padrão é o montador, que escolhe aqui o painel que vai montar — ao entrar,
 * o pedido de acesso àquele painel segue sozinho para o responsável. No fim
 * da tela, discreto, fica o "Entrar como administrador": a mesma conta, outro
 * tipo de sessão, que só abre para quem tem o papel de administrador.
 *
 * É um `<form>` de verdade: no celular o teclado mostra "ir" e o Enter envia.
 */
export function Entrar() {
  const { usuario, perfil: perfilSessao, carregando, offline, entrar, cadastrar, pedirAdmin } =
    useSessao();
  const [parametros] = useSearchParams();
  const localizacao = useLocation();
  const destinoAnterior = (localizacao.state as { de?: string } | null)?.de ?? '';

  // Quem chegou tentando abrir a administração já começa no modo certo.
  const [perfil, setPerfil] = useState<Perfil>(() =>
    parametros.get('perfil') === 'admin' || destinoAnterior.startsWith('/admin')
      ? 'admin'
      : 'montador',
  );
  const [modo, setModo] = useState<Modo>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');
  const [painelId, setPainelId] = useState('');
  const [paineis, setPaineis] = useState<PainelPublico[] | null>(null);
  const [erro, setErro] = useState<{ texto: string; codigo?: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pedidoEnviado, setPedidoEnviado] = useState(false);

  // Catálogo público: a lista precisa aparecer antes de existir sessão.
  useEffect(() => {
    let ativo = true;
    api
      .get<{ paineis: PainelPublico[] }>('/api/paineis/publicos')
      .then(({ paineis: lista }) => {
        if (ativo) setPaineis(lista);
      })
      .catch(() => {
        // Sem rede a lista fica vazia; o aviso de offline já explica.
        if (ativo) setPaineis([]);
      });
    return () => {
      ativo = false;
    };
  }, []);

  if (carregando) return <Carregando mensagem="Verificando a sua sessão…" />;

  if (usuario) {
    if (perfilSessao === 'admin') return <Navigate to="/admin" replace />;
    // O painel escolhido vai na URL para que a próxima tela já envie o pedido.
    const destino = painelId ? `/paineis?escolhido=${painelId}` : '/paineis';
    return <Navigate to={destino} replace />;
  }

  const trocar = (proximo: { perfil?: Perfil; modo?: Modo }) => {
    if (proximo.perfil) setPerfil(proximo.perfil);
    if (proximo.modo) setModo(proximo.modo);
    setErro(null);
    setPedidoEnviado(false);
  };

  const mensagemDe = (e: unknown): { texto: string; codigo?: string } => {
    if (e instanceof ErroApi && e.semRede) {
      return { texto: 'Sem conexão com o servidor. Entrar exige rede uma vez.' };
    }
    if (e instanceof ErroApi && e.status === 409 && modo === 'cadastrar' && perfil === 'admin') {
      return {
        texto:
          'Já existe conta com este e-mail. Use "Entrar como administrador" com a sua senha — se a conta ainda não for de administrador, dá para pedir por lá.',
      };
    }
    if (e instanceof ErroApi) return { texto: e.message, codigo: e.codigo };
    return { texto: e instanceof Error ? e.message : 'Não foi possível entrar.' };
  };

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      if (modo === 'entrar') {
        await entrar(email, senha, perfil);
      } else if ((await cadastrar(email, senha, nome, perfil)) === 'aguardando-aprovacao') {
        setPedidoEnviado(true);
        setSenha('');
      }
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setEnviando(false);
    }
  };

  /** A senha conferiu, mas a conta não é de administrador: pede o papel. */
  const pedirPapel = async () => {
    setEnviando(true);
    try {
      await pedirAdmin(email, senha);
      setErro(null);
      setPedidoEnviado(true);
      setSenha('');
    } catch (e) {
      setErro(mensagemDe(e));
    } finally {
      setEnviando(false);
    }
  };

  const ehAdmin = perfil === 'admin';
  const texto = textos[perfil][modo];

  if (pedidoEnviado) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-abb-line bg-white p-6 text-center shadow-sm motion-safe:animate-surgir">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-700">
          <IconeCheck className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-xl font-bold">Pedido enviado</h1>
        <p className="mt-2 text-base text-abb-gray">
          O pedido de <strong className="text-abb-black">{email}</strong> para ser administrador
          foi para os administradores. Assim que um deles aprovar, entre por aqui como
          administrador.
        </p>
        <p className="mt-2 text-sm text-abb-gray">
          Enquanto isso, a conta já vale para entrar como montador.
        </p>
        <div className="mt-5 space-y-2">
          <Botao variante="primario" larguraTotal onClick={() => trocar({ modo: 'entrar' })}>
            Voltar para entrar como administrador
          </Botao>
          <Botao larguraTotal onClick={() => trocar({ perfil: 'montador', modo: 'entrar' })}>
            Entrar como montador
          </Botao>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        {ehAdmin ? (
          <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-abb-black px-2.5 py-1 text-xs font-bold tracking-wide text-white uppercase">
            <IconeChave className="h-3.5 w-3.5" />
            Administração
          </span>
        ) : null}
        <h1 className="text-2xl font-bold">{texto.titulo}</h1>
        <p className="mt-1 text-base text-abb-gray">{texto.descricao}</p>
      </div>

      {offline ? (
        <Aviso>
          Sem conexão com o servidor. Entrar exige rede — depois de aprovado, o
          preenchimento das checagens funciona offline.
        </Aviso>
      ) : null}

      <form onSubmit={enviar} className="space-y-4">
        {modo === 'cadastrar' ? (
          <CampoTexto
            rotulo="Seu nome"
            valor={nome}
            onChange={setNome}
            placeholder={ehAdmin ? 'Nome completo' : 'Como aparece no relatório'}
            obrigatorio
            autoFoco
          />
        ) : null}

        <div>
          <label htmlFor="campo-email" className="mb-1 block text-base font-semibold">
            E-mail<span className="text-abb-red"> *</span>
          </label>
          <input
            id="campo-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus={modo === 'entrar'}
            required
            className={campo}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@empresa.com"
          />
        </div>

        <div>
          <label htmlFor="campo-senha" className="mb-1 block text-base font-semibold">
            Senha<span className="text-abb-red"> *</span>
            {modo === 'cadastrar' ? (
              <span className="block text-sm font-normal text-abb-gray">
                No mínimo 8 caracteres.
              </span>
            ) : null}
          </label>
          <input
            id="campo-senha"
            type="password"
            autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            className={campo}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </div>

        {!ehAdmin ? (
          <div>
            <label htmlFor="campo-painel" className="mb-1 block text-base font-semibold">
              Painel que vai montar
              <span className="block text-sm font-normal text-abb-gray">
                Opcional aqui — dá para escolher depois de entrar.
              </span>
            </label>
            <select
              id="campo-painel"
              className={campo}
              value={painelId}
              onChange={(e) => setPainelId(e.target.value)}
            >
              <option value="">— escolher depois —</option>
              {paineis?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {erro?.codigo === 'admin-pendente' ? (
          <Aviso>{erro.texto}</Aviso>
        ) : erro ? (
          <div className="space-y-2">
            <Erro detalhe={erro.texto} />
            {erro.codigo === 'nao-admin' ? (
              <Botao larguraTotal disabled={enviando} onClick={pedirPapel}>
                <IconeChave className="h-5 w-5" />
                Pedir para ser administrador
              </Botao>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={enviando}
          className={[
            'inline-flex min-h-12 w-full items-center justify-center rounded-md border border-transparent px-5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            ehAdmin ? 'bg-abb-black hover:bg-black' : 'bg-abb-red hover:bg-abb-red-dark',
          ].join(' ')}
        >
          {enviando ? 'Aguarde…' : texto.botao}
        </button>
      </form>

      <div className="border-t border-abb-line pt-4 text-center">
        <p className="text-base text-abb-gray">
          {modo === 'entrar'
            ? ehAdmin
              ? 'Ainda não é administrador?'
              : 'Ainda não tem conta?'
            : ehAdmin
              ? 'Já é administrador?'
              : 'Já tem conta?'}
        </p>
        <Botao
          className="mt-2"
          larguraTotal
          onClick={() => trocar({ modo: modo === 'entrar' ? 'cadastrar' : 'entrar' })}
        >
          {modo === 'entrar'
            ? ehAdmin
              ? 'Criar conta de administrador'
              : 'Criar conta'
            : 'Voltar para entrar'}
        </Botao>
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={() => trocar({ perfil: ehAdmin ? 'montador' : 'admin' })}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-abb-gray transition-colors hover:bg-neutral-200/60 hover:text-abb-black"
        >
          {ehAdmin ? (
            <>
              <IconeVoltar className="h-4 w-4" />
              Voltar para o acesso do montador
            </>
          ) : (
            <>
              <IconeChave className="h-4 w-4" />
              Entrar como administrador
            </>
          )}
        </button>
      </div>
    </div>
  );
}
