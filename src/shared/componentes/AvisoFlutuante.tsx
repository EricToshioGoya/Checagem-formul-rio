import { IconeCheck } from './Icones';

/** Confirmação curta de uma ação, no rodapé da tela; some sozinha. */
export function AvisoFlutuante({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-6 z-[60] mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-xl bg-abb-black px-4 py-3 text-base text-white shadow-lg motion-safe:animate-surgir"
    >
      <IconeCheck className="h-5 w-5 shrink-0 text-green-400" />
      {texto}
    </div>
  );
}
