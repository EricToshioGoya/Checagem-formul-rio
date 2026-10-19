import { useEffect, useRef, useState } from 'react';
import { codigoDe } from '../../../../compartilhado/formulario';
import { ehMimeDeVideo } from '../../../../compartilhado/midias';
import { api } from '../../../core/api/cliente';
import { ID_CABECALHO } from '../../../core/aprovacao/decisoes';
import { etapaRespondida, etapaVisivel } from '../../../core/forms/progresso';
import type { DefinicaoFormulario, Etapa, MapaRespostas, Resposta, ValorGrade } from '../../../core/forms/tipos';

export interface MidiaRevisao {
  uid: string;
  mime: string;
  etapaId: string;
  ordem: number;
  /** O arquivo está no servidor; falso quando não chegou ou foi apagado antes do envio. */
  disponivel: boolean;
}

interface Props {
  definicao: DefinicaoFormulario | null;
  titulo: string;
  /** Rótulo do bloco de dados ("Dados do painel", "Dados da solicitação"). */
  rotuloCabecalho: string;
  /** Campos do bloco de dados, na ordem em que aparecem. */
  cabecalho: Array<{ id: string; rotulo: string; valor: string }>;
  respostas: MapaRespostas;
  midias: MidiaRevisao[];
  /** Etapas marcadas como não conformes → motivo. */
  marcas: Record<string, string>;
  /** Ausente: somente leitura (decisão já tomada). */
  onMarcar?: (etapaId: string, motivo: string | null) => void;
  /** Apontamentos da versão anterior, para conferir se foram corrigidos. */
  anteriores?: Record<string, string>;
}

/** Valor da resposta como texto, para a análise. */
function textoDaResposta(etapa: Etapa, resposta: Resposta | undefined): string | null {
  const valor = resposta?.valor;
  if (valor === undefined || valor === null || valor === '') return null;
  switch (etapa.tipoResposta) {
    case 'check':
    case 'check_com_foto':
      return valor === true ? 'Conferido ✓' : 'Não conferido';
    case 'numero':
      return `${String(valor).replace('.', ',')}${etapa.unidade ? ` ${etapa.unidade}` : ''}`;
    case 'texto':
    case 'selecao':
      return String(valor);
    default:
      return typeof valor === 'object' ? null : String(valor);
  }
}

