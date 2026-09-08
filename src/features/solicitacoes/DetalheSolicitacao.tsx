import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  podeEditar,
  ROTULO_ESTADO,
  servicoValidacao,
  situacaoDaSolicitacao,
  solicitacaoStore,
  type SituacaoSolicitacao,
} from '../../core/certificacao';
import { camposObrigatoriosVazios } from '../../core/forms/validacaoCampos';
import type { Solicitacao } from '../../core/db/tipos';
import type { ValoresCabecalho } from '../../core/forms/tipos';
import { baixarBlob } from '../../shared/utils/download';
import { Botao } from '../../shared/componentes/Botao';
import { BarraProgresso } from '../../shared/componentes/BarraProgresso';
import { GradeCampos } from '../../shared/componentes/GradeCampos';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { IconePdf, IconeSeta, IconeVoltar } from '../../shared/componentes/Icones';
import { dataHoraBr } from '../../shared/utils/texto';
import { EtiquetaEstado } from './estado';

export function DetalheSolicitacao() {
  const { solicitacaoId } = useParams();
  const id = Number(solicitacaoId);
  const navegar = useNavigate();

  const [solicitacao, setSolicitacao] = useState<Solicitacao | null>(null);
  const [situacao, setSituacao] = useState<SituacaoSolicitacao | null>(null);
  const [valores, setValores] = useState<ValoresCabecalho>({});
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(async () => {
    try {
      const s = await solicitacaoStore.obter(id);
      if (!s) {
        setErro('Solicitação não encontrada neste aparelho.');
        return;
      }
      setSolicitacao(s);
      setValores(s.dados);
      setSituacao(await situacaoDaSolicitacao(s));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar a solicitação.');
    }
  }, [id]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const pendentesCampos = useMemo(
    () => (situacao ? camposObrigatoriosVazios(situacao.campos, valores) : []),
    [situacao, valores],
  );

  if (erro && !solicitacao) return <Erro detalhe={erro} />;
  if (!solicitacao || !situacao) return <Carregando mensagem="Carregando a solicitação…" />;

  const editavel = podeEditar(solicitacao.estado);
  const podeEnviar = editavel && situacao.completa && pendentesCampos.length === 0;

  const salvarDados = async (campoId: string, valor: string) => {
    const proximo = { ...valores, [campoId]: valor };
    setValores(proximo);
    await solicitacaoStore.atualizarDados(id, proximo);
  };

  const enviar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      await servicoValidacao.enviarParaValidacao(id, valores.operador ?? '');
      setMensagem(
        `Solicitação enviada para ${situacao.painel.responsavel?.nome ?? 'a ABB'}. ` +
          'O certificado será gerado após a aprovação.',
      );
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao enviar a solicitação.');
    } finally {
      setOcupado(false);
      setConfirmandoEnvio(false);
    }
  };

  const baixarCertificado = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const { gerarPdfCertificado } = await import('../../core/certificado/emissao');
      const arquivo = await gerarPdfCertificado(id);
      baixarBlob(arquivo.blob, arquivo.nome);
      await servicoValidacao.registrarEmissao(id, valores.operador ?? '');
      setMensagem(`Certificado ${arquivo.numero} gerado: ${arquivo.nome}`);
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao gerar o certificado.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <Botao
          variante="texto"
          onClick={() => navegar(`/paineis/${solicitacao.tipoPainel}/solicitacoes`)}
          aria-label="Voltar às solicitações"
        >
          <IconeVoltar />
        </Botao>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
            {situacao.painel.nome}
          </p>
          <h1 className="text-2xl font-bold break-words">
            {solicitacao.dados.tagPainel || 'Sem TAG'}
          </h1>
          <div className="mt-2">
            <EtiquetaEstado estado={solicitacao.estado} />
          </div>
        </div>
      </div>

      {solicitacao.estado === 'devolvida' && solicitacao.apontamentos ? (
        <Erro titulo="Devolvida com apontamentos" detalhe={solicitacao.apontamentos} />
      ) : null}

      {solicitacao.numeroCertificado ? (
        <div className="rounded-lg border-2 border-green-600 bg-green-50 p-4">
          <p className="text-base font-bold text-green-800">
            Certificado nº {solicitacao.numeroCertificado}
          </p>
          <p className="text-base text-abb-black">
            Aprovado por {solicitacao.aprovadoPor || situacao.painel.responsavel?.nome} em{' '}
            {dataHoraBr(solicitacao.aprovadoEm)}.
          </p>
          <div className="mt-3">
            <Botao variante="primario" onClick={baixarCertificado} disabled={ocupado}>
              <IconePdf className="h-5 w-5" />
              {ocupado ? 'Gerando…' : 'Baixar certificado'}
            </Botao>
          </div>
        </div>
      ) : null}

      {mensagem ? (
        <div className="rounded-md border border-green-600 bg-green-50 p-3 text-base text-green-900">
          {mensagem}
        </div>
      ) : null}
      {erro ? <Erro detalhe={erro} /> : null}

      <div className="rounded-lg border border-abb-line bg-white p-4">
        <h2 className="text-lg font-bold">Checklist de ensaios de rotina</h2>
        <div className="mt-3">
          <BarraProgresso
            percentual={situacao.progresso.percentual}
            rotulo={`${situacao.progresso.respondidas} de ${situacao.progresso.total} etapas`}
          />
        </div>
        <div className="mt-4">
          <Botao variante="primario" onClick={() => navegar(`/solicitacoes/${id}/checklist`)}>
            {editavel ? 'Preencher checklist' : 'Ver checklist'}
            <IconeSeta className="h-5 w-5" />
          </Botao>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-abb-line bg-white p-4">
        <h2 className="text-lg font-bold">Dados da empresa e do projeto</h2>
        <fieldset disabled={!editavel} className="border-0 p-0">
          <GradeCampos
            campos={situacao.campos}
            valores={valores}
            onChange={(campoId, valor) => void salvarDados(campoId, valor)}
            pendentes={pendentesCampos}
            prefixoId="sol"
          />
        </fieldset>
      </div>

      {editavel ? (
        <div className="space-y-3">
          {!podeEnviar ? (
            <Aviso>
              <p className="font-bold">Falta preencher antes de enviar:</p>
              <ul className="mt-1 list-disc pl-5">
                {situacao.camposPendentes.map((r) => (
                  <li key={r}>{r}</li>
                ))}
                {situacao.etapasPendentes.length ? (
                  <li>
                    Checklist — etapas {situacao.etapasPendentes.join(', ')}
                  </li>
                ) : null}
              </ul>
            </Aviso>
          ) : null}
          <Botao
            variante="primario"
            disabled={!podeEnviar || ocupado}
            onClick={() => setConfirmandoEnvio(true)}
          >
            Enviar para validação da ABB
          </Botao>
        </div>
      ) : null}

      <div className="rounded-lg border border-abb-line bg-white p-4">
        <h2 className="text-lg font-bold">Histórico</h2>
        <ol className="mt-3 space-y-2">
          {solicitacao.historico.map((evento, i) => (
            <li key={i} className="border-l-2 border-abb-line pl-3 text-base">
              <span className="font-semibold">{ROTULO_ESTADO[evento.estado]}</span>{' '}
              <span className="text-abb-gray">— {dataHoraBr(evento.em)}</span>
              {evento.por ? <span className="text-abb-gray"> • {evento.por}</span> : null}
              {evento.observacao ? (
                <p className="text-sm whitespace-pre-line text-abb-gray">{evento.observacao}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      <Confirmacao
        aberto={confirmandoEnvio}
        titulo="Enviar para validação"
        mensagem={`A solicitação vai para ${
          situacao.painel.responsavel?.nome ?? 'o responsável ABB'
        } e fica travada para edição até a resposta.\n\nO certificado só é gerado após a aprovação.`}
        textoConfirmar="Enviar"
        onCancelar={() => setConfirmandoEnvio(false)}
        onConfirmar={enviar}
      />
    </div>
  );
}
