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
import { PainelProvider, usePainelAtivo } from '../features/paineis/PainelAtivo';
import { Carregando } from '../shared/componentes/Estado';

/**
 * A ferramenta não tem login nem aprovação: quem abre o endereço usa. O
 * controle de quem pode registrar montagem é organizacional — cada parceiro
 * recebe o endereço do painel que lhe cabe.
 *
 * A escolha do painel decide o fluxo (verificação ou certificação) e o
 * conjunto de formulários; ela fica gravada no aparelho, então a abertura
 * seguinte já cai no painel de sempre.
 */
function Rotas() {
  const { carregando } = usePainelAtivo();

  if (carregando) return <Carregando mensagem="Carregando os painéis…" />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<SelecaoPainel />} />
        <Route path="/admin" element={<Admin />} />

        <Route path="/paineis/:tipoPainel/projetos" element={<ListaProjetos />} />
        <Route path="/projetos" element={<ListaProjetos />} />
        <Route path="/projetos/novo" element={<NovoProjeto />} />
        <Route path="/paineis/:tipoPainel/projetos/novo" element={<NovoProjeto />} />
        <Route path="/projetos/:projetoId" element={<DetalheProjeto />} />

        <Route path="/paineis/:tipoPainel/solicitacoes" element={<ListaSolicitacoes />} />
        <Route path="/paineis/:tipoPainel/solicitacoes/nova" element={<NovaSolicitacao />} />
        <Route path="/solicitacoes/:solicitacaoId" element={<DetalheSolicitacao />} />
      </Route>

      <Route
        path="/projetos/:projetoId/tags/:tagId/formularios/:formId"
        element={<Preenchimento />}
      />
      <Route path="/solicitacoes/:solicitacaoId/checklist" element={<Preenchimento />} />

      <Route path="*" element={<SelecaoPainel />} />
    </Routes>
  );
}

export function App() {
  return (
    <PainelProvider>
      <HashRouter>
        <RolarAoTopo />
        <AtualizacaoPwa />
        <Rotas />
      </HashRouter>
    </PainelProvider>
  );
}
