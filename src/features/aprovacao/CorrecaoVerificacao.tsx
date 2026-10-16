import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSessao } from '../../core/api/SessaoContexto';
import { etapaAlterada, useDecisoes } from '../../core/aprovacao/decisoes';
import { db } from '../../core/db/db';
import { MidiaRepository, PreenchimentoRepository, ProjetoRepository } from '../../core/db/repositorios';
import type { ItemNaoConforme, Projeto, Tag } from '../../core/db/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';
import { IconePdf, IconeVoltar } from '../../shared/componentes/Icones';
import { dataHoraBr } from '../../shared/utils/texto';
import { DialogoGerarPdf } from '../pdf/DialogoGerarPdf';
import { ItensApontados } from './ItensApontados';
import { EtiquetaVerificacao } from './SituacaoAprovacao';

const chaveItem = (i: ItemNaoConforme) => `${i.tagUid ?? ''}|${i.formId}|${i.etapaId}`;

/**
 * Correções de uma verificação reprovada: as etapas marcadas pela
 * administração, com o motivo, um atalho para cada uma e a indicação de quais
 * já foram alteradas. Ao terminar, o montador gera o PDF de novo — que volta
 * sozinho para a aprovação.
 */
export function CorrecaoVerificacao() {
  const { uid } = useParams();
  const navegar = useNavigate();
  const { usuario } = useSessao();
  const { decisoes, recarregar } = useDecisoes(usuario?.id);
  // Depois do reenvio, a versão nova (outro `uid`) toma o lugar da reprovada
  // na lista: a tela segue no mesmo projeto e tipo, e o diálogo fica aberto.
  const alvo = useRef<{ projeto: string; tipo: string } | null>(null);
  const pelaUid = decisoes.find((d) => d.uid === uid);
  if (pelaUid) alvo.current = { projeto: pelaUid.projeto.uid.toLowerCase(), tipo: pelaUid.tipo.id };
  const decisao =
    pelaUid ??
    (alvo.current
      ? decisoes.find(
          (d) => d.projeto.uid.toLowerCase() === alvo.current!.projeto && d.tipo.id === alvo.current!.tipo,
        )
      : undefined);

  const [projeto, setProjeto] = useState<(Projeto & { id: number }) | null | undefined>(undefined);
  const [tags, setTags] = useState<Tag[]>([]);
  const [alteradas, setAlteradas] = useState<Record<string, boolean>>({});
  const [pdfAberto, setPdfAberto] = useState(false);

  useEffect(() => {
    if (!decisao || !usuario) return;
    let ativo = true;
    (async () => {
      const local = await db.projetos
        .where('uid')
        .equals(decisao.projeto.uid)
        .filter((p) => p.usuarioId === usuario.id)
        .first();
      if (!local?.id) {
        if (ativo) setProjeto(null);
        return;
      }
      const lista = await ProjetoRepository.listarTags(local.id);
      const mapa: Record<string, boolean> = {};
      for (const item of decisao.itens) {
        const tag = lista.find((t) => t.uid?.toLowerCase() === item.tagUid?.toLowerCase());
        if (!tag?.id) continue;
        const preenchimento = await PreenchimentoRepository.obter(tag.id, item.formId);
        const midias = preenchimento?.id ? await MidiaRepository.listarPorPreenchimento(preenchimento.id) : [];
        mapa[chaveItem(item)] = etapaAlterada(item.enviado, {
          resposta: preenchimento?.respostas?.[item.etapaId],
          midias: midias.filter((m) => m.etapaId === item.etapaId).map((m) => m.uid ?? ''),
          cabecalho: preenchimento?.cabecalho ?? {},
        });
      }
      if (!ativo) return;
      setProjeto(local as Projeto & { id: number });
      setTags(lista);
      setAlteradas(mapa);
    })();
    return () => {
      ativo = false;
    };
  }, [decisao, usuario, pdfAberto]);

  if (!usuario) return null;
  if (!decisao) {
    return (
      <div className="space-y-3">
        <Erro
          titulo="Correção não encontrada"
          detalhe="Esta verificação não está mais pendente de correção, ou ainda não chegou a este aparelho."
        />
        <Botao onClick={() => navegar('/')}>Voltar ao início</Botao>
      </div>
    );
  }
  if (projeto === undefined) return <Carregando mensagem="Abrindo as correções…" />;

  const linkPara = (item: ItemNaoConforme) => {
    if (!projeto) return null;
    const tag = tags.find((t) => t.uid?.toLowerCase() === item.tagUid?.toLowerCase());
    if (!tag?.id) return null;
    return `/projetos/${projeto.id}/tags/${tag.id}/formularios/${encodeURIComponent(item.formId)}?etapa=${encodeURIComponent(item.etapaId)}`;
  };
  const faltam = decisao.itens.filter((i) => projeto && alteradas[chaveItem(i)] === false).length;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <Botao
          variante="texto"
          onClick={() => navegar(projeto ? `/projetos/${projeto.id}` : '/')}
          aria-label="Voltar"
        >
          <IconeVoltar />
        </Botao>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
            {decisao.painel.nome} · {decisao.projeto.empresa}
          </p>
          <h1 className="text-2xl font-bold break-words">{decisao.projeto.nome}</h1>
          <p className="text-base text-abb-gray">
            {decisao.tipo.rotulo} · versão {decisao.versao ?? '—'}
          </p>
          <div className="mt-2">
            <EtiquetaVerificacao estado={decisao.estado} />
          </div>
        </div>
      </div>

      {decisao.estado === 'reprovada' ? (
        <section className="space-y-3 rounded-lg border-2 border-amber-500 bg-amber-50 p-4">
          <h2 className="text-lg font-bold text-amber-900">O que corrigir</h2>
          <p className="text-base text-amber-900">
            Reprovada por {decisao.decididoPor ?? 'administração'} em {dataHoraBr(decisao.decididoEm ?? undefined)}.
            Toque em “Corrigir” para abrir a etapa. Ao terminar, gere o PDF de novo: ele volta
            sozinho para a aprovação.
          </p>
          {decisao.itens.length === 0 && !decisao.comentario ? (
            <p className="text-base">Sem etapas marcadas.</p>
          ) : null}
          <ItensApontados
            itens={decisao.itens}
            comentario={decisao.comentario}
            linkPara={linkPara}
            alterada={(item) => (projeto ? alteradas[chaveItem(item)] : undefined)}
            mostrarTag
          />
        </section>
      ) : (
        <Aviso>
          {decisao.estado === 'aguardando'
            ? `Reenviada: a versão ${decisao.versao ?? ''} aguarda a aprovação da administração.`
            : 'Esta verificação já foi decidida. Nada a corrigir aqui.'}
        </Aviso>
      )}

      {projeto === null ? (
        <Aviso>
          O projeto não está neste aparelho. Abra-o no aparelho em que foi preenchido, ou
          sincronize para trazê-lo do servidor.
        </Aviso>
      ) : decisao.estado === 'reprovada' ? (
        <div className="space-y-2 rounded-lg border border-abb-line bg-white p-4">
          <p className="text-base">
            {faltam > 0
              ? `${faltam} etapa(s) ainda sem alteração.`
              : 'Todas as etapas marcadas já foram alteradas.'}
          </p>
          <Botao variante="primario" onClick={() => setPdfAberto(true)}>
            <IconePdf className="h-5 w-5" />
            Gerar PDF e reenviar para aprovação
          </Botao>
        </div>
      ) : null}

      {projeto ? (
        <DialogoGerarPdf
          aberto={pdfAberto}
          projetoId={projeto.id}
          painelSlug={projeto.painelSlug}
          tipo={decisao.tipo.id}
          onFechar={() => {
            setPdfAberto(false);
            void recarregar();
          }}
        />
      ) : null}
    </div>
  );
}
