import { Link } from 'react-router-dom';
import type { ItemNaoConforme } from '../../core/db/tipos';

interface Props {
  itens: ItemNaoConforme[];
  /** Comentário geral da administração. */
  comentario?: string | null;
  /** Para onde "Corrigir" leva; nulo quando a etapa não está neste aparelho. */
  linkPara?: (item: ItemNaoConforme) => string | null;
  /** Se a etapa já foi alterada depois da reprovação; ausente quando não se sabe. */
  alterada?: (item: ItemNaoConforme) => boolean | undefined;
  /** Mostrar o nome da TAG em cada item (projeto com várias TAGs). */
  mostrarTag?: boolean;
}

/** As etapas marcadas pela administração como não conformes, com o motivo de cada uma. */
export function ItensApontados({ itens, comentario, linkPara, alterada, mostrarTag = false }: Props) {
  return (
    <div className="space-y-3">
      {comentario ? (
        <p className="rounded-md bg-white/70 p-3 text-base whitespace-pre-line">
          <span className="font-bold">Comentário da administração: </span>
          {comentario}
        </p>
      ) : null}
      {itens.length ? (
        <ul className="space-y-2">
          {itens.map((item) => {
            const link = linkPara?.(item) ?? null;
            const mudou = alterada?.(item);
            return (
              <li
                key={`${item.tagUid ?? ''}|${item.formId}|${item.etapaId}`}
                className="rounded-md border border-amber-400 bg-white p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-abb-gray">
                      {mostrarTag && item.tagNome ? `TAG ${item.tagNome} · ` : ''}
                      {item.formNome}
                    </p>
                    <p className="text-base font-bold">
                      {item.etapaCodigo}
                      {item.etapaDescricao ? ` — ${item.etapaDescricao}` : ''}
                    </p>
                    <p className="mt-1 text-base whitespace-pre-line text-amber-900">
                      <span className="font-semibold">Motivo: </span>
                      {item.motivo}
                    </p>
                    {mudou !== undefined ? (
                      <p
                        className={[
                          'mt-1 inline-block rounded px-2 py-0.5 text-sm font-semibold',
                          mudou ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900',
                        ].join(' ')}
                      >
                        {mudou ? 'Alterada desde a reprovação' : 'Ainda não alterada'}
                      </p>
                    ) : null}
                  </div>
                  {link ? (
                    <Link
                      to={link}
                      className="inline-flex min-h-12 shrink-0 items-center rounded-md bg-amber-500 px-4 text-base font-bold text-abb-black hover:bg-amber-400"
                    >
                      Corrigir
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
