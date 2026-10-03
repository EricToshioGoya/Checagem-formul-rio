import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { AtualizacaoPwa } from './AtualizacaoPwa';
import { RolarAoTopo } from './RolarAoTopo';
import { ExigirSessao } from './ExigirSessao';
import { ExigirAdmin } from './ExigirAdmin';
import { SincronizacaoAutomatica } from './SincronizacaoAutomatica';
import { ProvedorSessao } from '../core/api/SessaoContexto';
import { Entrar } from '../features/auth/Entrar';
import { Paineis } from '../features/paineis/Paineis';
import { Aprovacoes } from '../features/paineis/Aprovacoes';
import { ListaProjetos } from '../features/projects/ListaProjetos';
import { DetalheProjeto } from '../features/projects/DetalheProjeto';
import { Preenchimento } from '../features/fill/Preenchimento';
import { Admin } from '../features/admin/Admin';

/**
 * HashRouter: a saída é estática e roda tanto em servidor HTTPS (modalidade A)
 * quanto no binário Go em localhost (modalidade B), sem exigir regra de
 * reescrita de URL em nenhum dos dois.
 */
export function App() {
  return (
    <ProvedorSessao>
      <SincronizacaoAutomatica />
      <HashRouter>
        <RolarAoTopo />
        <AtualizacaoPwa />
        <Routes>
          {/* Única rota aberta: é por onde se entra. */}
          <Route element={<Layout />}>
            <Route path="/entrar" element={<Entrar />} />
          </Route>

          <Route element={<ExigirSessao />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Paineis />} />
              <Route path="/paineis" element={<Paineis />} />
              <Route path="/aprovacoes" element={<Aprovacoes />} />
              <Route path="/projetos" element={<ListaProjetos />} />
              {/* Não há mais criação avulsa de projeto: um projeto só nasce
                  ao abrir um painel aprovado, e é o que garante que a pessoa
                  preencha apenas aquilo que pediu e teve aprovado. */}
              <Route path="/projetos/:projetoId" element={<DetalheProjeto />} />
              <Route element={<ExigirAdmin />}>
                <Route path="/admin" element={<Admin />} />
              </Route>
            </Route>
            <Route
              path="/projetos/:projetoId/tags/:tagId/formularios/:formId"
              element={<Preenchimento />}
            />
          </Route>

          {/* Rota desconhecida volta à raiz, que já passa pelo portão. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ProvedorSessao>
  );
}
