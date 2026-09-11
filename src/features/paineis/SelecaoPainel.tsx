import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Painel } from '../../core/paineis/tipos';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeSeta } from '../../shared/componentes/Icones';
import { usePainelAtivo } from './PainelAtivo';

/**
 * Primeira tela da ferramenta: a escolha do tipo de painel antecede qualquer
 * preenchimento. O painel escolhido determina os checklists, o template do
 * certificado e o responsável ABB pela validação.
 */
export function SelecaoPainel() {
  const navegar = useNavigate();
  const { paineis, painel: emUso, escolherPainel, carregando } = usePainelAtivo();
  const [erro, setErro] = useState<string | null>(null);

  const abrir = async (painel: Painel) => {
    try {
      await escolherPainel(painel.id);
      navegar(
        painel.fluxo === 'certificacao'
          ? `/paineis/${painel.id}/solicitacoes`
          : `/paineis/${painel.id}/projetos`,
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir o painel.');
    }
  };

  if (erro) return <Erro detalhe={erro} />;
  if (carregando) return <Carregando mensagem="Carregando os tipos de painel…" />;
  if (!paineis.length) return <Erro detalhe="Nenhum painel ativo no catálogo." />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Escolha o tipo de painel</h1>
        <p className="mt-1 text-base text-abb-gray">
          O painel define os checklists e o fluxo. A escolha fica gravada neste
          aparelho.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {paineis.map((painel) => {
          const atual = emUso?.id === painel.id;
          return (
            <li key={painel.id}>
              <button
                type="button"
                onClick={() => abrir(painel)}
                className={[
                  'flex h-full min-h-32 w-full flex-col justify-between rounded-lg border-2 bg-white p-4 text-left hover:border-abb-red focus-visible:border-abb-red',
                  atual ? 'border-abb-red' : 'border-abb-line',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold break-words">{painel.nome}</h2>
                    <p className="mt-1 text-base text-abb-gray">{painel.descricao}</p>
                  </div>
                  <IconeSeta className="h-6 w-6 shrink-0 text-abb-red" />
                </div>
                {atual ? (
                  <p className="mt-3 inline-flex w-fit rounded bg-red-50 px-2 py-1 text-sm font-bold text-abb-red">
                    Em uso neste aparelho
                  </p>
                ) : null}
                <div className="mt-3">
                  <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
                    {painel.fluxo === 'certificacao'
                      ? 'Solicitação de certificação'
                      : 'Verificação de montagem'}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
