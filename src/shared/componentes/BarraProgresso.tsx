interface Props {
  percentual: number;
  rotulo?: string;
  compacta?: boolean;
}

export function BarraProgresso({ percentual, rotulo, compacta }: Props) {
  const valor = Math.max(0, Math.min(100, percentual));
  return (
    <div className="w-full">
      {rotulo ? (
        <div className="mb-1 flex justify-between text-sm font-medium text-abb-gray">
          <span>{rotulo}</span>
          <span>{valor}%</span>
        </div>
      ) : null}
      <div
        className={`w-full overflow-hidden rounded-full bg-neutral-300 ${compacta ? 'h-2' : 'h-3'}`}
        role="progressbar"
        aria-valuenow={valor}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={rotulo ?? 'Progresso do preenchimento'}
      >
        <div
          className={`h-full rounded-full transition-all ${valor === 100 ? 'bg-green-600' : 'bg-abb-red'}`}
          style={{ width: `${valor}%` }}
        />
      </div>
    </div>
  );
}
