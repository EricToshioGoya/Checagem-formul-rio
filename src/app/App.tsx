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
import { Login } from '../features/auth/Login';
import { SessaoProvider, useSessao } from '../features/auth/SessaoContexto';
import { SolicitacaoAcesso } from '../features/access/SolicitacaoAcesso';
import { AprovacaoResponsavel } from '../features/access/AprovacaoResponsavel';
import { PortaoAcesso } from '../features/access/PortaoAcesso';
import { Carregando } from '../shared/componentes/Estado';

/**
 * Acesso em três passos antes do fluxo: e-mail no login, escolha do painel e
 * aprovação do responsável daquele painel. Nenhuma tela de trabalho é montada
 * antes dos três — inclusive o preenchimento aberto por URL direta.
 *
 * `/aprovar` é a exceção deliberada: é a tela que o responsável abre a partir
 * do e-mail, e ela não depende de sessão nem concede acesso a nada.
 */
function Rotas() {
  const { email, carregando } = useSessao();

  if (carregando) return <Carregando mensagem="Verificando o acesso…" />;

  return (
    <Routes>
      <Route path="/aprovar" element={<AprovacaoResponsavel />} />
      {!email ? (
        <Route path="*" element={<Login />} />
      ) : (
        <>
          <Route element={<Layout />}>
            <Route path="/" element={<SelecaoPainel />} />
            <Route path="/acesso" element={<SolicitacaoAcesso />} />
            <Route path="/admin" element={<Admin />} />

            <Route element={<PortaoAcesso />}>
              <Route path="/paineis/:tipoPainel/projetos" element={<ListaProjetos />} />
              <Route path="/projetos" element={<ListaProjetos />} />
              <Route path="/projetos/novo" element={<NovoProjeto />} />
              <Route path="/paineis/:tipoPainel/projetos/novo" element={<NovoProjeto />} />
              <Route path="/projetos/:projetoId" element={<DetalheProjeto />} />

              <Route
                path="/paineis/:tipoPainel/solicitacoes"
                element={<ListaSolicitacoes />}
              />
              <Route
                path="/paineis/:tipoPainel/solicitacoes/nova"
                element={<NovaSolicitacao />}
              />
              <Route path="/solicitacoes/:solicitacaoId" element={<DetalheSolicitacao />} />
            </Route>
          </Route>

          <Route element={<PortaoAcesso />}>
            <Route
              path="/projetos/:projetoId/tags/:tagId/formularios/:formId"
              element={<Preenchimento />}
            />
            <Route path="/solicitacoes/:solicitacaoId/checklist" element={<Preenchimento />} />
          </Route>

          <Route path="*" element={<SelecaoPainel />} />
        </>
      )}
    </Routes>
  );
}

/**
 * HashRouter: a saída é estática e roda tanto em servidor HTTPS (modalidade A)
 * quanto no binário Go em localhost (modalidade B), sem exigir regra de
 * reescrita de URL em nenhum dos dois.
 */
export function App() {
  return (
    <SessaoProvider>
      <HashRouter>
        <RolarAoTopo />
        <AtualizacaoPwa />
        <Rotas />
      </HashRouter>
    </SessaoProvider>
  );
}
