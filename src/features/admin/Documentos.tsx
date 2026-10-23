import { useCallback, useEffect, useRef, useState } from 'react';
import { api, consulta, type DocumentoArquivado, type RespostaDocumentos } from '../../core/api/cliente';
import { Botao } from '../../shared/componentes/Botao';
import { CampoData } from '../../shared/componentes/Campos';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeBusca } from '../../shared/componentes/Icones';
import { Paginacao } from '../../shared/componentes/Paginacao';
import { baixarBlob } from '../../shared/utils/download';
import { dataHoraEmissao, formatarBytes } from '../../shared/utils/texto';
import { EtiquetaVerificacao } from '../aprovacao/SituacaoAprovacao';
import type { EstadoVerificacao } from '../../core/aprovacao/decisoes';
import { sessaoAdminAcabou } from './sessaoAdmin';

/** `AAAA-MM-DD` do campo de data → início ou fim daquele dia no fuso do aparelho. */
function limiteDoDia(data: string, fim: boolean): number | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!partes) return null;
  const [, a, m, d] = partes.map(Number);
  return fim
    ? new Date(a, m - 1, d, 23, 59, 59, 999).getTime()
    : new Date(a, m - 1, d, 0, 0, 0, 0).getTime();
}

const CATEGORIAS = [
  { id: '', rotulo: 'Todos' },
  { id: 'verificacao', rotulo: 'PDFs de verificação' },
  { id: 'checklist', rotulo: 'PDFs de checklist' },
  { id: 'certificado', rotulo: 'Certificados' },
];

const SITUACOES = [
  { id: '', rotulo: 'Qualquer situação' },
  { id: 'aguardando', rotulo: 'Aguardando aprovação' },
  { id: 'aprovada', rotulo: 'Aprovados' },
  { id: 'reprovada', rotulo: 'Reprovados' },
  { id: 'substituida', rotulo: 'Substituídos' },
];

const ROTULO_CATEGORIA: Record<DocumentoArquivado['categoria'], string> = {
  verificacao: 'PDF de verificação',
  checklist: 'PDF de checklist',
  certificado: 'Certificado',
};

const INTEGRIDADE: Record<string, { texto: string; classe: string }> = {
  ok: { texto: 'Íntegro', classe: 'bg-green-100 text-green-800' },
  reparado: { texto: 'Reparado do backup', classe: 'bg-sky-100 text-sky-900' },
  corrompido: { texto: 'Corrompido', classe: 'bg-red-100 text-abb-red' },
  ausente: { texto: 'Arquivo ausente', classe: 'bg-red-100 text-abb-red' },
};

const seletor = 'min-h-12 w-full rounded-md border border-abb-line bg-white px-3 text-base focus:border-abb-red';

/**
 * Documentos guardados: os PDFs emitidos pelos montadores (com a situação da
 * aprovação, quando o PDF foi para aprovação) e os certificados anexados
 * pela administração. É a documentação que valida a garantia ABB em caso de
 * falha ou quebra do material, e nada aqui é apagado.
 */
