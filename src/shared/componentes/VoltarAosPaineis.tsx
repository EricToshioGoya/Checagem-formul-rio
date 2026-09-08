import { Link } from 'react-router-dom';
import { IconeVoltar } from './Icones';

/**
 * Volta à escolha do tipo de painel, a partir do topo de qualquer fluxo.
 *
 * Fica acima do título, com rótulo visível: uma seta solta passava
 * despercebida no desktop, e trocar de painel é a única saída dali.
 */
export function VoltarAosPaineis({ rotulo = 'Trocar tipo de painel' }: { rotulo?: string }) {
  return (
    <Link
      to="/"
      className="inline-flex min-h-12 items-center gap-1 rounded-md pr-3 text-base font-semibold text-abb-red hover:bg-red-50"
    >
      <IconeVoltar />
      {rotulo}
    </Link>
  );
}
