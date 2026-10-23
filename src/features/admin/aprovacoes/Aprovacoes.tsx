import { useCallback, useEffect, useRef, useState } from 'react';
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
import { AnaliseVerificacao } from './AnaliseVerificacao';

export const FILTROS: Array<{ id: string; rotulo: string }> = [
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
}

/**
 * Aprovações: a fila dos PDFs de projeto (um por tipo de verificação)
 * enviados pelos montadores. O checklist que contém certificado tem a aba
 * própria, Certificados. O que está aberto fica no endereço, para recarregar
 * a página sem perder o lugar.
 */
export function Aprovacoes({ onSessaoVencida, onAlterado }: Props) {
  const [parametros, setParametros] = useSearchParams();
  const aberta = Number(parametros.get('abrir')) || null;
  const [mensagem, setMensagem] = useState<string | null>(null);

  const ir = (abrir?: number) => {
    const p: Record<string, string> = { aba: 'aprovacoes' };
    if (abrir) p.abrir = String(abrir);
    setParametros(p, { replace: !abrir });
  };

  if (aberta) {
    return (
      <AnaliseVerificacao
        id={aberta}
        onVoltar={() => ir()}
        onDecidido={(texto) => {
          setMensagem(texto);
          onAlterado();
          ir();
        }}
        onSessaoVencida={onSessaoVencida}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Aprovações</h2>
        <p className="text-sm text-abb-gray">
          Os PDFs de projeto enviados para aprovação. Marque as etapas não conformes com o motivo: o
          montador vê o alerta e corrige. Os checklists que contêm certificado ficam na aba
          Certificados.
        </p>
      </div>
      {mensagem ? (
        <div className="rounded-md border border-green-600 bg-green-50 p-3 text-base text-green-900" role="status">
          {mensagem}
        </div>
      ) : null}
      <FilaVerificacoes onAbrir={(id) => ir(id)} onSessaoVencida={onSessaoVencida} />
    </div>
  );
}

export function FilaVerificacoes({
  onAbrir,
  onSessaoVencida,
  categoria = 'verificacao',
}: {
  onAbrir: (id: number) => void;
  onSessaoVencida: () => void;
  categoria?: 'verificacao' | 'certificado';
}) {
  const [estado, setEstado] = useState('aguardando');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<RespostaVerificacoesAdmin | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setDados(null);
    listarVerificacoes(estado, pagina, categoria)
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
  }, [estado, pagina, categoria, onSessaoVencida]);

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
            {categoria === 'certificado'
              ? 'O checklist que contém certificado chega aqui sozinho quando o montador o termina e gera o PDF.'
              : 'O PDF do projeto chega aqui sozinho quando o montador o gera.'}
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
                      {categoria === 'certificado' ? `TAG ${v.tags[0] ?? ''} · ${v.projeto.nome}` : v.projeto.nome}{' '}
                      <span className="font-normal text-abb-gray">· {v.tipo.rotulo}</span>
                    </p>
                    {v.certificado?.numero ? (
                      <p className="text-base font-semibold text-green-800">Certificado nº {v.certificado.numero}</p>
                    ) : null}
                    <p className="text-sm text-abb-gray">
                      Versão {v.versao ?? '—'} · {v.montador.nome} · enviado em {dataHoraBr(v.enviadoEm ?? undefined)}
                      {categoria === 'verificacao' && v.tags.length
                        ? ` · TAGs: ${v.tags.slice(0, 5).join(', ')}${v.tags.length > 5 ? '…' : ''}`
                        : ''}
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

export function FilaCertificacoes({
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

/** Sem acento e em minúsculas, para a busca não depender de como se digitou. */
const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export function RegistroCertificados({ onSessaoVencida }: { onSessaoVencida: () => void }) {
  const [certificados, setCertificados] = useState<CertificadoRegistrado[] | null>(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  // A busca vai ao servidor (o registro inteiro, não só os 500 mais recentes);
  // só a resposta do pedido mais novo vale.
  const termo = useRef('');
  const pedido = useRef(0);

  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    try {
      const lista = await listarCertificados(termo.current || undefined);
      if (meu !== pedido.current) return;
      setCertificados(lista);
      setErro(null);
    } catch (e) {
      if (meu !== pedido.current) return;
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível ler o registro.');
    }
  }, [onSessaoVencida]);

  useEffect(() => {
    termo.current = busca.trim();
    const espera = window.setTimeout(() => void carregar(), termo.current ? 300 : 0);
    return () => window.clearTimeout(espera);
  }, [busca, carregar]);

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
  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  const filtrados = (certificados ?? []).filter((c) => {
    const texto = normalizar(
      [c.numero, c.numero.replace('-', ''), c.tagPainel, c.projeto, c.nomePainel, c.montador, c.clienteFinal].join(' '),
    );
    return termos.every((t) => texto.includes(t));
  });
  return (
    <section className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-base font-semibold">Buscar certificado</span>
        <input
          type="search"
          className="min-h-12 w-full rounded-md border border-abb-line bg-white px-3 text-base focus:border-abb-red"
          placeholder="Código (ex.: 7K3F-9Q2M), TAG, projeto, painel ou montador…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </label>
      {mensagem ? (
        <div className="rounded-md border border-green-600 bg-green-50 p-3 text-base text-green-900">{mensagem}</div>
      ) : null}
      {erro ? <Erro detalhe={erro} /> : null}
      {certificados && certificados.length === 0 ? (
        <Vazio titulo="Nenhum certificado emitido">
          O código único é gerado na aprovação do checklist e nunca se repete.
        </Vazio>
      ) : null}
      {certificados?.length && !filtrados.length ? (
        <p className="rounded-xl border border-abb-line bg-white p-6 text-center text-sm text-abb-gray">
          Nenhum certificado com essa busca.
        </p>
      ) : null}
      {filtrados.length ? (
        <div className="overflow-x-auto rounded-lg border border-abb-line bg-white">
          <table className="w-full min-w-[56rem] border-collapse text-base">
            <thead>
              <tr className="bg-neutral-100 text-left">
                <th className="border-b border-abb-line p-2">Código / Nº</th>
                <th className="border-b border-abb-line p-2">Data</th>
                <th className="border-b border-abb-line p-2">Painel</th>
                <th className="border-b border-abb-line p-2">Projeto</th>
                <th className="border-b border-abb-line p-2">TAG</th>
                <th className="border-b border-abb-line p-2">Montador</th>
                <th className="border-b border-abb-line p-2">Arquivo</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
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
