import { Outlet, useNavigate } from 'react-router-dom';
import { useSessao } from '../core/api/SessaoContexto';
import { Botao } from '../shared/componentes/Botao';
import { IconeChave } from '../shared/componentes/Icones';

/**
 * Portão da administração: só a sessão aberta por "Entrar como
 * administrador" passa. Quem entrou como montador — mesmo tendo o papel —
 * recebe o caminho para entrar do jeito certo.
 *
 * Como o portão de sessão, é conveniência de navegação: quem barra de fato é
 * o servidor, que confere papel e tipo de sessão em toda rota de administração.
 */
export function ExigirAdmin() {
  const { perfil, sair } = useSessao();
  const navegar = useNavigate();

  if (perfil === 'admin') return <Outlet />;

  const entrarComoAdmin = async () => {
    await sair();
    navegar('/entrar?perfil=admin', { replace: true });
  };

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-abb-line bg-white p-6 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-abb-black">
        <IconeChave className="h-7 w-7" />
      </div>
      <h1 className="mt-4 text-xl font-bold">Área de administração</h1>
      <p className="mt-2 text-base text-abb-gray">
        Você entrou como montador. Para administrar, saia e entre como
        administrador, com uma conta que tenha esse papel.
      </p>
      <div className="mt-5 space-y-2">
        <Botao variante="primario" larguraTotal onClick={entrarComoAdmin}>
          Sair e entrar como administrador
        </Botao>
        <Botao larguraTotal onClick={() => navegar('/')}>
          Voltar aos painéis
        </Botao>
      </div>
    </div>
  );
}
