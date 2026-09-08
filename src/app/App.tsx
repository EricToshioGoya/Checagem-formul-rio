import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { AtualizacaoPwa } from './AtualizacaoPwa';
import { RolarAoTopo } from './RolarAoTopo';
import { ListaProjetos } from '../features/projects/ListaProjetos';
import { NovoProjeto } from '../features/projects/NovoProjeto';
import { DetalheProjeto } from '../features/projects/DetalheProjeto';
import { Preenchimento } from '../features/fill/Preenchimento';
import { Admin } from '../features/admin/Admin';
import { SolicitacaoAcesso } from '../features/access/SolicitacaoAcesso';
import { AprovacaoResponsavel } from '../features/access/AprovacaoResponsavel';
import { PortaoAcesso } from '../features/access/PortaoAcesso';

/**
 * HashRouter: a saída é estática e roda tanto em servidor HTTPS (modalidade A)
 * quanto no binário Go em localhost (modalidade B), sem exigir regra de
 * reescrita de URL em nenhum dos dois.
 *
 * `/acesso` e `/aprovar` ficam fora do portão — são justamente as telas que
 * concedem o acesso. `/admin` segue com a sua própria senha.
 */
export function App() {
  return (
    <HashRouter>
      <RolarAoTopo />
      <AtualizacaoPwa />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/acesso" element={<SolicitacaoAcesso />} />
          <Route path="/aprovar" element={<AprovacaoResponsavel />} />
          <Route path="/admin" element={<Admin />} />
          <Route element={<PortaoAcesso />}>
            <Route path="/" element={<ListaProjetos />} />
            <Route path="/projetos/novo" element={<NovoProjeto />} />
            <Route path="/projetos/:projetoId" element={<DetalheProjeto />} />
            <Route path="*" element={<ListaProjetos />} />
          </Route>
        </Route>
        <Route element={<PortaoAcesso />}>
          <Route
            path="/projetos/:projetoId/tags/:tagId/formularios/:formId"
            element={<Preenchimento />}
          />
        </Route>
      </Routes>
    </HashRouter>
  );
}
