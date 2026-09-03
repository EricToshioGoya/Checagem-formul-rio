import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { MAX_FOTOS_POR_ETAPA, MidiaRepository } from '../../core/db/repositorios';
import { ehImagem, ehPdf, normalizarImagem } from '../../core/media/imagem';
import { Botao } from '../../shared/componentes/Botao';
import { Modal } from '../../shared/componentes/Modal';
import { Erro } from '../../shared/componentes/Estado';
import { IconeAnexo, IconeCamera, IconeLixeira } from '../../shared/componentes/Icones';
import { formatarBytes } from '../../shared/utils/texto';

interface Props {
  preenchimentoId: number;
  etapaId: string;
  /** Em etapas do tipo `anexo_pdf` o arquivo é gravado sem recompressão. */
  aceitaPdf?: boolean;
  onAlterou?: () => void;
}

export function AreaFotos({ preenchimentoId, etapaId, aceitaPdf, onAlterou }: Props) {
  const midias = useLiveQuery(
    () => MidiaRepository.listarPorEtapa(preenchimentoId, etapaId),
    [preenchimentoId, etapaId],
    undefined,
  );
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const entradaCamera = useRef<HTMLInputElement>(null);
  const entradaArquivo = useRef<HTMLInputElement>(null);

  const urls = useMemo(
    () => (midias ?? []).map((m) => ({ id: m.id!, url: URL.createObjectURL(m.blob), midia: m })),
    [midias],
  );

  useEffect(
    () => () => {
      urls.forEach((u) => URL.revokeObjectURL(u.url));
    },
    [urls],
  );

  const quantidade = midias?.length ?? 0;
  const cheio = quantidade >= MAX_FOTOS_POR_ETAPA;

  const adicionar = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return;
    setErro(null);
    setProcessando(true);
    try {
      const espaco = MAX_FOTOS_POR_ETAPA - quantidade;
      const lista = Array.from(arquivos).slice(0, Math.max(0, espaco));
      if (lista.length < arquivos.length) {
        setErro(`Máximo de ${MAX_FOTOS_POR_ETAPA} arquivos por etapa.`);
      }
      for (const arquivo of lista) {
        if (aceitaPdf && ehPdf(arquivo)) {
          await MidiaRepository.adicionar({
            preenchimentoId,
            etapaId,
            blob: arquivo,
            mime: 'application/pdf',
            largura: 0,
            altura: 0,
            tamanho: arquivo.size,
            nomeOriginal: arquivo.name,
          });
          continue;
        }
        if (!ehImagem(arquivo)) {
          setErro('Somente imagens são aceitas nesta etapa.');
          continue;
        }
        const normalizada = await normalizarImagem(arquivo);
        await MidiaRepository.adicionar({
          preenchimentoId,
          etapaId,
          blob: normalizada.blob,
          mime: normalizada.mime,
          largura: normalizada.largura,
          altura: normalizada.altura,
          tamanho: normalizada.tamanho,
          nomeOriginal: arquivo.name,
        });
      }
      onAlterou?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao gravar o arquivo.');
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Botao onClick={() => entradaCamera.current?.click()} disabled={cheio || processando}>
          <IconeCamera className="h-5 w-5" />
          Tirar foto
        </Botao>
        <Botao onClick={() => entradaArquivo.current?.click()} disabled={cheio || processando}>
          <IconeAnexo className="h-5 w-5" />
          Anexar arquivo
        </Botao>
        <span className="text-sm text-abb-gray">
          {quantidade} de {MAX_FOTOS_POR_ETAPA}
          {processando ? ' • processando…' : ''}
        </span>
      </div>

      <input
        ref={entradaCamera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void adicionar(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={entradaArquivo}
        type="file"
        multiple
        accept={aceitaPdf ? 'image/*,application/pdf' : 'image/*'}
        className="hidden"
        onChange={(e) => {
          void adicionar(e.target.files);
          e.target.value = '';
        }}
      />

      {erro ? <Erro titulo="Atenção" detalhe={erro} /> : null}

      {urls.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {urls.map(({ id, url, midia }) => (
            <li key={id} className="relative">
              {midia.mime === 'application/pdf' ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-24 w-24 flex-col items-center justify-center rounded-md border border-abb-line bg-white p-1 text-center text-xs"
                >
                  <IconeAnexo className="h-7 w-7 text-abb-red" />
                  <span className="mt-1 line-clamp-2 break-all">
                    {midia.nomeOriginal ?? 'documento.pdf'}
                  </span>
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => setAmpliada(id)}
                  className="block h-24 w-24 overflow-hidden rounded-md border border-abb-line"
                  aria-label="Ampliar foto"
                >
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </button>
              )}
              <button
                type="button"
                aria-label="Remover arquivo"
                onClick={async () => {
                  await MidiaRepository.remover(id);
                  onAlterou?.();
                }}
                className="absolute -top-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full border border-abb-red bg-white text-abb-red shadow"
              >
                <IconeLixeira className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Modal
        aberto={ampliada !== null}
        titulo="Foto da etapa"
        largura="larga"
        onFechar={() => setAmpliada(null)}
      >
        {(() => {
          const item = urls.find((u) => u.id === ampliada);
          if (!item) return null;
          return (
            <figure className="space-y-2">
              <img src={item.url} alt="" className="w-full rounded-md" />
              <figcaption className="text-sm text-abb-gray">
                {item.midia.largura}×{item.midia.altura} px •{' '}
                {formatarBytes(item.midia.tamanho)}
              </figcaption>
            </figure>
          );
        })()}
      </Modal>
    </div>
  );
}
