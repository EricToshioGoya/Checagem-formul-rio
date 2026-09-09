import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { AtualizacaoPwa } from './AtualizacaoPwa';
import { RolarAoTopo } from './RolarAoTopo';
import { ListaProjetos } from '../features/projects/ListaProjetos';
import { NovoProjeto } from '../features/projects/NovoProjeto';
import { DetalheProjeto } from '../features/projects/DetalheProjeto';
import { Preenchimento } from '../features/fill/Preenchimento';
import { Admin } from '../features/admin/Admin';
import { Autorizacoes } from '../features/auth/Autorizacoes';
import { Bloqueio } from '../features/auth/Bloqueio';
import { ProvedorAutorizacao, useAutorizacao } from '../core/auth/contexto';
import { Carregando } from '../shared/componentes/Estado';

/**
 * HashRouter: a saída é estática e roda tanto em servidor HTTPS (modalidade A)
 * quanto no binário Go em localhost (modalidade B), sem exigir regra de
 * reescrita de URL em nenhum dos dois.
 */
export function App() {
  return (
    <ProvedorAutorizacao>
      <Portao />
    </ProvedorAutorizacao>
  );
}

/**
 * Nada do aplicativo é montado sem autorização vigente. A checagem é da
 * credencial guardada no aparelho, conferida offline — a rede não participa
 * da decisão de abrir ou não.
 */
function Portao() {
  const { carregando, sessao } = useAutorizacao();

  if (carregando) return <Carregando mensagem="Verificando o acesso…" />;
  if (!sessao) return <Bloqueio />;

  return (
    <HashRouter>
      <RolarAoTopo />
      <AtualizacaoPwa />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ListaProjetos />} />
          <Route path="/projetos/novo" element={<NovoProjeto />} />
          <Route path="/projetos/:projetoId" element={<DetalheProjeto />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/autorizacoes" element={<Autorizacoes />} />
        </Route>
        <Route
          path="/projetos/:projetoId/tags/:tagId/formularios/:formId"
          element={<Preenchimento />}
        />
        <Route path="*" element={<ListaProjetos />} />
      </Routes>
    </HashRouter>
  );
}
