import { useEffect, useRef, useState } from 'react';
import { ehApoioDoServidor, obterImagemApoio } from '../../core/media/apoio';

const base = import.meta.env.BASE_URL;

/**
 * Endereço da imagem ou do vídeo de apoio para o `<img>` / `<video>`. A enviada pela administração vem
 * do aparelho (ou do servidor, uma vez); a publicada com o aplicativo é um
 * caminho relativo à base da publicação — nada aqui sai para a rede externa:
 * o schema já recusa esquema e `//`.
 */
export function useEnderecoApoio(src: string): { url: string | null; falhou: boolean } {
  const doServidor = ehApoioDoServidor(src);
  const [estado, setEstado] = useState<{ url: string | null; falhou: boolean }>(() =>
    doServidor ? { url: null, falhou: false } : { url: `${base}${src.replace(/^\/+/, '')}`, falhou: false },
  );

  useEffect(() => {
    if (!doServidor) {
      setEstado({ url: `${base}${src.replace(/^\/+/, '')}`, falhou: false });
      return;
    }
    let vivo = true;
    let url: string | null = null;
    setEstado({ url: null, falhou: false });
    obterImagemApoio(src)
      .then((blob) => {
        if (!vivo) return;
        url = URL.createObjectURL(blob);
        setEstado({ url, falhou: false });
      })
      .catch(() => {
        if (vivo) setEstado({ url: null, falhou: true });
      });
    return () => {
      vivo = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, doServidor]);

  return estado;
}

interface Props {
  src: string;
  alt: string;
  className?: string;
  /** Quando a imagem não pode ser exibida (sem rede, arquivo ausente). */
  onFalha?: () => void;
}

interface PropsVideo {
  src: string;
  className?: string;
  onFalha?: () => void;
}

/**
 * Vídeo de apoio. O enviado pela administração vem do aparelho (ou do
 * servidor, uma vez) e toca por endereço local, sem depender de rede; o
 * publicado com o aplicativo é um caminho relativo à base.
 */
export function VideoApoio({ src, className, onFalha }: PropsVideo) {
  const { url, falhou } = useEnderecoApoio(src);
  const aoFalhar = useRef(onFalha);
  aoFalhar.current = onFalha;
  useEffect(() => {
    if (falhou) aoFalhar.current?.();
  }, [falhou]);

  if (falhou) return null;
  if (!url) {
    return (
      <div
        role="status"
        aria-label="Carregando vídeo"
        className={`${className ?? ''} min-h-24 animate-pulse bg-abb-offwhite`}
      />
    );
  }
  return (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      className={className}
      onError={() => aoFalhar.current?.()}
    />
  );
}

export function ImagemApoio({ src, alt, className, onFalha }: Props) {
  const { url, falhou } = useEnderecoApoio(src);
  // Pela referência: quem usa costuma passar uma função nova a cada render.
  const aoFalhar = useRef(onFalha);
  aoFalhar.current = onFalha;
  useEffect(() => {
    if (falhou) aoFalhar.current?.();
  }, [falhou]);

  if (falhou) return null;
  if (!url) {
    return (
      <div
        role="status"
        aria-label="Carregando imagem"
        className={`${className ?? ''} min-h-24 animate-pulse bg-abb-offwhite`}
      />
    );
  }
  return <img src={url} alt={alt} className={className} onError={() => aoFalhar.current?.()} />;
}
