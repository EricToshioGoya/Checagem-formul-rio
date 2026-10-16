import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../../core/api/cliente';
import {
  enviarCertificado,
  listarVerificacoes,
  TIPOS_CERTIFICADO,
  type RespostaVerificacoesAdmin,
} from '../../../core/aprovacao/admin';
import {
  listarCertificados,
  listarParaValidar,
  type CertificadoRegistrado,
  type LinhaDeValidacao,
} from '../../../core/certificacao/validacaoServidor';
import { Botao } from '../../../shared/componentes/Botao';
import { Carregando, Erro, Vazio } from '../../../shared/componentes/Estado';
import { Paginacao } from '../../../shared/componentes/Paginacao';
import { baixarBlob } from '../../../shared/utils/download';
import { dataHoraBr } from '../../../shared/utils/texto';
import { EtiquetaVerificacao } from '../../aprovacao/SituacaoAprovacao';
import { sessaoAdminAcabou } from '../sessaoAdmin';
import { AnaliseCertificacao } from './AnaliseCertificacao';
import { AnaliseVerificacao } from './AnaliseVerificacao';

type Secao = 'verificacoes' | 'certificacoes' | 'certificados';

const SECOES: Array<{ id: Secao; rotulo: string }> = [
  { id: 'verificacoes', rotulo: 'Verificações (PDF do projeto)' },
  { id: 'certificacoes', rotulo: 'Certificações' },
  { id: 'certificados', rotulo: 'Certificados emitidos' },
];

const FILTROS: Array<{ id: string; rotulo: string }> = [
  { id: 'aguardando', rotulo: 'Aguardando' },
  { id: 'reprovada', rotulo: 'Reprovadas' },
  { id: 'aprovada', rotulo: 'Aprovadas' },
  { id: 'substituida', rotulo: 'Substituídas' },
  { id: 'todas', rotulo: 'Todas' },
];

interface Props {
  onSessaoVencida: () => void;
  /** Relê os selos das abas depois de uma decisão. */
  onAlterado: () => void;
  pendentes?: { verificacoes?: number; certificacoes?: number };
}

/**
 * Aprovações: a fila dos PDFs de verificação enviados pelos montadores, a das
 * solicitações de certificação e o registro dos certificados emitidos. O que
 * está aberto fica no endereço, para recarregar a página sem perder o lugar.
 */
