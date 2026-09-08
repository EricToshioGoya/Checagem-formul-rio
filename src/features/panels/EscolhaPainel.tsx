import { NOME_APLICACAO } from '../../core/config';
import { Botao } from '../../shared/componentes/Botao';
import { Vazio } from '../../shared/componentes/Estado';
import { IconeSeta } from '../../shared/componentes/Icones';
import { useSessao } from '../auth/SessaoContexto';

/**
 * Segundo passo do acesso: escolher o painel antes de montar projetos.
 * A lista sai do catálogo (`public/forms/index.json`), agrupada por linha de
 * produto e filtrada pelos painéis liberados para o e-mail em sessão.
 */
export function EscolhaPainel() {
  const { email, paineis, escolherPainel, sair } = useSessao();

  return (
    <div className="min-h-dvh">
      <header className="bg-abb-red text-white shadow-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-xl font-black tracking-tight">ABB</span>
            <span className="text-base font-semibold">{NOME_APLICACAO}</span>
          </div>
          <button
            type="button"
            onClick={sair}
            className="flex min-h-12 items-center rounded-md px-3 text-base font-semibold hover:bg-white/15"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold">Escolha o painel</h1>
          <p className="mt-1 text-base text-abb-gray">
            Painéis liberados para{' '}
            <span className="font-semibold text-abb-black">{email}</span>. O painel
            escolhido define os formulários e os projetos que você vê a seguir.
          </p>
        </div>

        {paineis.length === 0 ? (
          <Vazio titulo="Nenhum painel liberado">
            Peça ao administrador do painel para incluir o seu e-mail.
          </Vazio>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {paineis.map((p) => (
              <li key={p.linhaProduto}>
                <button
                  type="button"
                  onClick={() => escolherPainel(p.linhaProduto)}
                  className="flex min-h-32 w-full flex-col justify-between rounded-lg border-2 border-abb-line bg-white p-4 text-left hover:border-abb-red focus-visible:border-abb-red"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold break-words">{p.linhaProduto}</h2>
                      <p className="mt-1 text-sm text-abb-gray">
                        {p.entradas
                          .map((e) => (e.tipo === 'montagem' ? 'Montagem' : 'Rotina'))
                          .join(' • ')}
                      </p>
                    </div>
                    <IconeSeta className="h-5 w-5 shrink-0 text-abb-red" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-abb-gray">
                    {p.administrador ? 'Você administra este painel' : 'Acesso liberado'}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        <Botao onClick={sair}>Entrar com outro e-mail</Botao>
      </main>
    </div>
  );
}
