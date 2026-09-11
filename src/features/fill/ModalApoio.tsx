import { useState } from 'react';
import { Modal } from '../../shared/componentes/Modal';
import { Aviso } from '../../shared/componentes/Estado';
import type { Etapa } from '../../core/forms/tipos';

interface Props {
  etapa: Etapa | null;
  onFechar: () => void;
}

const base = import.meta.env.BASE_URL;

/**
 * Resolve o caminho do arquivo de apoio dentro da aplicação.
 *
 * Nada aqui sai para a rede externa: o schema já recusa esquema e `//`, e esta
 * função só monta o caminho relativo à base da publicação.
 */
function caminho(src: string): string {
  return `${base}${src.replace(/^\/+/, '')}`;
}

/**
 * Conteúdo de apoio da etapa: imagem, vídeo ou manual em PDF.
 * Arquivo ausente não quebra a tela — mostra o aviso e o caminho esperado,
 * o que também serve de guia para quem for recortar as imagens.
 */
export function ModalApoio({ etapa, onFechar }: Props) {
  const [falhas, setFalhas] = useState<Record<string, boolean>>({});
  if (!etapa) return null;
  const midias = etapa.midiaApoio ?? [];

  return (
    <Modal aberto titulo={`Ajuda — etapa ${etapa.id}`} largura="larga" onFechar={onFechar}>
      <div className="space-y-4">
        <p className="text-base font-semibold">{etapa.descricao}</p>

        {etapa.detalhes?.length ? (
          <ul className="list-disc space-y-1 pl-5 text-base">
            {etapa.detalhes.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : null}

        {etapa.referencia ? (
          <p className="text-base text-abb-gray">Referência: {etapa.referencia}</p>
        ) : null}

        {midias.length === 0 ? (
          <Aviso>Esta etapa ainda não tem conteúdo de apoio cadastrado.</Aviso>
        ) : (
          midias.map((m, i) => {
            const url = caminho(m.src);
            const falhou = falhas[m.src];
            return (
              <figure key={i} className="space-y-2">
                {falhou ? (
                  <Aviso>
                    Arquivo de apoio ainda não disponível neste aparelho.
                    <br />
                    Caminho esperado: <code className="break-all">{m.src}</code>
                  </Aviso>
                ) : m.tipo === 'imagem' ? (
                  <img
                    src={url}
                    alt={m.legenda ?? `Referência da etapa ${etapa.id}`}
                    className="w-full rounded-md border border-abb-line bg-white"
                    onError={() => setFalhas((f) => ({ ...f, [m.src]: true }))}
                  />
                ) : m.tipo === 'video' ? (
                  <video
                    src={url}
                    controls
                    playsInline
                    className="w-full rounded-md border border-abb-line bg-black"
                    onError={() => setFalhas((f) => ({ ...f, [m.src]: true }))}
                  />
                ) : (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-12 items-center rounded-md border border-abb-line bg-white px-4 font-semibold text-abb-red"
                  >
                    Abrir manual em PDF
                  </a>
                )}
                {m.legenda ? (
                  <figcaption className="text-sm text-abb-gray">{m.legenda}</figcaption>
                ) : null}
              </figure>
            );
          })
        )}
      </div>
    </Modal>
  );
}
