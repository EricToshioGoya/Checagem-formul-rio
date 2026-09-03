import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variante = 'primario' | 'secundario' | 'perigo' | 'texto';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  children: ReactNode;
  larguraTotal?: boolean;
}

// Todos os alvos têm no mínimo 48 px de altura (uso com luvas).
const estilos: Record<Variante, string> = {
  primario:
    'bg-abb-red text-white hover:bg-abb-red-dark active:bg-abb-red-dark border-transparent',
  secundario:
    'bg-white text-abb-black hover:bg-neutral-100 active:bg-neutral-200 border-abb-line',
  perigo: 'bg-white text-abb-red hover:bg-red-50 active:bg-red-100 border-abb-red',
  texto: 'bg-transparent text-abb-black hover:bg-neutral-200 border-transparent',
};

export function Botao({
  variante = 'secundario',
  larguraTotal,
  className = '',
  children,
  ...resto
}: Props) {
  return (
    <button
      type="button"
      {...resto}
      className={[
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-md border px-5 text-base font-semibold',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        estilos[variante],
        larguraTotal ? 'w-full' : '',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}
