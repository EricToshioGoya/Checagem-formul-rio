import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ehAdministrador } from '../core/auth/acesso';
import { useSessao } from '../features/auth/SessaoContexto';

export function Layout() {
  const { pathname } = useLocation();
  const navegar = useNavigate();
  const { email, acessos, sair } = useSessao();
  const naAdmin = pathname.startsWith('/admin');
  const administra = ehAdministrador(acessos);

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
          <p className="mx-auto max-w-5xl truncate px-4 py-1.5 text-sm text-abb-gray">
            Conectado como <span className="font-semibold text-abb-black">{email}</span>
            {' • '}
            {acessos.length === 1
              ? '1 painel liberado'
              : `${acessos.length} painéis liberados`}
          </p>
        </div>
      ) : null}
      <main className="mx-auto max-w-5xl px-4 py-5 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
