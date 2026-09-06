import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSessao } from '../features/auth/SessaoContexto';

export function Layout() {
  const { pathname } = useLocation();
  const navegar = useNavigate();
  const { email, painel, paineis, trocarPainel, sair } = useSessao();
  const naAdmin = pathname.startsWith('/admin');
  // A administração vale para o painel ativo, não para todos os liberados.
  const administra = paineis.some((p) => p.linhaProduto === painel && p.administrador);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 bg-abb-red text-white shadow-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-3 rounded-md">
            <span className="text-xl font-black tracking-tight">ABB</span>
            <span className="hidden text-base font-semibold sm:inline">
              Verificação de Montagem de Painéis
            </span>
            <span className="text-base font-semibold sm:hidden">Verificação</span>
          </Link>
          <div className="flex items-center gap-1">
            {administra ? (
              <Link
                to={naAdmin ? '/' : '/admin'}
                className="flex min-h-12 items-center rounded-md px-3 text-base font-semibold hover:bg-white/15"
              >
                {naAdmin ? 'Sair da administração' : 'Administração'}
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => {
                sair();
                navegar('/');
              }}
              className="flex min-h-12 items-center rounded-md px-3 text-base font-semibold hover:bg-white/15"
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      {email ? (
        <div className="border-b border-abb-line bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-1.5">
            <p className="min-w-0 truncate text-sm text-abb-gray">
              Painel <span className="font-semibold text-abb-black">{painel}</span>
              {' • '}
              <span className="font-semibold text-abb-black">{email}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                trocarPainel();
                navegar('/');
              }}
              className="text-sm font-semibold text-abb-red underline underline-offset-2"
            >
              Trocar painel
            </button>
          </div>
        </div>
      ) : null}
      <main className="mx-auto max-w-5xl px-4 py-5 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
