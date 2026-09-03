import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Cada tela começa do início. Sem isto, abrir um projeto a partir do fim de
 * uma lista longa deixa a tela nova já rolada, escondendo o seu cabeçalho.
 */
export function RolarAoTopo() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return null;
}
