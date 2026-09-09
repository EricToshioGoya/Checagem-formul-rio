import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAutorizacao } from '../core/auth/contexto';
import { diasAteExpirar } from '../core/auth/credencial';
import { AUTORIZACAO_DESLIGADA } from '../core/config';

export function Layout() {
  const { pathname } = useLocation();
  const { sessao, sair } = useAutorizacao();
  const naAdmin = pathname.startsWith('/admin');
  const nasAutorizacoes = pathname.startsWith('/autorizacoes');

  return (
    <div className="min-h-dvh">
      {AUTORIZACAO_DESLIGADA ? <FaixaSemProtecao /> : null}
      <header className="sticky top-0 z-30 bg-abb-red text-white shadow-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-3 rounded-md">
            <span className="text-xl font-black tracking-tight">ABB</span>
            <span className="hidden text-base font-semibold sm:inline">
              Verificação de Montagem de Painéis
            </span>
            <span className="text-base font-semibold sm:hidden">Verificação</span>
          </Link>
          <nav className="flex items-center gap-1">
            {sessao?.claims.papel === 'responsavel' ? (
              <Link
                to={nasAutorizacoes ? '/' : '/autorizacoes'}
                className="flex min-h-12 items-center rounded-md px-3 text-base font-semibold hover:bg-white/15"
              >
                {nasAutorizacoes ? 'Sair das autorizações' : 'Autorizações'}
              </Link>
            ) : null}
            <Link
              to={naAdmin ? '/' : '/admin'}
              className="flex min-h-12 items-center rounded-md px-3 text-base font-semibold hover:bg-white/15"
            >
              {naAdmin ? 'Sair da administração' : 'Administração'}
            </Link>
          </nav>
        </div>
      </header>

      {sessao && !AUTORIZACAO_DESLIGADA ? (
        <FaixaSessao
          email={sessao.claims.email}
          painel={sessao.claims.painelNome}
          dias={diasAteExpirar(sessao.claims)}
          onSair={() => void sair()}
        />
      ) : null}

      <main className="mx-auto max-w-5xl px-4 py-5 pb-16">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Quem está usando e por qual painel. Também é onde o montador encerra o
 * acesso ao devolver um aparelho compartilhado.
 */
function FaixaSessao({
  email,
  painel,
  dias,
  onSair,
}: {
  email: string;
  painel: string;
  dias: number;
  onSair: () => void;
}) {
  // Só avisa da validade quando ela está perto o bastante para importar.
  const expirandoEmBreve = dias <= 7;

  return (
    <div className="border-b border-abb-line bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-sm">
        <p className="text-abb-gray">
          <span className="font-semibold text-abb-black">{email}</span> · {painel}
          {expirandoEmBreve ? (
            <span className="ml-2 font-semibold text-amber-700">
              acesso expira em {dias === 0 ? 'menos de um dia' : `${dias} dia(s)`}
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onSair}
          className="min-h-8 rounded-md px-2 font-semibold text-abb-gray hover:bg-neutral-100 hover:text-abb-black"
        >
          Encerrar acesso
        </button>
      </div>
    </div>
  );
}

/**
 * Faixa impossível de ignorar quando o build saiu com a autorização
 * desligada. Um build assim não pode chegar aos parceiros sem que alguém
 * veja isto na primeira tela.
 */
function FaixaSemProtecao() {
  return (
    <div className="bg-amber-400 px-4 py-2 text-center text-sm font-bold text-amber-950">
      Build sem controle de acesso (VITE_SEM_AUTORIZACAO=1). Apenas para
      desenvolvimento — não publique assim.
    </div>
  );
}
