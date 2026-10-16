import { useEffect, useState } from 'react';
import {
  devolverCertificacao,
  enviarCertificado,
  obterCertificacao,
  TIPOS_CERTIFICADO,
  type DetalheCertificacaoAdmin,
} from '../../../core/aprovacao/admin';
import { camposDoPainel } from '../../../core/paineis/catalogo';
import type { CampoCabecalho } from '../../../core/forms/tipos';
import { Botao } from '../../../shared/componentes/Botao';
import { Carregando, Erro } from '../../../shared/componentes/Estado';
import { IconeVoltar } from '../../../shared/componentes/Icones';
import { dataHoraBr, formatarBytes } from '../../../shared/utils/texto';
import { EtiquetaEstado } from '../../solicitacoes/estado';
import { ROTULO_ESTADO } from '../../../core/certificacao';
import type { EstadoSolicitacao } from '../../../core/db/tipos';
import { sessaoAdminAcabou } from '../sessaoAdmin';
import { PainelDecisao } from './PainelDecisao';
import { RevisaoChecklist } from './RevisaoChecklist';

const TAMANHO_MAXIMO = 25 * 1024 * 1024;

/**
 * Análise de uma solicitação de certificação: dados, checklist e fotos. Para
 * aprovar, a administração anexa o arquivo do certificado — o servidor numera
 * e guarda; para devolver, marca as etapas não conformes com o motivo.
 */