function Grade({ etapa, valor }: { etapa: Etapa; valor: ValorGrade }) {
  const linhas = etapa.grade?.linhas ?? Object.keys(valor).map((id) => ({ id, rotulo: id }));
  const colunas =
    etapa.grade?.colunas ??
    Array.from(new Set(Object.values(valor).flatMap((l) => Object.keys(l ?? {})))).map((id) => ({
      id,
      rotulo: id,
      unidade: undefined as string | undefined,
    }));
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-abb-line p-1" />
            {colunas.map((c) => (
              <th key={c.id} className="border border-abb-line bg-neutral-50 p-1">
                {c.rotulo}
                {c.unidade ? ` (${c.unidade})` : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id}>
              <th className="border border-abb-line bg-neutral-50 p-1 text-left">{l.rotulo}</th>
              {colunas.map((c) => {
                const v = valor[l.id]?.[c.id];
                return (
                  <td key={c.id} className="border border-abb-line p-1 text-right">
                    {typeof v === 'number' ? String(v).replace('.', ',') : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Foto, vídeo ou PDF da etapa, baixado só quando aparece na tela. */
function Miniatura({ midia }: { midia: MidiaRevisao }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    const alvo = caixa.current;
    if (!alvo || !midia.disponivel) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisivel(true);
      return;
    }
    const observador = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) {
        setVisivel(true);
        observador.disconnect();
      }
    });
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [midia.disponivel]);

  useEffect(() => {
    if (!visivel) return;
    let ativo = true;
    let criada: string | null = null;
    api
      .baixarArquivo(`/api/admin/midias/${midia.uid}`)
      .then((blob) => {
        if (!ativo) return;
        criada = URL.createObjectURL(blob);
        setUrl(criada);
      })
      .catch(() => ativo && setFalhou(true));
    return () => {
      ativo = false;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [visivel, midia.uid]);

  const base = 'flex h-32 w-32 items-center justify-center overflow-hidden rounded-md border border-abb-line bg-neutral-50 text-center text-xs text-abb-gray';
  if (!midia.disponivel) {
    return <div className={base}>Arquivo não chegou ao servidor</div>;
  }
  if (falhou) return <div className={base}>Não foi possível abrir</div>;
  if (!url) {
    return (
      <div ref={caixa} className={base}>
        Carregando…
      </div>
    );
  }
  if (ehMimeDeVideo(midia.mime)) {
    return <video src={url} controls className="h-32 w-48 rounded-md border border-abb-line bg-black" />;
  }
  if (midia.mime === 'application/pdf') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={`${base} font-semibold text-abb-red underline`}>
        Abrir PDF anexado
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" title="Abrir em tamanho real">
      <img src={url} alt="Foto da etapa" className="h-32 w-32 rounded-md border border-abb-line object-cover" />
    </a>
  );
}

/** Marcação de não conformidade de uma etapa (ou dos dados), com o motivo. */
function Marcacao({
  id,
  motivo,
  onMarcar,
  anterior,
}: {
  id: string;
  motivo: string | undefined;
  onMarcar?: (etapaId: string, motivo: string | null) => void;
  anterior?: string;
}) {
  const marcada = motivo !== undefined;
  return (
    <div className="space-y-2">
      {anterior ? (
        <p className="rounded bg-neutral-100 px-2 py-1 text-sm text-abb-gray">
          <span className="font-semibold">Apontado na versão anterior:</span> {anterior}
        </p>
      ) : null}
      {onMarcar ? (
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-base font-semibold">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={marcada}
            onChange={(e) => onMarcar(id, e.target.checked ? '' : null)}
          />
          Não conforme
        </label>
      ) : null}
      {marcada ? (
        onMarcar ? (
          <textarea
            className={[
              'block min-h-20 w-full rounded-md border-2 p-2 text-base',
              motivo.trim() ? 'border-amber-500' : 'border-abb-red',
            ].join(' ')}
            placeholder="Descreva o problema. Ex.: a foto não está nítida."
            value={motivo}
            onChange={(e) => onMarcar(id, e.target.value)}
            aria-label="Motivo da não conformidade"
            maxLength={2000}
          />
        ) : (
          <p className="rounded-md border border-amber-500 bg-amber-50 p-2 text-base text-amber-900">
            <span className="font-semibold">Não conforme:</span> {motivo}
          </p>
        )
      ) : null}
    </div>
  );
}

/**
 * Um checklist como o montador enviou — dados, etapas, respostas,
 * observações e fotos —, com a marcação de não conformidade por etapa.
 */
export function RevisaoChecklist({
  definicao,
  titulo,
  rotuloCabecalho,
  cabecalho,
  respostas,
  midias,
  marcas,
  onMarcar,
  anteriores = {},
}: Props) {
  const porEtapa = new Map<string, MidiaRevisao[]>();
  for (const m of [...midias].sort((a, b) => a.ordem - b.ordem)) {
    porEtapa.set(m.etapaId, [...(porEtapa.get(m.etapaId) ?? []), m]);
  }
  const quantasMarcadas = Object.keys(marcas).length;

  return (
    <details open className="rounded-lg border border-abb-line bg-white">
      <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-4 py-2 text-base font-bold">
        <span className="min-w-0 break-words">{titulo}</span>
        {quantasMarcadas ? (
          <span className="shrink-0 rounded bg-amber-400 px-2 py-0.5 text-sm text-abb-black">
            {quantasMarcadas} não conforme(s)
          </span>
        ) : null}
      </summary>

      <div className="space-y-4 border-t border-abb-line p-4">
        {!definicao ? (
          <p className="text-base text-abb-red">
            O checklist deste envio não existe mais no servidor; as respostas aparecem pelo id da etapa.
          </p>
        ) : null}

        {cabecalho.length ? (
          <section
            className={[
              'space-y-2 rounded-md border p-3',
              marcas[ID_CABECALHO] !== undefined ? 'border-2 border-amber-500 bg-amber-50/40' : 'border-abb-line',
            ].join(' ')}
          >
            <h4 className="text-base font-bold">{rotuloCabecalho}</h4>
            <dl className="grid gap-x-4 gap-y-1 text-base sm:grid-cols-2">
              {cabecalho.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <dt className="shrink-0 font-semibold text-abb-gray">{c.rotulo}:</dt>
                  <dd className="min-w-0 break-words">{c.valor || '—'}</dd>
                </div>
              ))}
            </dl>
            <Marcacao
              id={ID_CABECALHO}
              motivo={marcas[ID_CABECALHO]}
              onMarcar={onMarcar}
              anterior={anteriores[ID_CABECALHO]}
            />
          </section>
        ) : null}

        {(definicao?.secoes ?? []).map((secao) => {
          const etapas = secao.etapas.filter((e) => e.ativa !== false && etapaVisivel(e, respostas));
          if (!etapas.length) return null;
          return (
            <section key={secao.id} className="space-y-2">
              <h4 className="border-b-2 border-abb-red pb-1 text-base font-bold">{secao.titulo}</h4>
              <ul className="space-y-2">
                {etapas.map((etapa) => {
                  const resposta = respostas[etapa.id];
                  const lista = porEtapa.get(etapa.id) ?? [];
                  const texto = textoDaResposta(etapa, resposta);
                  const respondida = etapaRespondida(etapa, resposta, {
                    arquivos: lista.length,
                    videos: lista.filter((m) => ehMimeDeVideo(m.mime)).length,
                  });
                  const marcada = marcas[etapa.id] !== undefined;
                  return (
                    <li
                      key={etapa.id}
                      className={[
                        'space-y-2 rounded-md border p-3',
                        marcada ? 'border-2 border-amber-500 bg-amber-50/40' : 'border-abb-line',
                      ].join(' ')}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 text-base">
                          <span className="mr-2 rounded bg-abb-black px-2 py-0.5 text-sm font-bold text-white">
                            {codigoDe(etapa)}
                          </span>
                          {etapa.descricao}
                        </p>
                        <span
                          className={[
                            'shrink-0 rounded px-2 py-0.5 text-sm font-semibold',
                            respondida ? 'bg-green-100 text-green-800' : 'bg-neutral-200 text-abb-gray',
                          ].join(' ')}
                        >
                          {respondida ? 'Respondida' : 'Sem resposta'}
                        </span>
                      </div>
                      {etapa.tipoResposta === 'grade_numerica' && resposta?.valor && typeof resposta.valor === 'object' ? (
                        <Grade etapa={etapa} valor={resposta.valor as ValorGrade} />
                      ) : texto ? (
                        <p className="text-base">
                          <span className="font-semibold text-abb-gray">Resposta: </span>
                          {texto}
                        </p>
                      ) : null}
                      {resposta?.observacao?.trim() ? (
                        <p className="text-base whitespace-pre-line">
                          <span className="font-semibold text-abb-gray">Observação: </span>
                          {resposta.observacao}
                        </p>
                      ) : null}
                      {lista.length ? (
                        <div className="flex flex-wrap gap-2">
                          {lista.map((m) => (
                            <Miniatura key={m.uid} midia={m} />
                          ))}
                        </div>
                      ) : null}
                      <Marcacao
                        id={etapa.id}
                        motivo={marcas[etapa.id]}
                        onMarcar={onMarcar}
                        anterior={anteriores[etapa.id]}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}
