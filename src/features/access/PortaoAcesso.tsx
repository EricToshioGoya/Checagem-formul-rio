import { useEffect } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { useSessao } from '../auth/SessaoContexto';
import { Carregando } from '../../shared/componentes/Estado';

/**
 * Bloqueia as telas do painel enquanto o responsável não aprovar o montador.
 *
 * As rotas do fluxo carregam o painel na URL (`/paineis/:tipoPainel/...`);
 * quando ela discorda do painel em sessão, a sessão é quem vale — abrir a URL
 * de outro painel não contorna a aprovação.
 *
 * A permissão é reconferida a cada entrada no fluxo: como ela tem prazo, o
 * vencimento precisa valer também para quem deixou o aplicativo aberto.
 */
export function PortaoAcesso() {
  const { tipoPainel } = useParams();
  const { painel, aprovado, carregando, revalidarAcesso } = useSessao();

  useEffect(() => {
    void revalidarAcesso();
  }, [revalidarAcesso]);

  if (carregando) return <Carregando mensagem="Verificando acesso…" />;
  if (!painel) return <Navigate to="/" replace />;
  if (!aprovado) return <Navigate to="/acesso" replace />;
  if (tipoPainel && tipoPainel !== painel.id) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
