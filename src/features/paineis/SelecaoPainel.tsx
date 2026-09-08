import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { paineisAtivos } from '../../core/paineis/catalogo';
import type { Painel } from '../../core/paineis/tipos';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeSeta } from '../../shared/componentes/Icones';

/**
 * Primeira tela do sistema: a escolha do tipo de painel antecede qualquer
 * preenchimento. O painel escolhido determina os checklists exibidos, o
 * template do certificado e o responsável ABB pela validação.
 */
export function SelecaoPainel() {
  const navegar = useNavigate();
  const [paineis, setPaineis] = useState<Painel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    paineisAtivos()
      .then(setPaineis)
      .catch((e: unknown) =>
        setErro(e instanceof Error ? e.message : 'Falha ao ler o catálogo de painéis.'),
      );
  }, []);

  if (erro) return <Erro detalhe={erro} />;
  if (!paineis) return <Carregando mensagem="Carregando os tipos de painel…" />;

  const destino = (painel: Painel) =>
    painel.fluxo === 'certificacao'
      ? `/paineis/${painel.id}/solicitacoes`
      : `/paineis/${painel.id}/projetos`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Escolha o tipo de painel</h1>
        <p className="mt-1 text-base text-abb-gray">
          Cada painel/quadro tem a sua própria solicitação, com preenchimento e
          evidências dedicados.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {paineis.map((painel) => (
          <li key={painel.id}>
            <button
              type="button"
              onClick={() => navegar(destino(painel))}
              className="flex h-full min-h-32 w-full flex-col justify-between rounded-lg border-2 border-abb-line bg-white p-4 text-left hover:border-abb-red focus-visible:border-abb-red"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold break-words">{painel.nome}</h2>
                  <p className="mt-1 text-base text-abb-gray">{painel.descricao}</p>
                </div>
                <IconeSeta className="h-6 w-6 shrink-0 text-abb-red" />
              </div>
              <p className="mt-3 text-sm font-semibold tracking-wide text-abb-gray uppercase">
                {painel.fluxo === 'certificacao'
                  ? 'Solicitação de certificação'
                  : 'Verificação de montagem'}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