export function Aprovacoes({ onSessaoVencida, onAlterado, pendentes }: Props) {
  const [parametros, setParametros] = useSearchParams();
  const secao: Secao = SECOES.some((s) => s.id === parametros.get('secao'))
    ? (parametros.get('secao') as Secao)
    : 'verificacoes';
  const aberta = Number(parametros.get('abrir')) || null;
  const [mensagem, setMensagem] = useState<string | null>(null);

  const ir = (proxima: Secao, abrir?: number) => {
    const p: Record<string, string> = { aba: 'aprovacoes', secao: proxima };
    if (abrir) p.abrir = String(abrir);
    setParametros(p, { replace: !abrir });
  };

  const decidido = (texto: string) => {
    setMensagem(texto);
    onAlterado();
    ir(secao);
  };

  if (aberta && secao === 'verificacoes') {
    return (
      <AnaliseVerificacao
        id={aberta}
        onVoltar={() => ir('verificacoes')}
        onDecidido={decidido}
        onSessaoVencida={onSessaoVencida}
      />
    );
  }
  if (aberta && secao === 'certificacoes') {
    return (
      <AnaliseCertificacao
        id={aberta}
        onVoltar={() => ir('certificacoes')}
        onDecidido={decidido}
        onSessaoVencida={onSessaoVencida}
      />
    );
  }

  const selo = (id: Secao) =>
    id === 'verificacoes' ? pendentes?.verificacoes : id === 'certificacoes' ? pendentes?.certificacoes : undefined;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Aprovações</h2>
        <p className="text-sm text-abb-gray">
          O que os montadores enviaram para aprovação. Marque as etapas não conformes com o motivo:
          o montador vê o alerta e corrige.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filas de aprovação">
        {SECOES.map((s) => {
          const n = selo(s.id) ?? 0;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={secao === s.id}
              onClick={() => {
                setMensagem(null);
                ir(s.id);
              }}
              className={[
                'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold',
                secao === s.id
                  ? 'border-abb-black bg-abb-black text-white'
                  : 'border-abb-line-botao bg-abb-offwhite text-abb-black hover:bg-abb-offwhite-hover',
              ].join(' ')}
            >
              {s.rotulo}
              {n > 0 ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1 text-xs font-bold text-white">
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {mensagem ? (
        <div className="rounded-md border border-green-600 bg-green-50 p-3 text-base text-green-900" role="status">
          {mensagem}
        </div>
      ) : null}

      {secao === 'verificacoes' ? (
        <FilaVerificacoes onAbrir={(id) => ir('verificacoes', id)} onSessaoVencida={onSessaoVencida} />
      ) : secao === 'certificacoes' ? (
        <FilaCertificacoes onAbrir={(id) => ir('certificacoes', id)} onSessaoVencida={onSessaoVencida} />
      ) : (
        <RegistroCertificados onSessaoVencida={onSessaoVencida} />
      )}
    </div>
  );
}

function FilaVerificacoes({
  onAbrir,
  onSessaoVencida,
}: {
  onAbrir: (id: number) => void;
  onSessaoVencida: () => void;
}) {
  const [estado, setEstado] = useState('aguardando');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<RespostaVerificacoesAdmin | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setDados(null);
    listarVerificacoes(estado, pagina)
      .then((d) => {
        if (!ativo) return;
        setDados(d);
        setErro(null);
      })
      .catch((e) => {
        if (!ativo) return;
        if (sessaoAdminAcabou(e)) onSessaoVencida();
        else setErro(e instanceof Error ? e.message : 'Não foi possível ler a fila.');
      });
    return () => {
      ativo = false;
    };
  }, [estado, pagina, onSessaoVencida]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Botao
            key={f.id}
            tamanho="compacto"
            variante={estado === f.id ? 'primario' : 'secundario'}
            aria-pressed={estado === f.id}
            onClick={() => {
              setEstado(f.id);
              setPagina(1);
            }}
          >
            {f.rotulo}
          </Botao>
        ))}
      </div>
      {erro ? <Erro detalhe={erro} /> : null}
      {!dados && !erro ? <Carregando mensagem="Lendo a fila de verificações…" /> : null}
      {dados ? (
        dados.itens.length === 0 ? (
          <Vazio titulo={estado === 'aguardando' ? 'Nada aguardando aprovação' : 'Nenhum envio nesta situação'}>
            O PDF do projeto chega aqui sozinho quando o montador o gera.
          </Vazio>
        ) : (
          <>
            <ul className="space-y-2">
              {dados.itens.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-abb-line bg-white p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
                      {v.painel.nome} · {v.projeto.empresa}
                    </p>
                    <p className="text-lg font-bold break-words">
                      {v.projeto.nome} <span className="font-normal text-abb-gray">· {v.tipo.rotulo}</span>
                    </p>
                    <p className="text-sm text-abb-gray">
                      Versão {v.versao ?? '—'} · {v.montador.nome} · enviado em {dataHoraBr(v.enviadoEm ?? undefined)}
                      {v.tags.length ? ` · TAGs: ${v.tags.slice(0, 5).join(', ')}${v.tags.length > 5 ? '…' : ''}` : ''}
                    </p>
                    {v.progresso ? (
                      <p className="text-sm text-abb-gray">
                        Preenchimento no envio: {v.progresso.respondidas} de {v.progresso.total} etapas
                      </p>
                    ) : null}
                    {v.decididoEm ? (
                      <p className="text-sm text-abb-gray">
                        Decidido em {dataHoraBr(v.decididoEm)} por {v.decididoPor ?? '—'}
                        {v.itens.length ? ` · ${v.itens.length} etapa(s) apontada(s)` : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <EtiquetaVerificacao estado={v.estado} />
                    <Botao variante={v.estado === 'aguardando' ? 'primario' : 'secundario'} onClick={() => onAbrir(v.id)}>
                      {v.estado === 'aguardando' ? 'Analisar' : 'Ver'}
                    </Botao>
                  </div>
                </li>
              ))}
            </ul>
            <Paginacao pagina={dados.pagina} porPagina={dados.porPagina} total={dados.total} onMudar={setPagina} />
          </>
        )
      ) : null}
    </section>
  );
}

