import type { Etapa, Resposta, ValorResposta } from '../../core/forms/tipos';
import { componenteDoTipo } from './campos/registro';
import { TabelaReferencia } from './TabelaReferencia';
import { CampoTexto } from '../../shared/componentes/Campos';
import { IconeAjuda, IconeCheck } from '../../shared/componentes/Icones';

interface Props {
  etapa: Etapa;
  resposta: Resposta | undefined;
  respondida: boolean;
  preenchimentoId: number;
  onAlterarValor: (valor: ValorResposta | null) => void;
  onAlterarObservacao: (texto: string) => void;
  onAbrirAjuda: () => void;
  onFotosAlteradas: () => void;
}

export function EtapaCard({
  etapa,
  resposta,
  respondida,
  preenchimentoId,
  onAlterarValor,
  onAlterarObservacao,
  onAbrirAjuda,
  onFotosAlteradas,
}: Props) {
  const Campo = componenteDoTipo(etapa.tipoResposta);
  const temApoio = (etapa.midiaApoio?.length ?? 0) > 0 || (etapa.detalhes?.length ?? 0) > 0;

  return (
    <article className="space-y-4 rounded-lg border border-abb-line bg-white p-4">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded bg-abb-black px-2 py-1 text-sm font-bold text-white">
              {etapa.id}
            </span>
            {respondida ? (
              <span className="flex items-center gap-1 text-sm font-bold text-green-700">
                <IconeCheck className="h-5 w-5" />
                Respondida
              </span>
            ) : (
              <span className="text-sm font-semibold text-abb-gray">Pendente</span>
            )}
          </div>
          {temApoio ? (
            <button
              type="button"
              onClick={onAbrirAjuda}
              aria-label={`Ver ajuda da etapa ${etapa.id}`}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-abb-line text-abb-red hover:bg-red-50"
            >
              <IconeAjuda />
            </button>
          ) : null}
        </div>

        <h3 className="text-lg leading-snug font-bold">{etapa.descricao}</h3>

        {etapa.pendenteTranscricao ? (
          <p className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Texto pendente de conferência contra o documento original.
          </p>
        ) : null}

        {etapa.detalhes?.length ? (
          <ul className="list-disc space-y-1 pl-5 text-base text-abb-black">
            {etapa.detalhes.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : null}

        {etapa.fotoObrigatoria ? (
          <p className="text-sm font-semibold text-abb-red">
            Evidência obrigatória: anexe pelo menos um arquivo para concluir esta
            etapa.
          </p>
        ) : null}

        {etapa.referencia ? (
          <p className="text-sm text-abb-gray">Referência: {etapa.referencia}</p>
        ) : null}
      </header>

      {etapa.tabelaReferencia ? <TabelaReferencia tabela={etapa.tabelaReferencia} /> : null}

      <Campo
        etapa={etapa}
        valor={resposta?.valor}
        onChange={onAlterarValor}
        preenchimentoId={preenchimentoId}
        onFotosAlteradas={onFotosAlteradas}
      />

      {etapa.observacao !== false ? (
        <CampoTexto
          id={`obs-${etapa.id}`}
          rotulo="Observação"
          multilinha
          valor={resposta?.observacao ?? ''}
          onChange={onAlterarObservacao}
          placeholder="Opcional"
        />
      ) : null}
    </article>
  );
}
