import { useEffect, useState } from 'react';
import {
  api,
  type ContagemAndamento,
  type DetalheAndamento as Detalhe,
  type SecaoAndamento,
} from '../../core/api/cliente';
import { plural } from '../../../compartilhado/plural';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeCheck } from '../../shared/componentes/Icones';
import { dataHoraBr } from '../../shared/utils/texto';

interface Props {
  usuarioId: number;
  projetoUid: string;
  /** Muda a cada envio do aparelho: o detalhe aberto se relê junto com a lista. */
  enviadoEm: number | null;
}

function percentual(c: ContagemAndamento): number {
  return c.total ? Math.round((c.respondidas / c.total) * 100) : 0;
}

function Contagem({ c }: { c: ContagemAndamento }) {
  const completo = c.total > 0 && c.respondidas === c.total;
  return (
    <span
      className={`shrink-0 text-xs font-semibold tabular-nums ${completo ? 'text-green-700' : 'text-abb-gray'}`}
    >
      {c.respondidas}/{c.total}
      {completo ? ' ✓' : ''}
    </span>
  );
}

function Barra({ c }: { c: ContagemAndamento }) {
  const p = percentual(c);
  return (
    <div className="h-1 overflow-hidden rounded-full bg-neutral-200" aria-hidden="true">
      <div
        className={`h-full rounded-full ${p === 100 ? 'bg-green-600' : 'bg-abb-red'}`}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

function Secao({ secao, soPendentes }: { secao: SecaoAndamento; soPendentes: boolean }) {
  const etapas = soPendentes ? secao.etapas.filter((e) => !e.respondida) : secao.etapas;
  if (soPendentes && etapas.length === 0) return null;
  return (
    <details className="group rounded-lg border border-abb-line/70 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5">
        <span
          className="text-abb-gray transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          ›
        </span>
        <span className="rounded bg-abb-black px-1.5 py-0.5 text-xs font-bold text-white">
          {secao.codigo}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{secao.titulo}</span>
        <Contagem c={secao} />
      </summary>
      <ul className="space-y-0.5 border-t border-abb-line/70 px-2.5 py-1.5">
        {etapas.map((e) => (
          <li key={e.id} className="flex items-start gap-2 py-0.5 text-sm">
            <span
              className={[
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                e.respondida ? 'border-green-600 bg-green-600 text-white' : 'border-abb-gray',
              ].join(' ')}
              aria-label={e.respondida ? 'Concluída' : 'Pendente'}
              role="img"
            >
              {e.respondida ? <IconeCheck className="h-3 w-3" /> : null}
            </span>
            <span className="shrink-0 font-semibold">{e.codigo}</span>
            <span className={`min-w-0 flex-1 ${e.respondida ? '' : 'text-abb-gray'}`}>
              {e.descricao}
            </span>
            {e.fotos ? (
              <span className="shrink-0 text-xs text-abb-gray">
                {plural(e.fotos, 'arquivo', 'arquivos')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * O que um montador já concluiu num projeto, seção por seção e etapa por
 * etapa — do último envio do aparelho dele.
 */
export function DetalheAndamento({ usuarioId, projetoUid, enviadoEm }: Props) {
  const [dados, setDados] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [soPendentes, setSoPendentes] = useState(false);

  useEffect(() => {
    let vivo = true;
    api
      .get<Detalhe>(`/api/andamento/${usuarioId}/${encodeURIComponent(projetoUid)}`)
      .then((d) => {
        if (!vivo) return;
        setDados(d);
        setErro(null);
      })
      .catch((e) => {
        if (vivo) setErro(e instanceof Error ? e.message : 'Não foi possível ler o detalhe.');
      });
    return () => {
      vivo = false;
    };
  }, [usuarioId, projetoUid, enviadoEm]);

  if (erro) return <Erro detalhe={erro} />;
  if (!dados) return <Carregando mensagem="Lendo o detalhe do projeto…" />;
  if (dados.tags.length === 0) {
    return <p className="text-sm text-abb-gray">Este projeto ainda não tem TAGs.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-abb-gray">
          Último envio do aparelho: {dataHoraBr(dados.enviadoEm)}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={soPendentes}
            onChange={(e) => setSoPendentes(e.target.checked)}
          />
          Só pendentes
        </label>
      </div>

      {dados.tags.map((tag) => (
        <section
          key={tag.uid}
          className="space-y-2 rounded-lg border border-abb-line bg-neutral-50 p-2.5"
        >
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="min-w-0 truncate text-sm font-bold">TAG {tag.nome}</h4>
              <Contagem c={tag} />
            </div>
            <Barra c={tag} />
          </div>

          {tag.checklists.length === 0 ? (
            <p className="text-sm text-abb-gray">Nenhum checklist ativo escolhido para esta TAG.</p>
          ) : (
            tag.checklists.map((c) => (
              <div key={c.formId} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm">
                    <span className="font-semibold">{c.tipo}</span>
                    <span className="text-abb-gray"> · {c.nome}</span>
                  </p>
                  <Contagem c={c} />
                </div>
                {soPendentes && c.respondidas === c.total && c.total > 0 ? (
                  <p className="text-sm text-green-700">
                    Tudo concluído ({plural(c.total, 'etapa', 'etapas')}).
                  </p>
                ) : (
                  c.secoes.map((s) => <Secao key={s.id} secao={s} soPendentes={soPendentes} />)
                )}
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
