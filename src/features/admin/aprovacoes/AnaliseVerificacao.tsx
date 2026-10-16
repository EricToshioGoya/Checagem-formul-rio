import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../core/api/cliente';
import {
  decidirVerificacao,
  obterVerificacao,
  type DetalheVerificacaoAdmin,
  type MarcaNaoConforme,
} from '../../../core/aprovacao/admin';
import { Botao } from '../../../shared/componentes/Botao';
import { Carregando, Erro } from '../../../shared/componentes/Estado';
import { IconePdf, IconeVoltar } from '../../../shared/componentes/Icones';
import { baixarBlob } from '../../../shared/utils/download';
import { dataHoraBr, formatarBytes } from '../../../shared/utils/texto';
import { EtiquetaVerificacao } from '../../aprovacao/SituacaoAprovacao';
import { sessaoAdminAcabou } from '../sessaoAdmin';
import { RevisaoChecklist } from './RevisaoChecklist';
import { PainelDecisao } from './PainelDecisao';

const chave = (tagUid: string, formId: string, etapaId: string) => `${tagUid.toLowerCase()}|${formId}|${etapaId}`;

/**
 * Análise de um PDF de verificação enviado para aprovação: o retrato das
 * respostas e das fotos do momento da geração, TAG a TAG. A administração
 * marca as etapas não conformes, com o motivo, e aprova ou reprova.
 */
