import type { SituacaoRegistro } from '../../core/sync/arquivoPdfs';
import { plural } from '../../../compartilhado/plural';

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
          <span className="text-base">
            Fotos incorporadas ao PDF
            <span className="block text-sm text-abb-gray">
              Vídeos não cabem no PDF: se houver, seguem num ZIP à parte.
            </span>
          </span>
        </label>
        <label className={opcao}>
          <input
            type="radio"
            name="fotos"
            className="h-6 w-6"
            checked={!incluirFotos}
            onChange={() => onChange(false)}
          />
          <span className="text-base">PDF sem fotos + arquivo ZIP separado com as fotos e os vídeos</span>
        </label>
      </div>
    </fieldset>
  );
}

/** `null` enquanto envia; ausente quando não há conta para registrar. */
export type EstadoRegistro = SituacaoRegistro | null | undefined;

function textoRegistro(registro: SituacaoRegistro | null): string {
  if (registro === null) return 'Guardando no arquivo da ABB…';
  if (registro.recusas.length) return `O arquivo da ABB recusou o PDF: ${registro.recusas[0]}`;
  if (registro.pendentes) {
    return registro.paraAprovacao
      ? `Sem conexão com o servidor: ${plural(registro.pendentes, 'PDF será guardado', 'PDFs serão guardados')} no arquivo da ABB e ${registro.pendentes === 1 ? 'enviado' : 'enviados'} para aprovação na próxima sincronização.`
      : `Sem conexão com o servidor: ${plural(registro.pendentes, 'PDF será guardado', 'PDFs serão guardados')} no arquivo da ABB na próxima sincronização.`;
  }
  return registro.paraAprovacao
    ? 'Guardado no arquivo da ABB e enviado à administração para aprovação. Você será avisado da decisão na tela inicial.'
    : 'Guardado no arquivo da ABB.';
}

export function ArquivosGerados({ nomes, registro }: { nomes: string[]; registro?: EstadoRegistro }) {
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
      {registro?.paraAprovacao ? null : (
        <p className="mt-2 text-sm text-abb-gray">Envie o PDF por e-mail ao inspetor da ABB.</p>
      )}
      {registro !== undefined ? (
        <p className="mt-1 text-sm text-abb-gray" role="status">
          {textoRegistro(registro)}
        </p>
      ) : null}
    </div>
  );
}
