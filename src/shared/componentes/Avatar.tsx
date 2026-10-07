// Classes escritas por extenso: o Tailwind só gera o que encontra no código.
const CORES = [
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-900',
  'bg-rose-100 text-rose-800',
  'bg-teal-100 text-teal-800',
];

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (primeira + ultima).toUpperCase();
}

/** Cor estável por pessoa: a mesma conta tem sempre a mesma cor na lista. */
function corDe(chave: string): string {
  let h = 0;
  for (const c of chave) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length];
}

export function Avatar({ nome, chave, pequeno }: { nome: string; chave: string; pequeno?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold',
        pequeno ? 'h-9 w-9 text-sm' : 'h-11 w-11 text-base',
        corDe(chave),
      ].join(' ')}
    >
      {iniciais(nome)}
    </span>
  );
}
