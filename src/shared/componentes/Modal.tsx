import { useEffect, useRef, type ReactNode } from 'react';
import { IconeFechar } from './Icones';

interface Props {
  aberto: boolean;
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
  largura?: 'normal' | 'larga';
}

export function Modal({
  aberto,
  titulo,
  onFechar,
  children,
  rodape,
  largura = 'normal',
}: Props) {
  const caixaRef = useRef<HTMLDivElement>(null);
  // `onFechar` costuma chegar como função nova a cada desenho da tela de fora.
  // Com ele nas dependências do efeito abaixo, cada tecla digitada num campo
  // do modal redesenhava a tela, o efeito rodava de novo e devolvia o foco à
  // caixa: só o primeiro caractere entrava. A referência mantém o efeito
  // preso só à abertura.
  const fecharRef = useRef(onFechar);
  useEffect(() => {
    fecharRef.current = onFechar;
  });

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fecharRef.current();
    };
    document.addEventListener('keydown', aoTeclar);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Um campo com foco automático dentro do modal fica com o foco.
    if (!caixaRef.current?.contains(document.activeElement)) caixaRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = anterior;
    };
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div
        ref={caixaRef}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        className={[
          'flex max-h-[92vh] w-full flex-col rounded-t-xl bg-white shadow-xl outline-none sm:rounded-xl',
          largura === 'larga' ? 'sm:max-w-4xl' : 'sm:max-w-xl',
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-3 border-b border-abb-line px-4 py-3">
          <h2 className="text-lg font-bold">{titulo}</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="flex h-12 w-12 items-center justify-center rounded-md text-abb-gray hover:bg-neutral-100"
          >
            <IconeFechar />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {rodape ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-abb-line px-4 py-3">
            {rodape}
          </div>
        ) : null}
      </div>
    </div>
  );
}
