import { Link, Outlet, useLocation } from 'react-router-dom';

export function Layout() {
  const { pathname } = useLocation();
  const naAdmin = pathname.startsWith('/admin');
  const naArquivo = pathname.startsWith('/arquivo');

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 bg-abb-red text-white shadow-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-3 rounded-md">
            <span className="text-xl font-black tracking-tight">ABB</span>
            <span className="hidden text-base font-semibold sm:inline">
              Verificação de Montagem de Painéis
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link
              to={naArquivo ? '/' : '/arquivo'}
              className="flex min-h-12 items-center rounded-md px-2 text-base font-semibold whitespace-nowrap hover:bg-white/15 sm:px-3"
            >
              {naArquivo ? 'Sair do arquivo' : 'Arquivo'}
            </Link>
            <Link
              to={naAdmin ? '/' : '/admin'}
              className="flex min-h-12 items-center rounded-md px-2 text-base font-semibold whitespace-nowrap hover:bg-white/15 sm:px-3"
            >
              {naAdmin ? 'Sair da administração' : 'Administração'}
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
