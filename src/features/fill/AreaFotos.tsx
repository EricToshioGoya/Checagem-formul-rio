import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ehMimeDeVideo, TAMANHO_MAXIMO_VIDEO } from '../../../compartilhado/midias';
import { MAX_FOTOS_POR_ETAPA, MidiaRepository } from '../../core/db/repositorios';
import { mimeDoVideo } from '../../core/media/apoio';
import { ehImagem, ehPdf, normalizarImagem } from '../../core/media/imagem';
import { Botao } from '../../shared/componentes/Botao';
import { Modal } from '../../shared/componentes/Modal';
import { Erro } from '../../shared/componentes/Estado';
import {
  IconeAnexo,
  IconeCamera,
  IconeLixeira,
  IconePlay,
  IconeVideo,
} from '../../shared/componentes/Icones';
import { formatarBytes } from '../../shared/utils/texto';

interface Props {
  preenchimentoId: number;
  etapaId: string;
  /** Em etapas do tipo `anexo_pdf` o arquivo é gravado sem recompressão. */
  aceitaPdf?: boolean;
  /** Etapas de foto e vídeo: o vídeo é gravado como veio, sem recompressão. */
  aceitaVideo?: boolean;
  onAlterou?: () => void;
}

const LIMITE_VIDEO_MB = Math.round(TAMANHO_MAXIMO_VIDEO / 1024 / 1024);

export function AreaFotos({ preenchimentoId, etapaId, aceitaPdf, aceitaVideo, onAlterou }: Props) {
  const midias = useLiveQuery(
    () => MidiaRepository.listarPorEtapa(preenchimentoId, etapaId),
    [preenchimentoId, etapaId],
    undefined,
  );
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const entradaCamera = useRef<HTMLInputElement>(null);
  const entradaVideo = useRef<HTMLInputElement>(null);
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
        const mimeVideo = aceitaVideo ? mimeDoVideo(arquivo) : null;
        if (mimeVideo) {
          if (arquivo.size > TAMANHO_MAXIMO_VIDEO) {
            setErro(
              `O vídeo "${arquivo.name}" tem ${formatarBytes(arquivo.size)} e passa do limite de ` +
                `${LIMITE_VIDEO_MB} MB. Grave um vídeo mais curto.`,
            );
            continue;
          }
          // Vai como foi gravado; o tipo fica explícito no arquivo porque é
          // ele que o servidor confere ao receber.
          await MidiaRepository.adicionar({
            preenchimentoId,
            etapaId,
            blob: new Blob([arquivo], { type: mimeVideo }),
            mime: mimeVideo,
            largura: 0,
            altura: 0,
            tamanho: arquivo.size,
            nomeOriginal: arquivo.name,
          });
          continue;
        }
        if (!ehImagem(arquivo)) {
          setErro(
            aceitaVideo && arquivo.type.startsWith('video/')
              ? 'Formato de vídeo não aceito. Use MP4, WebM ou MOV.'
              : aceitaVideo
                ? 'Somente fotos e vídeos são aceitos nesta etapa.'
                : 'Somente imagens são aceitas nesta etapa.',
          );
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
        {aceitaVideo ? (
          <Botao onClick={() => entradaVideo.current?.click()} disabled={cheio || processando}>
            <IconeVideo className="h-5 w-5" />
            Gravar vídeo
          </Botao>
        ) : null}
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
      {aceitaVideo ? (
        <input
          ref={entradaVideo}
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void adicionar(e.target.files);
            e.target.value = '';
          }}
        />
      ) : null}
      <input
        ref={entradaArquivo}
        type="file"
        multiple
        accept={[
          'image/*',
          aceitaVideo ? 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov' : '',
          aceitaPdf ? 'application/pdf' : '',
        ]
          .filter(Boolean)
          .join(',')}
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
              ) : ehMimeDeVideo(midia.mime) ? (
                <button
                  type="button"
                  onClick={() => setAmpliada(id)}
                  className="relative block h-24 w-24 overflow-hidden rounded-md border border-abb-line bg-abb-black"
                  aria-label="Assistir vídeo"
                >
                  {/* O primeiro quadro serve de miniatura; o vídeo só toca ampliado. */}
                  <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-abb-black shadow">
                      <IconePlay className="h-5 w-5" />
                    </span>
                  </span>
                </button>
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
        titulo={
          urls.some((u) => u.id === ampliada && ehMimeDeVideo(u.midia.mime))
            ? 'Vídeo da etapa'
            : 'Foto da etapa'
        }
        largura="larga"
        onFechar={() => setAmpliada(null)}
      >
        {(() => {
          const item = urls.find((u) => u.id === ampliada);
          if (!item) return null;
          if (ehMimeDeVideo(item.midia.mime)) {
            return (
              <figure className="space-y-2">
                <video src={item.url} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-md bg-abb-black" />
                <figcaption className="text-sm text-abb-gray">
                  {item.midia.nomeOriginal ? `${item.midia.nomeOriginal} • ` : ''}
                  {formatarBytes(item.midia.tamanho)}
                </figcaption>
              </figure>
            );
          }
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
