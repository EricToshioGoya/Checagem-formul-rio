import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, type PainelApi, type ResumoAdmin } from '../core/api/cliente';
import { useSessao } from '../core/api/SessaoContexto';
import { plural } from '../../compartilhado/plural';
import { LogoAbb } from '../shared/componentes/LogoAbb';
import { IconePdf } from '../shared/componentes/Icones';
import { PDF_INSTRUCOES, TITULO_PDF_INSTRUCOES } from '../core/config';

const aba =
  'flex min-h-10 items-center rounded-lg px-2.5 text-sm font-semibold transition-colors sm:px-3';

function classeAba({ isActive }: { isActive: boolean }): string {
  return `${aba} ${isActive ? 'bg-red-50 text-abb-red' : 'text-abb-gray hover:bg-neutral-100 hover:text-abb-black'}`;
}

/** Contador vermelho ao lado do item do menu. */
function Selo({ n, rotulo }: { n: number; rotulo: string }): ReactNode {
  if (n <= 0) return null;
  return (
    <span
      className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-abb-red px-1 text-xs font-bold text-white"
      aria-label={rotulo}
    >
      {n}
    </span>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const { usuario, perfil, sair } = useSessao();
  const navegar = useNavigate();
  const [pendentes, setPendentes] = useState(0);
  const [pendentesAdmin, setPendentesAdmin] = useState(0);
  const ehAdmin = perfil === 'admin';

  // Para o administrador: pedidos de acesso e de papel esperando alguém.
  useEffect(() => {
    if (!ehAdmin) {
      setPendentesAdmin(0);
      return;
    }
    let ativo = true;
    api
      .get<ResumoAdmin>('/api/admin/resumo')
      .then((r) => {
        if (ativo) setPendentesAdmin(r.pedidosAdmin + r.acessosPendentes);
      })
      .catch(() => {
        if (ativo) setPendentesAdmin(0);
      });
    return () => {
      ativo = false;
    };
  }, [ehAdmin, pathname]);

  // Contador de pedidos aguardando o dono. Relê a cada troca de tela, que é
  // quando ele pode ter mudado — evita ficar batendo no servidor em laço.
  useEffect(() => {
    if (!usuario) {
      setPendentes(0);
      return;
    }
    let ativo = true;
    api
      .get<{ paineis: PainelApi[] }>('/api/paineis')
      .then(({ paineis }) => {
        if (ativo) setPendentes(paineis.reduce((s, p) => s + p.pendentes, 0));
      })
      .catch(() => {
        // Sem rede o contador some; não é motivo para interromper a tela.
        if (ativo) setPendentes(0);
      });
    return () => {
      ativo = false;
    };
  }, [usuario, pathname]);

  const encerrar = async () => {
    await sair();
    navegar('/entrar', { replace: true });
  };

  // Projeto e preenchimento pertencem a um painel: o menu continua em "Painéis".
  const emPaineis =
    pathname === '/' ||
    pathname.startsWith('/paineis') ||
    pathname.startsWith('/projetos') ||
    pathname.startsWith('/solicitacoes');
  // As instruções de envio valem para a solicitação de certificação.
  const naCertificacao = /^\/(paineis\/[^/]+\/)?solicitacoes/.test(pathname);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-abb-line/70 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
          <Link
            to="/"
            className="flex min-h-10 items-center gap-3 rounded-md"
            aria-label="Início — Verificação de Montagem de Painéis"
          >
            <LogoAbb className="h-6 w-auto text-abb-red" />
            <span className="h-6 w-px bg-abb-line" aria-hidden="true" />
            <span className="text-sm leading-tight font-semibold text-abb-black">
              <span className="hidden sm:inline">Verificação de Montagem de Painéis</span>
              <span className="sm:hidden">Verificação</span>
            </span>
          </Link>

          {usuario ? (
            <nav className="flex items-center gap-0.5" aria-label="Principal">
              <Link to="/paineis" className={classeAba({ isActive: emPaineis })}>
                Painéis
              </Link>
              <NavLink to="/aprovacoes" className={classeAba}>
                Aprovações
                <Selo n={pendentes} rotulo={`${pendentes} aguardando decisão`} />
              </NavLink>
              {ehAdmin ? (
                <NavLink to="/admin" className={classeAba}>
                  <span className="sm:hidden">Admin</span>
                  <span className="hidden sm:inline">Administração</span>
                  <Selo
                    n={pendentesAdmin}
                    rotulo={`${plural(pendentesAdmin, 'pendência', 'pendências')} na administração`}
                  />
                </NavLink>
              ) : null}
              <button
                type="button"
                onClick={encerrar}
                className={`${aba} text-abb-gray hover:bg-neutral-100 hover:text-abb-black`}
              >
                Sair
              </button>
            </nav>
          ) : null}
        </div>

        {usuario ? (
          <div className="border-t border-abb-line/50 bg-abb-offwhite">
            <p className="mx-auto flex max-w-5xl items-center gap-2 truncate px-4 py-1 text-xs text-abb-gray">
              {ehAdmin ? (
                <span className="shrink-0 rounded-full bg-abb-red px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                  Administrador
                </span>
              ) : null}
              <span className="truncate">
                <span className="font-semibold text-abb-black">{usuario.nome}</span> ·{' '}
                {usuario.email}
              </span>
            </p>
          </div>
        ) : null}
      </header>

      {naCertificacao ? (
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
      ) : null}

      <main className="mx-auto max-w-5xl px-4 py-5 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
