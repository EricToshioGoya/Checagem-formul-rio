import { Link, Outlet, useLocation } from 'react-router-dom';
import { PDF_INSTRUCOES, TITULO_PDF_INSTRUCOES } from '../core/config';
import { IconePdf } from '../shared/componentes/Icones';

export function Layout() {
  const { pathname } = useLocation();
  const naAdmin = pathname.startsWith('/admin');

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
          <Link
            to={naAdmin ? '/' : '/admin'}
            className="flex min-h-12 items-center rounded-md px-3 text-base font-semibold hover:bg-white/15"
          >
            {naAdmin ? 'Sair da administração' : 'Administração'}
          </Link>
        </div>
      </header>

      {/* Logo abaixo do cabeçalho, em todas as telas do fluxo. */}
      <div className="border-b border-abb-line bg-white">
        <div className="mx-auto max-w-5xl px-4 py-2">
          <a
            href={`${import.meta.env.BASE_URL}${PDF_INSTRUCOES}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center gap-2 text-base font-semibold text-abb-red underline underline-offset-2"
          >
            <IconePdf className="h-5 w-5 shrink-0" />
            {TITULO_PDF_INSTRUCOES}
          </a>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-5 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
