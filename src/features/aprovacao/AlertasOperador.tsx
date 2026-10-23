import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSessao } from '../../core/api/SessaoContexto';
import { lerCatalogoPaineis } from '../../core/api/acessoLocal';
import {
  ehCertificado,
  rotuloDaDecisao,
  chaveDecisao,
  lerVistas,
  marcarVistas,
  reprovadas as reprovadasDe,
  useDecisoes,
} from '../../core/aprovacao/decisoes';
import { atualizarSolicitacoesDoServidor, solicitacaoStore } from '../../core/certificacao';
import { PdfPendenteRepository } from '../../core/db/repositorios';
import type { PdfPendente, Solicitacao } from '../../core/db/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { Modal } from '../../shared/componentes/Modal';
import { dataHoraBr } from '../../shared/utils/texto';
import { CertificadosAnexados } from '../solicitacoes/CertificadosAnexados';
import { BaixarCertificado } from './BaixarCertificado';

interface Novidade {
  chave: string;
  tom: 'correcao' | 'aprovada';
  titulo: string;
  detalhe: string;
  /** Atalho do pop-up; ausente quando a novidade já está à vista na tela inicial. */
  link?: string;
  rotuloLink?: string;
}

const nomeDoPainel = (slug: string) => lerCatalogoPaineis()[slug]?.nome ?? slug;

/**
 * O que a administração decidiu, na tela inicial do montador:
 * - alerta amarelo com cada verificação reprovada e cada solicitação
 *   devolvida, com o atalho para corrigir;
 * - os certificados aprovados, para baixar;
 * - um pop-up, uma vez por decisão, com as novidades.
 */
