import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSessao } from '../core/api/SessaoContexto';
import { Carregando } from '../shared/componentes/Estado';

/**
 * Portão das rotas internas. Manda para o login quem não tem sessão, guardando
 * o destino para voltar a ele depois de entrar.
 *
 * Isto é conveniência de navegação, não segurança: quem pode preencher o quê
 * é decidido pelo servidor, que não entrega dado nenhum sem token válido.
 */
export function ExigirSessao() {
  const { usuario, carregando } = useSessao();
  const localizacao = useLocation();

  if (carregando) return <Carregando mensagem="Verificando a sua sessão…" />;
  if (!usuario) {
    return (
      <Navigate
        to="/entrar"
        replace
        state={{ de: `${localizacao.pathname}${localizacao.search}` }}
      />
    );
  }
  return <Outlet />;
}
