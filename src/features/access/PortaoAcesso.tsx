import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AcessoRepository } from '../../core/db/repositorios';
import { Carregando } from '../../shared/componentes/Estado';

/**
 * Bloqueia a montagem enquanto o montador identificado no aparelho não tiver
 * aprovação do responsável para o painel escolhido.
 */
export function PortaoAcesso() {
  const local = useLocation();
  const estado = useLiveQuery(async () => {
    const sessao = await AcessoRepository.sessaoAtual();
    if (!sessao) return { liberado: false };
    return { liberado: await AcessoRepository.estaAprovado(sessao.email, sessao.painelId) };
  }, []);

  if (estado === undefined) return <Carregando mensagem="Verificando acesso…" />;
  if (!estado.liberado) {
    return <Navigate to="/acesso" replace state={{ de: local.pathname }} />;
  }
  return <Outlet />;
}
