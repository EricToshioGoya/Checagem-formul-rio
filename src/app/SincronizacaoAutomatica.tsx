import { useEffect } from 'react';
import { useSessao } from '../core/api/SessaoContexto';
import { EVENTO_DADOS_ALTERADOS } from '../core/db/repositorios';
import { sincronizarAgora } from '../core/sync/sincronizacao';

/** Pausa depois da última alteração antes de enviar: digitar não dispara um envio por tecla. */
const PAUSA_MS = 8_000;
const INTERVALO_MS = 3 * 60_000;

/**
 * Liga a sincronização enquanto há alguém logado: ao entrar, quando a rede
 * volta, quando o aplicativo vai e volta do primeiro plano, a cada 3 minutos e
 * alguns segundos depois de cada alteração.
 */
export function SincronizacaoAutomatica() {
  const { usuario } = useSessao();
  const usuarioId = usuario?.id;

  useEffect(() => {
    if (usuarioId === undefined) return;
    let espera: number | undefined;
    const agora = () => void sincronizarAgora(usuarioId);
    const depoisDeAlterar = () => {
      window.clearTimeout(espera);
      espera = window.setTimeout(agora, PAUSA_MS);
    };
    // Ao voltar para o aplicativo, para trazer o que veio de outro aparelho; ao
    // sair dele, para não deixar para trás o que foi feito nos últimos segundos.
    const aoMudarVisibilidade = () => agora();

    agora();
    const intervalo = window.setInterval(agora, INTERVALO_MS);
    window.addEventListener('online', agora);
    window.addEventListener(EVENTO_DADOS_ALTERADOS, depoisDeAlterar);
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => {
      window.clearTimeout(espera);
      window.clearInterval(intervalo);
      window.removeEventListener('online', agora);
      window.removeEventListener(EVENTO_DADOS_ALTERADOS, depoisDeAlterar);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    };
  }, [usuarioId]);

  return null;
}
