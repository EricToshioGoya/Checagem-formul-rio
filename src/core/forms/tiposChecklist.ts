import {
  registrarTiposChecklist,
  type TipoChecklistApi,
} from '../../../compartilhado/tiposChecklist';

/**
 * Nomes dos tipos de checklist no aparelho.
 *
 * Os tipos são cadastrados pela administração e chegam com a lista de
 * painéis. A cópia fica guardada para as telas e o PDF mostrarem o nome certo
 * também sem rede, dentro do galpão.
 */

const CHAVE = 'tipos-checklist';

/** Registra os tipos recebidos do servidor e guarda a cópia no aparelho. */
export function guardarTiposChecklist(lista: readonly TipoChecklistApi[] | undefined): void {
  if (!lista) return;
  registrarTiposChecklist(lista);
  try {
    localStorage.setItem(CHAVE, JSON.stringify(lista.map(({ id, rotulo }) => ({ id, rotulo }))));
  } catch {
    // Armazenamento bloqueado: sem rede, valem os nomes derivados do id.
  }
}

/** Registra a cópia guardada; chamado uma vez, na abertura da aplicação. */
export function carregarTiposGuardados(): void {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE) ?? '[]') as unknown;
    if (Array.isArray(lista)) {
      registrarTiposChecklist(
        lista.filter(
          (t): t is TipoChecklistApi =>
            typeof t?.id === 'string' && typeof t?.rotulo === 'string',
        ),
      );
    }
  } catch {
    // Cópia ilegível: valem os nomes derivados do id até a próxima conexão.
  }
}
