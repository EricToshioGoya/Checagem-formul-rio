import { useCallback, useEffect, useState } from 'react';
import { api, consulta, type PdfArquivado, type RespostaPdfs } from '../../core/api/cliente';
import { Botao } from '../../shared/componentes/Botao';
import { CampoData } from '../../shared/componentes/Campos';
import { Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeBusca } from '../../shared/componentes/Icones';
import { Paginacao } from '../../shared/componentes/Paginacao';
import { baixarBlob } from '../../shared/utils/download';
import { dataHoraEmissao, formatarBytes } from '../../shared/utils/texto';
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

/**
 * Arquivo dos PDFs de checklist emitidos pelos montadores: a documentação que
 * valida a garantia ABB em caso de falha ou quebra do material.
 */
export function ArquivoPdfs({ onSessaoVencida }: { onSessaoVencida: () => void }) {
  const [dados, setDados] = useState<RespostaPdfs | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [pagina, setPagina] = useState(1);
  const [baixando, setBaixando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDados(
        await api.get<RespostaPdfs>(
          `/api/admin/pdfs${consulta({
            pagina,
            busca: buscaAplicada,
            de: limiteDoDia(de, false),
            ate: limiteDoDia(ate, true),
          })}`,
        ),
      );
      setErro(null);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível ler o arquivo de PDFs.');
    }
  }, [onSessaoVencida, pagina, buscaAplicada, de, ate]);

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

  const baixar = async (pdf: PdfArquivado) => {
    setBaixando(pdf.uid);
    try {
      baixarBlob(await api.baixarArquivo(`/api/admin/pdfs/${pdf.uid}/arquivo`), pdf.nomeArquivo);
    } catch (e) {
      if (sessaoAdminAcabou(e)) onSessaoVencida();
      else setErro(e instanceof Error ? e.message : 'Não foi possível baixar o PDF.');
    } finally {
      setBaixando(null);
    }
  };

  const filtrando = Boolean(buscaAplicada || de || ate);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Arquivo de PDFs</h2>
        <p className="text-sm text-abb-gray">
          Todo PDF de checklist emitido pelos montadores, como saiu do aparelho —
          documentação para validar a garantia em caso de falha ou quebra do material.
        </p>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      <div className="grid gap-3 rounded-xl border border-abb-line bg-white p-3 shadow-sm sm:grid-cols-[1fr_11rem_11rem]">
        <label className="relative self-end">
          <span className="mb-1 block text-base font-semibold">Empresa ou projeto</span>
          <IconeBusca className="pointer-events-none absolute bottom-4 left-3 h-4 w-4 text-abb-gray" />
          <input
            type="search"
            placeholder="Buscar pelo nome…"
            className="min-h-12 w-full rounded-md border border-abb-line bg-white pr-3 pl-9 text-base focus:border-abb-red"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        <CampoData
          rotulo="Emitido de"
          valor={de}
          onChange={(v) => {
            setDe(v);
            setPagina(1);
          }}
        />
        <CampoData
          rotulo="Emitido até"
          valor={ate}
          onChange={(v) => {
            setAte(v);
            setPagina(1);
          }}
        />
        {filtrando ? (
          <div className="sm:col-span-3">
            <Botao
              tamanho="compacto"
              onClick={() => {
                setBusca('');
                setBuscaAplicada('');
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

      {!dados && !erro ? <Carregando mensagem="Lendo o arquivo de PDFs…" /> : null}

      {dados ? (
        dados.pdfs.length === 0 ? (
          <p className="rounded-xl border border-abb-line bg-white p-6 text-center text-sm text-abb-gray">
            Nenhum PDF {filtrando ? 'com esses filtros' : 'arquivado ainda'}.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-abb-line/70 overflow-hidden rounded-xl border border-abb-line bg-white shadow-sm">
              {dados.pdfs.map((pdf) => (
                <li key={pdf.uid} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold break-words">{pdf.empresa}</p>
                    <p className="text-sm break-words">
                      {pdf.nomeProjeto}
                      {pdf.painel ? ` · ${pdf.painel}` : ''} · {pdf.titulo}
                    </p>
                    <p className="text-xs text-abb-gray">
                      Emitido em{' '}
                      <time dateTime={new Date(pdf.emitidoEm).toISOString()}>
                        {dataHoraEmissao(new Date(pdf.emitidoEm))}
                      </time>
                      {' · '}por {pdf.montador ?? 'conta excluída'} · {formatarBytes(pdf.tamanho)}
                    </p>
                    <p className="text-xs break-all text-abb-gray">{pdf.nomeArquivo}</p>
                  </div>
                  <Botao
                    tamanho="compacto"
                    disabled={baixando === pdf.uid}
                    onClick={() => void baixar(pdf)}
                  >
                    {baixando === pdf.uid ? 'Baixando…' : 'Baixar'}
                  </Botao>
                </li>
              ))}
            </ul>
            <Paginacao pagina={dados.pagina} porPagina={dados.porPagina} total={dados.total} onMudar={setPagina} />
          </>
        )
      ) : null}
    </div>
  );
}
