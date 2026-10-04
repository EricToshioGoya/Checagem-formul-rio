import { useCallback, useEffect, useState } from 'react';
import {
  servicoValidacao,
  situacaoDaSolicitacao,
  solicitacaoStore,
  type SituacaoSolicitacao,
} from '../../core/certificacao';
import type { Certificado, Solicitacao } from '../../core/db/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Modal } from '../../shared/componentes/Modal';
import { Aviso, Carregando, Erro, Vazio } from '../../shared/componentes/Estado';
import { dataHoraBr } from '../../shared/utils/texto';
import { EtiquetaEstado } from '../solicitacoes/estado';

interface Linha {
  solicitacao: Solicitacao;
  situacao: SituacaoSolicitacao;
}

/**
 * Validação ABB: aprova ou devolve as solicitações enviadas.
 *
 * A aprovação é o único caminho para o número do certificado — atribuído pela
 * camada de validação, nunca por esta tela.
 */
export function ValidacaoAbb() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [certificados, setCertificados] = useState<Certificado[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState<Linha | null>(null);
  const [apontamentos, setApontamentos] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(async () => {
    try {
      const enviadas = await solicitacaoStore.listar({ estados: ['enviada'] });
      const comSituacao: Linha[] = [];
      for (const solicitacao of enviadas) {
        comSituacao.push({ solicitacao, situacao: await situacaoDaSolicitacao(solicitacao) });
      }
      setLinhas(comSituacao);
      setCertificados(await solicitacaoStore.listarCertificados());
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar as solicitações.');
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const aprovar = async (linha: Linha) => {
    setOcupado(true);
    setErro(null);
    try {
      const responsavel = linha.situacao.painel.responsavel?.nome ?? 'ABB';
      const { numero } = await servicoValidacao.aprovar(linha.solicitacao.id!, responsavel);
      setMensagem(
        `Solicitação aprovada por ${responsavel}. Certificado nº ${numero} atribuído.`,
      );
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao aprovar.');
    } finally {
      setOcupado(false);
    }
  };

  const devolver = async () => {
    if (!devolvendo) return;
    setOcupado(true);
    setErro(null);
    try {
      await servicoValidacao.devolver(
        devolvendo.solicitacao.id!,
        apontamentos,
        devolvendo.situacao.painel.responsavel?.nome ?? 'ABB',
      );
      setMensagem('Solicitação devolvida ao montador para correção.');
      setDevolvendo(null);
      setApontamentos('');
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao devolver.');
    } finally {
      setOcupado(false);
    }
  };

  if (!linhas) return <Carregando mensagem="Carregando as solicitações enviadas…" />;

  return (
    <div className="space-y-5">
      {mensagem ? (
        <div className="rounded-md border border-green-600 bg-green-50 p-3 text-base text-green-900">
          {mensagem}
        </div>
      ) : null}
      {erro ? <Erro detalhe={erro} /> : null}

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Solicitações aguardando validação</h2>
        {linhas.length === 0 ? (
          <Vazio titulo="Nenhuma solicitação enviada">
            As solicitações aparecem aqui assim que o montador as enviar.
          </Vazio>
        ) : (
          <ul className="space-y-3">
            {linhas.map(({ solicitacao, situacao }) => (
              <li
                key={solicitacao.id}
                className="space-y-3 rounded-lg border border-abb-line bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
                      {situacao.painel.nome}
                    </p>
                    <h3 className="text-xl font-bold break-words">
                      {solicitacao.dados.tagPainel || 'Sem TAG'}
                    </h3>
                  </div>
                  <EtiquetaEstado estado={solicitacao.estado} />
                </div>

                <dl className="grid gap-x-4 gap-y-1 text-base sm:grid-cols-2">
                  {situacao.campos.map((campo) => (
                    <div key={campo.id} className="flex gap-2">
                      <dt className="shrink-0 font-semibold text-abb-gray">
                        {campo.rotulo}:
                      </dt>
                      <dd className="min-w-0 break-words">
                        {solicitacao.dados[campo.id] || '—'}
                        {campo.unidade && solicitacao.dados[campo.id]
                          ? ` ${campo.unidade}`
                          : ''}
                      </dd>
                    </div>
                  ))}
                </dl>

                <p className="text-base">
                  Checklist: {situacao.progresso.respondidas} de {situacao.progresso.total}{' '}
                  etapas ({situacao.progresso.percentual}%). Enviada em{' '}
                  {dataHoraBr(solicitacao.atualizadoEm)}.
                </p>

                {!situacao.completa ? (
                  <Aviso>
                    Há pendências no preenchimento:{' '}
                    {[
                      ...situacao.camposPendentes,
                      ...(situacao.etapasPendentes.length
                        ? [`etapas ${situacao.etapasPendentes.join(', ')}`]
                        : []),
                    ].join('; ')}
                    .
                  </Aviso>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Botao
                    variante="primario"
                    disabled={ocupado}
                    onClick={() => void aprovar({ solicitacao, situacao })}
                  >
                    Aprovar e numerar
                  </Botao>
                  <Botao
                    variante="perigo"
                    disabled={ocupado}
                    onClick={() => {
                      setDevolvendo({ solicitacao, situacao });
                      setApontamentos('');
                    }}
                  >
                    Devolver com apontamentos
                  </Botao>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Registro de emissões</h2>
        {certificados.length === 0 ? (
          <Vazio titulo="Nenhum certificado emitido">
            O número sequencial é atribuído na aprovação e não é reaproveitado.
          </Vazio>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-abb-line bg-white">
            <table className="w-full min-w-[52rem] border-collapse text-base">
              <thead>
                <tr className="bg-neutral-100 text-left">
                  <th className="border-b border-abb-line p-2">Nº</th>
                  <th className="border-b border-abb-line p-2">Data</th>
                  <th className="border-b border-abb-line p-2">Painel</th>
                  <th className="border-b border-abb-line p-2">Projeto</th>
                  <th className="border-b border-abb-line p-2">TAG</th>
                  <th className="border-b border-abb-line p-2">Cliente final</th>
                  <th className="border-b border-abb-line p-2">Montador</th>
                </tr>
              </thead>
              <tbody>
                {certificados.map((c) => (
                  <tr key={c.numero}>
                    <td className="border-b border-abb-line p-2 font-bold">{c.numero}</td>
                    <td className="border-b border-abb-line p-2">{dataHoraBr(c.emitidoEm)}</td>
                    <td className="border-b border-abb-line p-2">{c.nomePainel}</td>
                    <td className="border-b border-abb-line p-2">{c.projeto || '—'}</td>
                    <td className="border-b border-abb-line p-2">{c.tagPainel || '—'}</td>
                    <td className="border-b border-abb-line p-2">{c.clienteFinal || '—'}</td>
                    <td className="border-b border-abb-line p-2">{c.montador || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        aberto={devolvendo !== null}
        titulo="Devolver com apontamentos"
        onFechar={() => setDevolvendo(null)}
        rodape={
          <>
            <Botao onClick={() => setDevolvendo(null)}>Cancelar</Botao>
            <Botao
              variante="primario"
              disabled={ocupado || !apontamentos.trim()}
              onClick={devolver}
            >
              Devolver
            </Botao>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-base text-abb-gray">
            O texto vai para o montador, que corrige e reenvia. O preenchimento
            já feito é preservado.
          </p>
          <CampoTexto
            rotulo="Apontamentos"
            multilinha
            valor={apontamentos}
            onChange={setApontamentos}
            placeholder="Ex.: falta a foto do aterramento das portas (11.4)."
            autoFoco
          />
        </div>
      </Modal>
    </div>
  );
}
