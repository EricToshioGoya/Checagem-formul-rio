import { useEffect, useState } from 'react';

export function useMediaQuery(consulta: string): boolean {
  const [combina, setCombina] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(consulta).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const aoMudar = () => setCombina(mq.matches);
    aoMudar();
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, [consulta]);

  return combina;
}

/** A partir de 1024 px a tela usa lista + painel de detalhe. */
export function useDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}
