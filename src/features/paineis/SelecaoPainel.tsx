import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AcessoRepository } from '../../core/db/repositorios';
import type { Painel } from '../../core/paineis/tipos';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeCheck, IconeSeta } from '../../shared/componentes/Icones';
import { dataBr } from '../../shared/utils/texto';
import { useSessao } from '../auth/SessaoContexto';

/**
 * Primeira tela depois do login: a escolha do tipo de painel antecede
 * qualquer preenchimento. O painel escolhido determina os checklists, o
 * template do certificado, o responsável ABB pela validação e — antes de
 * tudo — quem aprova o acesso do montador.
 */
export function SelecaoPainel() {
  const navegar = useNavigate();
  const { email, paineis, escolherPainel, carregando } = useSessao();
  /** Fim do prazo de cada painel liberado; ausente ou nulo, exige aprovação. */
  const [liberados, setLiberados] = useState<Record<string, number | null>>({});
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!email || !paineis.length) return;
    let ativo = true;
    (async () => {
      const mapa: Record<string, number | null> = {};
      for (const painel of paineis) {
        mapa[painel.id] = await AcessoRepository.validadeDe(email, painel.id);
      }
      if (ativo) setLiberados(mapa);
    })();
    return () => {
      ativo = false;
    };
  }, [email, paineis]);

  const abrir = async (painel: Painel) => {
    try {
      await escolherPainel(painel.id);
      if (!liberados[painel.id]) {
        navegar('/acesso');
        return;
      }
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
          Cada painel exige a aprovação do responsável antes do primeiro acesso.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {paineis.map((painel) => {
          const liberado = liberados[painel.id];
          return (
            <li key={painel.id}>
              <button
                type="button"
                onClick={() => abrir(painel)}
                className="flex h-full min-h-32 w-full flex-col justify-between rounded-lg border-2 border-abb-line bg-white p-4 text-left hover:border-abb-red focus-visible:border-abb-red"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold break-words">{painel.nome}</h2>
                    <p className="mt-1 text-base text-abb-gray">{painel.descricao}</p>
                  </div>
                  <IconeSeta className="h-6 w-6 shrink-0 text-abb-red" />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
                    {painel.fluxo === 'certificacao'
                      ? 'Solicitação de certificação'
                      : 'Verificação de montagem'}
                  </p>
                  {liberado ? (
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-abb-black">
                      <IconeCheck className="h-4 w-4 text-abb-red" />
                      Liberado até {dataBr(liberado)}
                    </span>
                  ) : (
                    <span className="rounded-md border border-amber-400 bg-amber-50 px-2 py-0.5 text-sm font-semibold text-amber-900">
                      Requer aprovação
                    </span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
