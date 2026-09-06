import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { AtualizacaoPwa } from './AtualizacaoPwa';
import { RolarAoTopo } from './RolarAoTopo';
import { ListaProjetos } from '../features/projects/ListaProjetos';
import { NovoProjeto } from '../features/projects/NovoProjeto';
import { DetalheProjeto } from '../features/projects/DetalheProjeto';
import { Preenchimento } from '../features/fill/Preenchimento';
import { Admin } from '../features/admin/Admin';
import { Login } from '../features/auth/Login';
import { EscolhaPainel } from '../features/panels/EscolhaPainel';
import { SessaoProvider, useSessao } from '../features/auth/SessaoContexto';
import { Carregando } from '../shared/componentes/Estado';

/**
 * Acesso em dois passos antes da aplicação: e-mail liberado e, depois, o
 * painel escolhido. Nenhuma rota é montada antes dos dois — inclusive o
 * preenchimento aberto por URL.
 */
function Portao() {
  const { email, painel, carregando } = useSessao();

  if (carregando) return <Carregando mensagem="Verificando o acesso…" />;
  if (!email) return <Login />;
  if (!painel) return <EscolhaPainel />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<ListaProjetos />} />
        <Route path="/projetos/novo" element={<NovoProjeto />} />
        <Route path="/projetos/:projetoId" element={<DetalheProjeto />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route
        path="/projetos/:projetoId/tags/:tagId/formularios/:formId"
        element={<Preenchimento />}
      />
      <Route path="*" element={<ListaProjetos />} />
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
        <Portao />
      </HashRouter>
    </SessaoProvider>
  );
}
