import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PDF_INSTRUCOES, TITULO_PDF_INSTRUCOES } from '../core/config';
import { IconePaineis, IconePdf } from '../shared/componentes/Icones';
import { usePainelAtivo } from '../features/paineis/PainelAtivo';

export function Layout() {
  const { pathname } = useLocation();
  const navegar = useNavigate();
  const { painel, identificacao, trocarPainel } = usePainelAtivo();
  const naAdmin = pathname.startsWith('/admin');
  const naEscolha = pathname === '/';

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
          <div className="flex items-center gap-2">
            {painel && !naEscolha ? (
              // A escolha do painel é a primeira decisão do fluxo e precisa
              // continuar à mão: aberto o aplicativo numa URL de painel, este
              // botão é o caminho de volta aos quatro.
              <button
                type="button"
                onClick={() => {
                  trocarPainel();
                  navegar('/');
                }}
                className="flex min-h-12 max-w-[14rem] items-center gap-2 rounded-md border border-white/70 px-3 text-base font-semibold hover:bg-white/15"
                title="Escolher outro tipo de painel"
              >
                <IconePaineis className="h-5 w-5 shrink-0" />
                <span className="truncate">{painel.nome}</span>
                <span className="hidden shrink-0 text-sm font-normal opacity-90 sm:inline">
                  trocar
                </span>
              </button>
            ) : null}
            <Link
              to={naAdmin ? '/' : '/admin'}
              className="flex min-h-12 items-center rounded-md px-3 text-base font-semibold hover:bg-white/15"
            >
              {naAdmin ? 'Sair da administração' : 'Administração'}
            </Link>
          </div>
        </div>
      </header>

      {painel && !naEscolha ? (
        <div className="border-b border-abb-line bg-neutral-50">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-1.5">
            <p className="min-w-0 truncate text-sm text-abb-gray">
              Painel <span className="font-semibold text-abb-black">{painel.nome}</span>
              {identificacao ? (
                <>
                  {' • '}
                  <span className="font-semibold text-abb-black">{identificacao.email}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : null}

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
