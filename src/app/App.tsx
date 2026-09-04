import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { AtualizacaoPwa } from './AtualizacaoPwa';
import { RolarAoTopo } from './RolarAoTopo';
import { SelecaoPainel } from '../features/paineis/SelecaoPainel';
import { ListaProjetos } from '../features/projects/ListaProjetos';
import { NovoProjeto } from '../features/projects/NovoProjeto';
import { DetalheProjeto } from '../features/projects/DetalheProjeto';
import { ListaSolicitacoes } from '../features/solicitacoes/ListaSolicitacoes';
import { NovaSolicitacao } from '../features/solicitacoes/NovaSolicitacao';
import { DetalheSolicitacao } from '../features/solicitacoes/DetalheSolicitacao';
import { Preenchimento } from '../features/fill/Preenchimento';
import { Admin } from '../features/admin/Admin';

/**
 * HashRouter: a saída é estática e roda tanto em servidor HTTPS (modalidade A)
 * quanto no binário Go em localhost (modalidade B), sem exigir regra de
 * reescrita de URL em nenhum dos dois.
 *
 * A raiz é a escolha do tipo de painel; dali saem os dois fluxos. As rotas
 * `/projetos/*` continuam válidas para os atalhos já salvos pelos montadores.
 */
export function App() {
  return (
    <HashRouter>
      <RolarAoTopo />
      <AtualizacaoPwa />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<SelecaoPainel />} />

          <Route path="/paineis/:tipoPainel/projetos" element={<ListaProjetos />} />
          <Route path="/projetos" element={<ListaProjetos />} />
          <Route path="/projetos/novo" element={<NovoProjeto />} />
          <Route path="/paineis/:tipoPainel/projetos/novo" element={<NovoProjeto />} />
          <Route path="/projetos/:projetoId" element={<DetalheProjeto />} />

          <Route path="/paineis/:tipoPainel/solicitacoes" element={<ListaSolicitacoes />} />
          <Route
            path="/paineis/:tipoPainel/solicitacoes/nova"
            element={<NovaSolicitacao />}
          />
          <Route path="/solicitacoes/:solicitacaoId" element={<DetalheSolicitacao />} />

          <Route path="/admin" element={<Admin />} />
        </Route>

        <Route
          path="/projetos/:projetoId/tags/:tagId/formularios/:formId"
          element={<Preenchimento />}
        />
        <Route path="/solicitacoes/:solicitacaoId/checklist" element={<Preenchimento />} />

        <Route path="*" element={<SelecaoPainel />} />
      </Routes>
    </HashRouter>
  );
}