function FilaCertificacoes({
  onAbrir,
  onSessaoVencida,
}: {
  onAbrir: (id: number) => void;
  onSessaoVencida: () => void;
}) {
  const [linhas, setLinhas] = useState<LinhaDeValidacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    listarParaValidar()
      .then((l) => ativo && setLinhas(l))
      .catch((e) => {
        if (!ativo) return;
        if (sessaoAdminAcabou(e)) onSessaoVencida();
        else setErro(e instanceof Error ? e.message : 'Não foi possível ler as solicitações.');
      });
    return () => {
      ativo = false;
    };
  }, [onSessaoVencida]);

  if (erro) return <Erro detalhe={erro} />;
  if (!linhas) return <Carregando mensagem="Lendo as solicitações enviadas…" />;
  if (!linhas.length) {
    return (
      <Vazio titulo="Nenhuma solicitação aguardando validação">
        As solicitações aparecem aqui assim que o montador as enviar.
      </Vazio>
    );
  }
  return (
    <ul className="space-y-2">
      {linhas.map(({ item, painel, completa, camposPendentes }) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-abb-line bg-white p-4"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">{painel.nome}</p>
            <p className="text-lg font-bold break-words">{item.dados.tagPainel || 'Sem TAG'}</p>
            <p className="text-sm text-abb-gray">
              {item.montador.nome} · enviada em {dataHoraBr(item.enviadaEm)} · checklist {item.progresso.respondidas}{' '}
              de {item.progresso.total} etapas
            </p>
            {!completa ? (
              <p className="text-sm font-semibold text-amber-800">
                Pendências: {[...camposPendentes, ...(item.etapasPendentes.length ? [`etapas ${item.etapasPendentes.join(', ')}`] : [])].join('; ')}
              </p>
            ) : null}
          </div>
          <Botao variante="primario" onClick={() => onAbrir(item.id)}>
            Analisar
          </Botao>
        </li>
      ))}
    </ul>
  );
}

function RegistroCertificados({ onSessaoVencida }: { onSessaoVencida: () => void }) {
  const [certificados, setCertificados] = useState<CertificadoRegistrado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setCertificados(await listarCertificados());
      setErro(null);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível ler o registro.');
    }
  }, [onSessaoVencida]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const baixar = async (c: CertificadoRegistrado) => {
    if (!c.anexo) return;
    setOcupado(c.numero);
    try {
      baixarBlob(await api.baixarArquivo(`/api/admin/certificados/${c.anexo.uid}/arquivo`), c.anexo.nomeArquivo);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível baixar o certificado.');
    } finally {
      setOcupado(null);
    }
  };

  const anexarVia = async (c: CertificadoRegistrado, arquivo: File | undefined) => {
    if (!arquivo || c.certificacaoId === null) return;
    if (!TIPOS_CERTIFICADO.includes(arquivo.type)) {
      setErro('O certificado deve ser um PDF, JPEG ou PNG.');
      return;
    }
    setOcupado(c.numero);
    setErro(null);
    try {
      await enviarCertificado(c.certificacaoId, arquivo, 'nova-via');
      setMensagem(`Nova via anexada ao certificado nº ${c.numero}. O montador foi avisado.`);
      await carregar();
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível anexar o arquivo.');
    } finally {
      setOcupado(null);
    }
  };

  if (!certificados && !erro) return <Carregando mensagem="Lendo o registro de certificados…" />;
  return (
    <section className="space-y-3">
      {mensagem ? (
        <div className="rounded-md border border-green-600 bg-green-50 p-3 text-base text-green-900">{mensagem}</div>
      ) : null}
      {erro ? <Erro detalhe={erro} /> : null}
      {certificados && certificados.length === 0 ? (
        <Vazio titulo="Nenhum certificado emitido">
          O número sequencial é atribuído pelo servidor na aprovação e não é reaproveitado.
        </Vazio>
      ) : null}
      {certificados?.length ? (
        <div className="overflow-x-auto rounded-lg border border-abb-line bg-white">
          <table className="w-full min-w-[56rem] border-collapse text-base">
            <thead>
              <tr className="bg-neutral-100 text-left">
                <th className="border-b border-abb-line p-2">Nº</th>
                <th className="border-b border-abb-line p-2">Data</th>
                <th className="border-b border-abb-line p-2">Painel</th>
                <th className="border-b border-abb-line p-2">Projeto</th>
                <th className="border-b border-abb-line p-2">TAG</th>
                <th className="border-b border-abb-line p-2">Montador</th>
                <th className="border-b border-abb-line p-2">Arquivo</th>
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
                  <td className="border-b border-abb-line p-2">{c.montador || '—'}</td>
                  <td className="border-b border-abb-line p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {c.anexo ? (
                        <Botao tamanho="compacto" disabled={ocupado === c.numero} onClick={() => void baixar(c)}>
                          Baixar
                        </Botao>
                      ) : (
                        <span className="text-sm text-abb-gray">Sem arquivo</span>
                      )}
                      {c.certificacaoId !== null ? (
                        <label className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-abb-line-botao bg-abb-offwhite px-3 text-sm font-semibold hover:bg-abb-offwhite-hover">
                          {c.anexo ? 'Anexar nova via' : 'Anexar arquivo'}
                          <input
                            type="file"
                            className="sr-only"
                            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                            disabled={ocupado === c.numero}
                            onChange={(e) => {
                              void anexarVia(c, e.target.files?.[0]);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
