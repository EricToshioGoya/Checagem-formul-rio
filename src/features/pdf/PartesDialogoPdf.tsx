/** Peças comuns aos diálogos de geração de PDF: do projeto e de um checklist. */

const opcao =
  'flex min-h-12 items-center gap-3 rounded-md border border-abb-line-botao bg-abb-offwhite px-3 hover:bg-abb-offwhite-hover';

export function EscolhaFotos({
  incluirFotos,
  onChange,
}: {
  incluirFotos: boolean;
  onChange: (incluirFotos: boolean) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-base font-bold">Fotos</legend>
      <div className="space-y-2">
        <label className={opcao}>
          <input
            type="radio"
            name="fotos"
            className="h-6 w-6"
            checked={incluirFotos}
            onChange={() => onChange(true)}
          />
          <span className="text-base">Fotos incorporadas ao PDF</span>
        </label>
        <label className={opcao}>
          <input
            type="radio"
            name="fotos"
            className="h-6 w-6"
            checked={!incluirFotos}
            onChange={() => onChange(false)}
          />
          <span className="text-base">PDF sem fotos + arquivo ZIP separado com as imagens</span>
        </label>
      </div>
    </fieldset>
  );
}

export function ArquivosGerados({ nomes }: { nomes: string[] }) {
  return (
    <div className="rounded-md border border-green-600 bg-green-50 p-3 text-base">
      <p className="font-bold text-green-800">Arquivos gerados:</p>
      <ul className="mt-1 list-disc pl-5">
        {nomes.map((n) => (
          <li key={n} className="break-all">
            {n}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-abb-gray">Envie o PDF por e-mail ao inspetor da ABB.</p>
    </div>
  );
}
