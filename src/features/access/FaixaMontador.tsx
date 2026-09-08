import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AcessoRepository } from '../../core/db/repositorios';

/** Mostra quem está montando e qual painel foi liberado neste aparelho. */
export function FaixaMontador() {
  const navegar = useNavigate();
  const dados = useLiveQuery(async () => {
    const sessao = await AcessoRepository.sessaoAtual();
    if (!sessao) return null;
    const acesso = await AcessoRepository.obter(sessao.email, sessao.painelId);
    return acesso?.aprovadoEm ? acesso : null;
  }, []);

  if (!dados) return null;

  const sair = async () => {
    await AcessoRepository.encerrarSessao();
    navegar('/acesso', { replace: true });
  };

  return (
    <div className="border-b border-abb-line bg-neutral-50">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <p className="text-sm text-abb-gray">
          <span className="font-semibold text-abb-black">{dados.painelNome}</span>
          {' — '}
          <span className="break-all">{dados.email}</span>
        </p>
        <button
          type="button"
          onClick={sair}
          className="min-h-8 rounded-md px-2 text-sm font-semibold text-abb-red hover:bg-red-50"
        >
          Sair
        </button>
      </div>
    </div>
  );
}
