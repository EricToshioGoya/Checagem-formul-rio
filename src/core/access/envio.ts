import { URL_APROVACAO } from '../config';

/**
 * Envio do pedido de aprovação pelo servidor.
 *
 * O `mailto:` só abre um rascunho no programa do montador — e nem isso, dentro
 * de iframes restritos. Quando há um servidor configurado (a rota
 * `/api/aprovacao` do binário portátil, um fluxo do Power Automate ou uma
 * função na nuvem), é ele quem manda a mensagem ao responsável.
 *
 * A função nunca lança: sem servidor, sem rede ou sem envio configurado ela
 * devolve o motivo e a tela volta ao rascunho manual.
 */

const TEMPO_LIMITE = 12_000;

export type ResultadoEnvio =
  | { enviado: true; destinatario: string }
  | { enviado: false; motivo: string };

export async function enviarPedidoAprovacao(
  emailMontador: string,
  painelId: string,
): Promise<ResultadoEnvio> {
  if (!URL_APROVACAO) return { enviado: false, motivo: 'envio pelo servidor desligado' };

  const cancelamento = new AbortController();
  const relogio = window.setTimeout(() => cancelamento.abort(), TEMPO_LIMITE);

  try {
    const resposta = await fetch(URL_APROVACAO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailMontador, painelId }),
      signal: cancelamento.signal,
    });

    const corpo = await resposta.json().catch(() => null);
    if (!resposta.ok || !corpo?.enviado) {
      return { enviado: false, motivo: corpo?.erro ?? `servidor respondeu ${resposta.status}` };
    }
    return { enviado: true, destinatario: String(corpo.destinatario ?? '') };
  } catch (e) {
    const motivo =
      e instanceof DOMException && e.name === 'AbortError'
        ? 'o servidor não respondeu a tempo'
        : 'não foi possível falar com o servidor';
    return { enviado: false, motivo };
  } finally {
    window.clearTimeout(relogio);
  }
}