export function AnaliseCertificacao({
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
  const [detalhe, setDetalhe] = useState<DetalheCertificacaoAdmin | null>(null);
  const [campos, setCampos] = useState<CampoCabecalho[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [marcas, setMarcas] = useState<Record<string, string>>({});
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const d = await obterCertificacao(id);
        const lista = await camposDoPainel(d.solicitacao.painel.slug).catch(() => [] as CampoCabecalho[]);
        if (!ativo) return;
        setDetalhe(d);
        setCampos(lista);
      } catch (e) {
        if (!ativo) return;
        if (sessaoAdminAcabou(e)) onSessaoVencida();
        else setErro(e instanceof Error ? e.message : 'Não foi possível abrir a solicitação.');
      }
    })();
    return () => {
      ativo = false;
    };
  }, [id, onSessaoVencida]);

  if (erro && !detalhe) {
    return (
      <div className="space-y-3">
        <Erro detalhe={erro} />
        <Botao onClick={onVoltar}>Voltar à fila</Botao>
      </div>
    );
  }
  if (!detalhe) return <Carregando mensagem="Abrindo a solicitação…" />;

  const { solicitacao: s, definicao } = detalhe;
  const decidivel = s.estado === 'enviada';
  const marcasGravadas = Object.fromEntries(s.itens.map((i) => [i.etapaId, i.motivo]));
  const conhecidos = new Set(campos.map((c) => c.id));
  const dados = [
    ...campos.map((c) => ({
      id: c.id,
      rotulo: c.rotulo,
      valor: `${s.dados[c.id] ?? ''}${c.unidade && s.dados[c.id] ? ` ${c.unidade}` : ''}`,
    })),
    ...Object.entries(s.dados)
      .filter(([k]) => !conhecidos.has(k))
      .map(([k, valor]) => ({ id: k, rotulo: k, valor })),
  ];

  const escolherArquivo = (f: File | null) => {
    setErroArquivo(null);
    if (!f) {
      setArquivo(null);
      return;
    }
    if (!TIPOS_CERTIFICADO.includes(f.type)) {
      setErroArquivo('O certificado deve ser um PDF, JPEG ou PNG.');
      setArquivo(null);
      return;
    }
    if (f.size > TAMANHO_MAXIMO) {
      setErroArquivo('Arquivo grande demais (máximo 25 MB).');
      setArquivo(null);
      return;
    }
    setArquivo(f);
  };

  const decidir = async (decisao: 'aprovada' | 'reprovada', comentario: string) => {
    try {
      if (decisao === 'aprovada') {
        if (!arquivo) throw new Error('Anexe o arquivo do certificado.');
        await enviarCertificado(id, arquivo, 'aprovacao');
        onDecidido(`Solicitação aprovada e certificado anexado. ${s.montador.nome} foi avisado para baixá-lo.`);
      } else {
        const itens = Object.entries(marcas).map(([etapaId, motivo]) => ({
          formId: s.formId,
          etapaId,
          motivo: motivo.trim(),
        }));
        await devolverCertificacao(id, comentario, itens);
        onDecidido(`Solicitação devolvida: ${s.montador.nome} foi avisado para corrigir.`);
      }
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
          <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">{s.painel.nome}</p>
          <h2 className="text-2xl font-bold break-words">{s.dados.tagPainel || 'Sem TAG'}</h2>
          <p className="text-base text-abb-gray">
            {s.montador.nome} ({s.montador.email})
          </p>
          <div className="mt-2">
            <EtiquetaEstado estado={s.estado as EstadoSolicitacao} />
          </div>
        </div>
      </div>

      {!decidivel && s.numero ? (
        <p className="rounded-lg border border-abb-line bg-white p-4 text-base">
          Aprovada sob o certificado nº <span className="font-bold">{s.numero}</span>.
        </p>
      ) : null}

      <RevisaoChecklist
        definicao={definicao}
        titulo={definicao?.nome ?? 'Checklist'}
        rotuloCabecalho="Dados da solicitação"
        cabecalho={dados}
        respostas={s.preenchimento.respostas ?? {}}
        midias={s.midias.map((m) => ({ ...m, disponivel: m.recebida }))}
        marcas={decidivel ? marcas : marcasGravadas}
        onMarcar={
          decidivel
            ? (etapaId, motivo) =>
                setMarcas((atual) => {
                  const proximo = { ...atual };
                  if (motivo === null) delete proximo[etapaId];
                  else proximo[etapaId] = motivo;
                  return proximo;
                })
            : undefined
        }
      />

      <details className="rounded-lg border border-abb-line bg-white">
        <summary className="min-h-12 cursor-pointer px-4 py-3 text-base font-bold">Histórico</summary>
        <ol className="space-y-2 border-t border-abb-line p-4">
          {s.historico.map((evento, i) => (
            <li key={i} className="border-l-2 border-abb-line pl-3 text-base">
              <span className="font-semibold">
                {ROTULO_ESTADO[evento.estado as EstadoSolicitacao] ?? evento.estado}
              </span>{' '}
              <span className="text-abb-gray">— {dataHoraBr(evento.em)}</span>
              {evento.por ? <span className="text-abb-gray"> • {evento.por}</span> : null}
              {evento.observacao ? (
                <p className="text-sm whitespace-pre-line text-abb-gray">{evento.observacao}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </details>

      {decidivel ? (
        <PainelDecisao
          marcadas={Object.keys(marcas).length}
          semMotivo={Object.values(marcas).filter((m) => !m.trim()).length}
          rotuloAprovar="Aprovar e anexar certificado"
          rotuloReprovar="Devolver para correção"
          bloqueioAprovar={arquivo ? null : 'Para aprovar, anexe o arquivo do certificado (PDF, JPEG ou PNG).'}
          extra={
            <div className="space-y-1 rounded-md border border-abb-line bg-abb-offwhite p-3">
              <label className="block text-base font-semibold" htmlFor={`certificado-${id}`}>
                Arquivo do certificado
              </label>
              <input
                id={`certificado-${id}`}
                type="file"
                accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                className="block min-h-12 w-full text-base"
                onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)}
              />
              {arquivo ? (
                <p className="text-sm text-abb-gray">
                  {arquivo.name} · {formatarBytes(arquivo.size)}. O número do certificado é atribuído pelo
                  servidor na aprovação.
                </p>
              ) : null}
              {erroArquivo ? <p className="text-sm font-semibold text-abb-red">{erroArquivo}</p> : null}
            </div>
          }
          onDecidir={decidir}
        />
      ) : null}
    </div>
  );
}
