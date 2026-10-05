import type { EntradaCatalogo } from '../../core/forms/tipos';

interface Props {
  checklists: EntradaCatalogo[];
  selecionados: string[];
  onChange: (selecionados: string[]) => void;
}

/**
 * Checklists do painel que a TAG vai preencher. Nem toda TAG passa por todos:
 * o montador marca só os que valem para ela.
 */
export function EscolhaChecklists({ checklists, selecionados, onChange }: Props) {
  return (
    <fieldset>
      <legend className="mb-2 text-base font-bold">Checklists a preencher</legend>
      <div className="space-y-2">
        {checklists.map((c) => (
          <label
            key={c.id}
            className="flex min-h-12 items-center gap-3 rounded-md border border-abb-line-botao bg-abb-offwhite px-3 py-2 hover:bg-abb-offwhite-hover"
          >
            <input
              type="checkbox"
              className="h-6 w-6 shrink-0"
              checked={selecionados.includes(c.id)}
              onChange={(ev) =>
                onChange(
                  ev.target.checked
                    ? [...selecionados, c.id]
                    : selecionados.filter((id) => id !== c.id),
                )
              }
            />
            <span>
              <span className="block text-base font-semibold">
                {c.tipo === 'montagem' ? 'Montagem' : 'Rotina'}
              </span>
              <span className="block text-sm text-abb-gray">{c.nome}</span>
            </span>
          </label>
        ))}
      </div>
      {selecionados.length === 0 ? (
        <p className="mt-2 text-sm text-abb-red">Marque ao menos um checklist.</p>
      ) : null}
    </fieldset>
  );
}