export function AnaliseVerificacao({
  id,
  onVoltar,
  onDecidido,
  onSessaoVencida,
}: {
  id: number;
  onVoltar: () => void;
  onDecidido: (mensagem: string) => void;
  onSessaoVencida: () => void;
}) {
  const [detalhe, setDetalhe] = useState<DetalheVerificacaoAdmin | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [marcas, setMarcas] = useState<Record<string, string>>({});
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    let ativo = true;
    setDetalhe(null);
    setMarcas({});
    obterVerificacao(id)
      .then((d) => ativo && setDetalhe(d))
      .catch((e) => {
        if (!ativo) return;
        if (sessaoAdminAcabou(e)) onSessaoVencida();
        else setErro(e instanceof Error ? e.message : 'Não foi possível abrir o envio.');
      });
    return () => {
      ativo = false;
    };
  }, [id, onSessaoVencida]);

  /** Apontamentos da última versão reprovada antes desta, para conferir a correção. */
  const anteriores = useMemo(() => {
    const mapa: Record<string, string> = {};
    if (!detalhe) return mapa;
    const atual = detalhe.verificacao.versao ?? Infinity;
    const reprovada = detalhe.versoes.find((v) => v.estado === 'reprovada' && (v.versao ?? 0) < atual);
    for (const item of reprovada?.itens ?? []) {
      if (item.tagUid) mapa[chave(item.tagUid, item.formId, item.etapaId)] = item.motivo;
    }
    return mapa;
  }, [detalhe]);

  if (erro && !detalhe) {
    return (
      <div className="space-y-3">
        <Erro detalhe={erro} />
        <Botao onClick={onVoltar}>Voltar à fila</Botao>
      </div>
    );
  }
  if (!detalhe) return <Carregando mensagem="Abrindo o envio…" />;

  const { verificacao: v, definicoes, midias, versoes, pdf } = detalhe;
  const decidivel = v.estado === 'aguardando';
  const marcasGravadas: Record<string, string> = {};
  for (const item of v.itens) {
    if (item.tagUid) marcasGravadas[chave(item.tagUid, item.formId, item.etapaId)] = item.motivo;
  }
  const marcasVisiveis = decidivel ? marcas : marcasGravadas;
  const tags = [...v.documento.tags].sort((a, b) => a.ordem - b.ordem);

  const baixarPdf = async () => {
    if (!pdf) return;
    setBaixando(true);
    try {
      baixarBlob(await api.baixarArquivo(`/api/admin/pdfs/${pdf.uid}/arquivo`), pdf.nomeArquivo);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível baixar o PDF.');
    } finally {
      setBaixando(false);
    }
  };

  const decidir = async (decisao: 'aprovada' | 'reprovada', comentario: string) => {
    const itens: MarcaNaoConforme[] = Object.entries(marcas).map(([k, motivo]) => {
      const [tagUid, formId, etapaId] = k.split('|');
      return { tagUid, formId, etapaId, motivo: motivo.trim() };
    });
    try {
      await decidirVerificacao(id, decisao, comentario, decisao === 'aprovada' ? [] : itens);
      onDecidido(
        decisao === 'aprovada'
          ? `Verificação de ${v.tipo.rotulo} do projeto ${v.projeto.nome} aprovada.`
          : `Verificação reprovada: ${v.montador.nome} foi avisado para corrigir ${itens.length} etapa(s).`,
      );
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else throw e;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Botao variante="texto" onClick={onVoltar} aria-label="Voltar à fila">
          <IconeVoltar />
        </Botao>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
            {v.painel.nome} · {v.projeto.empresa}
          </p>
          <h2 className="text-2xl font-bold break-words">{v.projeto.nome}</h2>
          <p className="text-base text-abb-gray">
            {v.tipo.rotulo} · versão {v.versao ?? '—'} · {v.montador.nome} ({v.montador.email})
          </p>
          <p className="text-sm text-abb-gray">
            PDF gerado em {dataHoraBr(v.geradoEm)} · enviado em {dataHoraBr(v.enviadoEm ?? undefined)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <EtiquetaVerificacao estado={v.estado} />
            {pdf ? (
              <Botao tamanho="compacto" disabled={baixando} onClick={() => void baixarPdf()}>
                <IconePdf className="h-5 w-5" />
                {baixando ? 'Baixando…' : `Baixar o PDF enviado (${formatarBytes(pdf.tamanho)})`}
              </Botao>
            ) : null}
          </div>
        </div>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      {!decidivel ? (
        <div className="rounded-lg border border-abb-line bg-white p-4 text-base">
          {v.estado === 'substituida' ? (
            <p>Esta versão foi substituída por uma mais nova antes da decisão. Analise a versão atual.</p>
          ) : (
            <>
              <p>
                <span className="font-bold">{v.estado === 'aprovada' ? 'Aprovada' : 'Reprovada'}</span> por{' '}
                {v.decididoPor ?? '—'} em {dataHoraBr(v.decididoEm ?? undefined)}.
              </p>
              {v.comentario ? <p className="mt-1 whitespace-pre-line">Comentário: {v.comentario}</p> : null}
            </>
          )}
        </div>
      ) : null}

      {versoes.length > 1 ? (
        <details className="rounded-lg border border-abb-line bg-white">
          <summary className="min-h-12 cursor-pointer px-4 py-3 text-base font-bold">
            Versões deste projeto e tipo ({versoes.length})
          </summary>
          <ul className="divide-y divide-abb-line border-t border-abb-line">
            {versoes.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-base">
                <span>
                  Versão {x.versao} · enviada em {dataHoraBr(x.enviadoEm ?? undefined)}
                  {x.decididoEm ? ` · decidida em ${dataHoraBr(x.decididoEm)} por ${x.decididoPor ?? '—'}` : ''}
                  {x.itens.length ? ` · ${x.itens.length} etapa(s) apontada(s)` : ''}
                </span>
                <EtiquetaVerificacao estado={x.estado} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {tags.map((tag) =>
        (tag.formIds ?? []).map((formId) => {
          const definicao = definicoes[formId] ?? null;
          const preenchimento = v.documento.preenchimentos.find(
            (p) => p.tagUid.toLowerCase() === tag.uid.toLowerCase() && p.formId === formId,
          );
          const cab = preenchimento?.cabecalho ?? {};
          const campos = definicao
            ? definicao.cabecalho.map((c) => ({ id: c.id, rotulo: c.rotulo, valor: cab[c.id] ?? '' }))
            : Object.entries(cab).map(([k, valor]) => ({ id: k, rotulo: k, valor }));
          const prefixo = `${tag.uid.toLowerCase()}|${formId}|`;
          const doPrefixo = (mapa: Record<string, string>) =>
            Object.fromEntries(
              Object.entries(mapa)
                .filter(([k]) => k.startsWith(prefixo))
                .map(([k, m]) => [k.slice(prefixo.length), m]),
            );
          return (
            <RevisaoChecklist
              key={`${tag.uid}|${formId}`}
              definicao={definicao}
              titulo={`TAG ${tag.nome} — ${definicao?.nome ?? formId}`}
              rotuloCabecalho="Dados do painel"
              cabecalho={campos}
              respostas={preenchimento?.respostas ?? {}}
              midias={midias
                .filter((m) => m.tagUid?.toLowerCase() === tag.uid.toLowerCase() && m.formId === formId)
                .map((m) => ({ ...m, disponivel: m.situacao === 'recebida' }))}
              marcas={doPrefixo(marcasVisiveis)}
              anteriores={doPrefixo(anteriores)}
              onMarcar={
                decidivel
                  ? (etapaId, motivo) =>
                      setMarcas((atual) => {
                        const proximo = { ...atual };
                        const k = chave(tag.uid, formId, etapaId);
                        if (motivo === null) delete proximo[k];
                        else proximo[k] = motivo;
                        return proximo;
                      })
                  : undefined
              }
            />
          );
        }),
      )}

      {decidivel ? (
        <PainelDecisao
          marcadas={Object.keys(marcas).length}
          semMotivo={Object.values(marcas).filter((m) => !m.trim()).length}
          rotuloAprovar="Aprovar"
          rotuloReprovar="Reprovar e pedir correção"
          onDecidir={decidir}
        />
      ) : null}
    </div>
  );
}
