import { useEffect, useState } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { Carregando } from '../../shared/componentes/Estado';
import { usePainelAtivo } from './PainelAtivo';

/**
 * Guarda as telas de trabalho.
 *
 * Duas checagens, ambas reavaliadas a cada entrada no fluxo: o painel da URL
 * precisa ser o painel em uso — abrir a URL de outro painel não contorna a
 * escolha —, e o painel que exige identificação não abre sem ela.
 *
 * As regras são relidas aqui, e não só na abertura do aplicativo: mudar a
 * lista de domínios fecha o painel na entrada seguinte para quem deixou de ser
 * aceito, sem esperar recarregar a página.
 */
export function PortaoPainel() {
  const { tipoPainel } = useParams();
  const { painel, precisaIdentificar, carregando, revalidarPermissao } = usePainelAtivo();
  const [conferindo, setConferindo] = useState(true);

  useEffect(() => {
    let vivo = true;
    setConferindo(true);
    void revalidarPermissao().finally(() => {
      if (vivo) setConferindo(false);
    });
    return () => {
      vivo = false;
    };
  }, [revalidarPermissao]);

  if (carregando || conferindo) return <Carregando mensagem="Carregando o painel…" />;
  if (!painel) return <Navigate to="/" replace />;
  if (tipoPainel && tipoPainel !== painel.id) return <Navigate to="/" replace />;
  if (precisaIdentificar) return <Navigate to="/identificacao" replace />;
  return <Outlet />;
}