export function AlertasOperador() {
  const { usuario } = useSessao();
  const { decisoes } = useDecisoes(usuario?.id);
  const [vistas, setVistas] = useState<Set<string>>(() => (usuario ? lerVistas(usuario.id) : new Set()));

  useEffect(() => {
    if (usuario) void atualizarSolicitacoesDoServidor(usuario.id);
  }, [usuario]);

  const solicitacoes = useLiveQuery(
    () => (usuario ? solicitacaoStore.listar({ usuarioId: usuario.id }) : Promise.resolve([] as Solicitacao[])),
    [usuario?.id],
    [] as Solicitacao[],
  );

  // PDFs gerados sem rede cujo envio o servidor recusou depois (ex.: o
  // checklist ganhou uma etapa): sem isto, o pedido sumiria em silêncio.
  const recusados = useLiveQuery(
    async () =>
      usuario ? (await PdfPendenteRepository.listar(usuario.id)).filter((p) => p.recusa) : ([] as PdfPendente[]),
    [usuario?.id],
    [] as PdfPendente[],
  );

  const reprovadas = reprovadasDe(decisoes);
  const devolvidas = solicitacoes.filter((s) => s.estado === 'devolvida');
  const comCertificado = solicitacoes.filter(
    (s) => (s.estado === 'aprovada' || s.estado === 'emitida') && s.numeroCertificado,
  );
  // Checklists que contêm certificado, aprovados: o certificado emitido.
  const emitidos = decisoes.filter((d) => ehCertificado(d) && d.estado === 'aprovada' && d.certificado?.numero);

  const novidades = useMemo<Novidade[]>(() => {
    const lista: Novidade[] = [];
    for (const d of decisoes) {
      if (d.estado !== 'reprovada' && d.estado !== 'aprovada') continue;
      const chave = chaveDecisao('verificacao', d.uid, d.estado, d.decididoEm);
      if (vistas.has(chave)) continue;
      lista.push(
        d.estado === 'reprovada'
          ? {
              chave,
              tom: 'correcao',
              titulo: `Correção pedida — ${d.projeto.nome}`,
              detalhe: `${rotuloDaDecisao(d)}: ${d.itens.length} etapa(s) a corrigir.${d.comentario ? ` ${d.comentario}` : ''}`,
              link: `/correcoes/${d.uid}`,
              rotuloLink: 'Corrigir agora',
            }
          : ehCertificado(d)
            ? {
                chave,
                tom: 'aprovada',
                titulo: `Certificado nº ${d.certificado?.numero ?? ''} emitido`,
                detalhe: `${d.tipo.rotulo} · TAG ${d.tags[0] ?? ''} · ${d.projeto.nome}${d.decididoPor ? `, aprovado por ${d.decididoPor}` : ''}. Baixe na tela inicial, em "Certificados aprovados".`,
              }
            : {
              chave,
              tom: 'aprovada',
              titulo: `Verificação aprovada — ${d.projeto.nome}`,
              detalhe: `${d.tipo.rotulo}, versão ${d.versao ?? '—'}${d.decididoPor ? `, por ${d.decididoPor}` : ''}.`,
              link: '/projetos',
              rotuloLink: 'Ver projetos',
            },
      );
    }
    for (const s of solicitacoes) {
      if (s.estado !== 'devolvida' && s.estado !== 'aprovada') continue;
      // O instante da decisão, e não o da última edição: corrigir os dados
      // não traz o pop-up de volta.
      const decididaEm = [...s.historico].reverse().find((e) => e.estado === s.estado)?.em ?? null;
      const chave = chaveDecisao('certificacao', s.uid ?? String(s.id), s.estado, decididaEm);
      if (vistas.has(chave)) continue;
      lista.push(
        s.estado === 'devolvida'
          ? {
              chave,
              tom: 'correcao',
              titulo: `Solicitação devolvida — ${s.dados.tagPainel || nomeDoPainel(s.tipoPainel)}`,
              detalhe: `${(s.itens ?? []).length} etapa(s) a corrigir.${s.apontamentos ? ` ${s.apontamentos}` : ''}`,
              link: `/solicitacoes/${s.id}`,
              rotuloLink: 'Corrigir agora',
            }
          : {
              chave,
              tom: 'aprovada',
              titulo: `Certificado nº ${s.numeroCertificado} disponível`,
              detalhe: `${nomeDoPainel(s.tipoPainel)}${s.dados.tagPainel ? ` — TAG ${s.dados.tagPainel}` : ''}. Baixe na tela inicial.`,
              link: `/solicitacoes/${s.id}`,
              rotuloLink: 'Abrir solicitação',
            },
      );
    }
    return lista;
  }, [decisoes, solicitacoes, vistas]);

  const fecharPopup = () => {
    if (usuario) marcarVistas(usuario.id, novidades.map((n) => n.chave));
    setVistas(usuario ? lerVistas(usuario.id) : new Set());
  };

  if (!usuario) return null;

  return (
    <>
      {reprovadas.length || devolvidas.length ? (
        <section
          className="space-y-3 rounded-lg border-2 border-amber-500 bg-amber-300 p-4 shadow-md"
          role="alert"
          aria-label="Correções pedidas pela administração"
        >
          <h2 className="text-xl font-bold text-abb-black">
            ⚠ A administração pediu correções ({reprovadas.length + devolvidas.length})
          </h2>
          <ul className="space-y-2">
            {reprovadas.map((d) => (
              <li key={d.uid} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 p-3">
                <span className="min-w-0 text-base">
                  <span className="block font-bold">
                    {d.projeto.nome} · {rotuloDaDecisao(d)}
                  </span>
                  <span className="text-sm text-amber-900">
                    {d.painel.nome} · {d.itens.length} etapa(s) a corrigir · reprovada em{' '}
                    {dataHoraBr(d.decididoEm ?? undefined)}
                  </span>
                </span>
                <Link
                  to={`/correcoes/${d.uid}`}
                  className="inline-flex min-h-12 items-center rounded-md bg-abb-black px-4 text-base font-bold text-white hover:bg-neutral-800"
                >
                  Corrigir
                </Link>
              </li>
            ))}
            {devolvidas.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 p-3">
                <span className="min-w-0 text-base">
                  <span className="block font-bold">
                    Certificação · {s.dados.tagPainel || 'Sem TAG'}
                  </span>
                  <span className="text-sm text-amber-900">
                    {nomeDoPainel(s.tipoPainel)} · {(s.itens ?? []).length} etapa(s) a corrigir · devolvida em{' '}
                    {dataHoraBr(s.atualizadoEm)}
                  </span>
                </span>
                <Link
                  to={`/solicitacoes/${s.id}`}
                  className="inline-flex min-h-12 items-center rounded-md bg-abb-black px-4 text-base font-bold text-white hover:bg-neutral-800"
                >
                  Corrigir
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recusados.length ? (
        <section
          className="space-y-3 rounded-lg border-2 border-abb-red bg-red-50 p-4"
          aria-label="Envios recusados pelo servidor"
        >
          <h2 className="text-lg font-bold text-abb-red">Envios recusados pelo servidor ({recusados.length})</h2>
          <ul className="space-y-2">
            {recusados.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white p-3">
                <p className="min-w-0 text-base">
                  <span className="block font-bold break-all">{p.nomeArquivo}</span>
                  <span className="text-sm text-abb-gray">{p.recusa}</span>
                  {p.aprovacao?.certificado ? (
                    <span className="block text-sm text-abb-gray">
                      Sincronize na tela de painéis, confira o checklist e gere o PDF dele de novo para pedir o
                      certificado.
                    </span>
                  ) : null}
                </p>
                <Botao tamanho="compacto" onClick={() => void PdfPendenteRepository.remover(p.id!)}>
                  Dispensar
                </Botao>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {comCertificado.length || emitidos.length ? (
        <section
          className="space-y-3 rounded-lg border-2 border-green-600 bg-green-50 p-4"
          aria-label="Certificados disponíveis"
        >
          <h2 className="text-lg font-bold text-green-800">Certificados aprovados</h2>
          <ul className="space-y-3">
            {emitidos.map((d) => (
              <li key={d.uid} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white p-3">
                <p className="min-w-0 text-base">
                  <span className="block font-bold">Certificado nº {d.certificado?.numero}</span>
                  <span className="text-sm text-abb-gray">
                    {d.tipo.rotulo} · TAG {d.tags[0] ?? ''} · {d.projeto.nome} · {d.painel.nome} · emitido em{' '}
                    {dataHoraBr(d.decididoEm ?? undefined)}
                  </span>
                </p>
                <BaixarCertificado decisao={d} />
              </li>
            ))}
            {comCertificado.map((s) => (
              <li key={s.id} className="space-y-2 rounded-md bg-white p-3">
                <p className="text-base">
                  <span className="font-bold">Certificado nº {s.numeroCertificado}</span> ·{' '}
                  {nomeDoPainel(s.tipoPainel)}
                  {s.dados.tagPainel ? ` · TAG ${s.dados.tagPainel}` : ''}
                </p>
                <CertificadosAnexados solicitacao={s} por={usuario.nome} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Modal
        aberto={novidades.length > 0}
        titulo="Novidades da administração"
        onFechar={fecharPopup}
        rodape={
          <Botao variante="primario" onClick={fecharPopup}>
            Entendi
          </Botao>
        }
      >
        <ul className="space-y-3">
          {novidades.map((n) => (
            <li
              key={n.chave}
              className={[
                'space-y-2 rounded-md border-2 p-3',
                n.tom === 'correcao' ? 'border-amber-500 bg-amber-50' : 'border-green-600 bg-green-50',
              ].join(' ')}
            >
              <p className={`text-base font-bold ${n.tom === 'correcao' ? 'text-amber-900' : 'text-green-800'}`}>
                {n.titulo}
              </p>
              <p className="text-base whitespace-pre-line">{n.detalhe}</p>
              {n.link ? (
                <Link
                  to={n.link}
                  onClick={fecharPopup}
                  className="inline-flex min-h-12 items-center rounded-md border border-abb-line-botao bg-white px-4 text-base font-semibold hover:bg-abb-offwhite-hover"
                >
                  {n.rotuloLink}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
