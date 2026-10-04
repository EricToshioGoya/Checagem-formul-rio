import type { EstadoSolicitacao } from '../../core/db/tipos';
import { ROTULO_ESTADO } from '../../core/certificacao';

const ESTILOS: Record<EstadoSolicitacao, string> = {
  rascunho: 'border-abb-line bg-neutral-100 text-abb-gray',
  enviada: 'border-blue-500 bg-blue-50 text-blue-800',
  devolvida: 'border-amber-500 bg-amber-50 text-amber-900',
  aprovada: 'border-green-600 bg-green-50 text-green-800',
  emitida: 'border-green-700 bg-green-700 text-white',
};

/** Etiqueta do estado da solicitação, com a mesma leitura em todas as telas. */
export function EtiquetaEstado({ estado }: { estado: EstadoSolicitacao }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-sm font-semibold ${ESTILOS[estado]}`}
    >
      {ROTULO_ESTADO[estado]}
    </span>
  );
}
