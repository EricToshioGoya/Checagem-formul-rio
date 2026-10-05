import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variante = 'primario' | 'secundario' | 'perigo' | 'texto';

/**
 * `normal` mantém o alvo de 48 px exigido no chão de fábrica (uso com luvas).
 * `compacto` é para telas de mesa, como a administração, onde caber mais
 * linhas na tela vale mais que o alvo grande.
 */
type Tamanho = 'normal' | 'compacto';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
  children: ReactNode;
  larguraTotal?: boolean;
}

// Os botões claros são off-white, e não brancos: assim não se confundem com
// o fundo branco dos cartões onde ficam.
const estilos: Record<Variante, string> = {
  primario:
    'bg-abb-red text-white hover:bg-abb-red-dark active:bg-abb-red-dark border-transparent shadow-sm',
  secundario:
    'bg-abb-offwhite text-abb-black hover:bg-abb-offwhite-hover active:bg-abb-offwhite-active border-abb-line-botao',
  perigo:
    'bg-abb-offwhite text-abb-red hover:bg-red-50 active:bg-red-100 border-abb-red/60',
  texto: 'bg-transparent text-abb-black hover:bg-black/5 active:bg-black/10 border-transparent',
};

const tamanhos: Record<Tamanho, string> = {
  normal: 'min-h-12 px-5 text-base',
  compacto: 'min-h-10 px-3.5 text-sm sm:min-h-9',
};

export function Botao({
  variante = 'secundario',
  tamanho = 'normal',
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
        'inline-flex items-center justify-center gap-2 rounded-lg border font-semibold',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tamanhos[tamanho],
        estilos[variante],
        larguraTotal ? 'w-full' : '',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}