export function Documentos({
  onSessaoVencida,
  onAbrirAnalise,
}: {
  onSessaoVencida: () => void;
  /** Abre a análise: do PDF do projeto (Aprovações), do checklist com certificado ou da solicitação antiga (Certificados). */
  onAbrirAnalise: (destino: 'aprovacao' | 'certificado' | 'certificacao-antiga', id: number) => void;
}) {
  const [dados, setDados] = useState<RespostaDocumentos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [categoria, setCategoria] = useState('');
  const [situacao, setSituacao] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [pagina, setPagina] = useState(1);
  const [baixando, setBaixando] = useState<string | null>(null);

  // Só a resposta do pedido mais recente vale: uma resposta atrasada de outro
  // filtro ou página não pode tomar o lugar da lista atual.
  const pedido = useRef(0);
  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    try {
      const resposta = await api.get<RespostaDocumentos>(
        `/api/admin/documentos${consulta({
          pagina,
          busca: buscaAplicada,
          categoria,
          situacao,
          de: limiteDoDia(de, false),
          ate: limiteDoDia(ate, true),
        })}`,
      );
      if (meu !== pedido.current) return;
      setDados(resposta);
      setErro(null);
    } catch (e) {
      if (meu !== pedido.current) return;
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível ler os documentos.');
    }
  }, [onSessaoVencida, pagina, buscaAplicada, categoria, situacao, de, ate]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    const espera = window.setTimeout(() => {
      setBuscaAplicada(busca.trim());
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(espera);
  }, [busca]);

  const baixar = async (doc: DocumentoArquivado) => {
    setBaixando(doc.uid);
    try {
      const rota =
        doc.categoria === 'certificado'
          ? `/api/admin/certificados/${doc.uid}/arquivo`
          : `/api/admin/pdfs/${doc.uid}/arquivo`;
      baixarBlob(await api.baixarArquivo(rota), doc.nomeArquivo);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível baixar o documento.');
    } finally {
      setBaixando(null);
    }
  };

  const filtrando = Boolean(buscaAplicada || categoria || situacao || de || ate);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Documentos</h2>
        <p className="text-sm text-abb-gray">
          Todo PDF emitido pelos montadores e todo certificado anexado, como foram recebidos —
          documentação da garantia. Nada aqui é apagado; cada arquivo é conferido pelo SHA-256 e
          tem cópia no backup.
        </p>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      <div className="grid gap-3 rounded-xl border border-abb-line bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[1fr_12rem_12rem_10rem_10rem]">
        <label className="relative self-end sm:col-span-2 lg:col-span-1">
          <span className="mb-1 block text-base font-semibold">Buscar</span>
          <IconeBusca className="pointer-events-none absolute bottom-4 left-3 h-4 w-4 text-abb-gray" />
          <input
            type="search"
            placeholder="Empresa, projeto, TAG, montador, nº do certificado…"
            className="min-h-12 w-full rounded-md border border-abb-line bg-white pr-3 pl-9 text-base focus:border-abb-red"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        <label className="self-end">
          <span className="mb-1 block text-base font-semibold">Tipo</span>
          <select
            className={seletor}
            value={categoria}
            onChange={(e) => {
              setCategoria(e.target.value);
              setPagina(1);
            }}
          >
            {CATEGORIAS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="self-end">
          <span className="mb-1 block text-base font-semibold">Situação</span>
          <select
            className={seletor}
            value={situacao}
            onChange={(e) => {
              setSituacao(e.target.value);
              setPagina(1);
            }}
          >
            {SITUACOES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </label>
        <CampoData
          rotulo="De"
          valor={de}
          onChange={(v) => {
            setDe(v);
            setPagina(1);
          }}
        />
        <CampoData
          rotulo="Até"
          valor={ate}
          onChange={(v) => {
            setAte(v);
            setPagina(1);
          }}
        />
        {filtrando ? (
          <div className="sm:col-span-2 lg:col-span-5">
            <Botao
              tamanho="compacto"
              onClick={() => {
                setBusca('');
                setBuscaAplicada('');
                setCategoria('');
                setSituacao('');
                setDe('');
                setAte('');
                setPagina(1);
              }}
            >
              Limpar filtros
            </Botao>
          </div>
        ) : null}
      </div>

      {!dados && !erro ? <Carregando mensagem="Lendo os documentos…" /> : null}

      {dados ? (
        dados.documentos.length === 0 ? (
          <p className="rounded-xl border border-abb-line bg-white p-6 text-center text-sm text-abb-gray">
            Nenhum documento {filtrando ? 'com esses filtros' : 'guardado ainda'}.
          </p>
        ) : (
          <>
            <p className="text-sm text-abb-gray">{dados.total} documento(s)</p>
            <ul className="divide-y divide-abb-line/70 overflow-hidden rounded-xl border border-abb-line bg-white shadow-sm">
              {dados.documentos.map((doc) => {
                const integridade = doc.integridade ? INTEGRIDADE[doc.integridade.situacao] : null;
                return (
                  <li key={doc.uid} className="flex flex-wrap items-center gap-3 px-3 py-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-xs font-semibold tracking-wide text-abb-gray uppercase">
                        {doc.categoria === 'verificacao' && doc.envioCategoria === 'certificado'
                          ? 'PDF de checklist com certificado'
                          : ROTULO_CATEGORIA[doc.categoria]}
                        {doc.versao ? ` · versão ${doc.versao}` : ''}
                      </p>
                      <p className="text-base font-bold break-words">
                        {doc.empresa || '—'} · {doc.projeto || '—'}
                      </p>
                      <p className="text-sm break-words">
                        {doc.titulo}
                        {doc.painel ? ` · ${doc.painel}` : ''}
                      </p>
                      <p className="text-xs text-abb-gray">
                        {doc.categoria === 'certificado' ? 'Anexado' : 'Emitido'} em{' '}
                        <time dateTime={new Date(doc.em).toISOString()}>{dataHoraEmissao(new Date(doc.em))}</time>
                        {doc.montador ? ` · montador ${doc.montador}` : ''} · {formatarBytes(doc.tamanho)}
                      </p>
                      <p className="text-xs break-all text-abb-gray">{doc.nomeArquivo}</p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {doc.categoria === 'verificacao' && doc.situacao && doc.situacao !== 'recebendo' ? (
                          <EtiquetaVerificacao estado={doc.situacao as EstadoVerificacao} />
                        ) : null}
                        {integridade ? (
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-semibold ${integridade.classe}`}
                            title={`Conferido em ${dataHoraEmissao(new Date(doc.integridade!.verificadoEm))}`}
                          >
                            {integridade.texto}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {doc.verificacaoId ? (
                        <Botao
                          tamanho="compacto"
                          onClick={() =>
                            onAbrirAnalise(doc.envioCategoria === 'certificado' ? 'certificado' : 'aprovacao', doc.verificacaoId!)
                          }
                        >
                          Ver análise
                        </Botao>
                      ) : null}
                      {doc.categoria === 'certificado' && doc.certificacaoId ? (
                        <Botao tamanho="compacto" onClick={() => onAbrirAnalise('certificacao-antiga', doc.certificacaoId!)}>
                          Ver solicitação
                        </Botao>
                      ) : null}
                      <Botao
                        tamanho="compacto"
                        variante="primario"
                        disabled={baixando === doc.uid}
                        onClick={() => void baixar(doc)}
                      >
                        {baixando === doc.uid ? 'Baixando…' : 'Baixar'}
                      </Botao>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Paginacao pagina={dados.pagina} porPagina={dados.porPagina} total={dados.total} onMudar={setPagina} />
          </>
        )
      ) : null}
    </div>
  );
}
