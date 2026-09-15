import { useEffect, useState } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { Carregando } from '../../shared/componentes/Estado';
import { useLiberacao } from './LiberacaoAtiva';
import { usePainelAtivo } from './PainelAtivo';

/**
 * Guarda as telas de trabalho.
 *
 * Três checagens, todas reavaliadas a cada entrada no fluxo: o painel da URL
 * precisa ser o painel em uso — abrir a URL de outro painel não contorna a
 * escolha —, o painel que exige liberação não abre antes de a administração
 * liberar, e o painel que exige identificação não abre sem ela.
 *
 * As regras e a liberação são relidas aqui, e não só na abertura do
 * aplicativo: mudar a lista de domínios ou revogar um acesso fecha o painel na
 * entrada seguinte, sem esperar recarregar a página.
 */
export function PortaoPainel() {
  const { tipoPainel } = useParams();
  const { painel, precisaIdentificar, carregando, revalidarPermissao } = usePainelAtivo();
  const { bloqueado, exigida, revalidar: revalidarLiberacao } = useLiberacao();
  const [conferindo, setConferindo] = useState(true);

  useEffect(() => {
    let vivo = true;
    setConferindo(true);
    // A liberação é reconferida junto das regras, e não só ao abrir o
    // aplicativo: revogar um acesso fecha o painel na entrada seguinte, sem
    // depender de o montador recarregar a página.
    void Promise.all([
      revalidarPermissao(),
      exigida ? revalidarLiberacao() : Promise.resolve(),
    ]).finally(() => {
      if (vivo) setConferindo(false);
    });
    return () => {
      vivo = false;
    };
  }, [revalidarPermissao, revalidarLiberacao, exigida]);

  if (carregando || conferindo) return <Carregando mensagem="Carregando o painel…" />;
  if (!painel) return <Navigate to="/" replace />;
  if (tipoPainel && tipoPainel !== painel.id) return <Navigate to="/" replace />;
  if (bloqueado) return <Navigate to="/liberacao" replace />;
  if (precisaIdentificar) return <Navigate to="/identificacao" replace />;
  return <Outlet />;
}
