import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { LimiteDeErro } from './LimiteDeErro';
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
import { ProjetosDoPainel } from '../features/projects/ProjetosDoPainel';
import { NovoProjeto } from '../features/projects/NovoProjeto';
import { ListaSolicitacoes } from '../features/solicitacoes/ListaSolicitacoes';
import { NovaSolicitacao } from '../features/solicitacoes/NovaSolicitacao';
import { DetalheSolicitacao } from '../features/solicitacoes/DetalheSolicitacao';
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
        <LimiteDeErro>
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
                {/* O projeto nasce dentro de um painel aprovado — é o que
                    garante que a pessoa preencha apenas aquilo que pediu e
                    teve aprovado. Um painel tem vários projetos. */}
                <Route path="/paineis/:painelId/projetos" element={<ProjetosDoPainel />} />
                <Route path="/paineis/:painelId/projetos/novo" element={<NovoProjeto />} />
                <Route path="/projetos/:projetoId" element={<DetalheProjeto />} />
                {/* Fluxo de certificação (SPEE, SPEP e SAFR): uma solicitação
                    por painel/quadro, validada pela ABB antes do certificado. */}
                <Route path="/paineis/:tipoPainel/solicitacoes" element={<ListaSolicitacoes />} />
                <Route
                  path="/paineis/:tipoPainel/solicitacoes/nova"
                  element={<NovaSolicitacao />}
                />
                <Route path="/solicitacoes/:solicitacaoId" element={<DetalheSolicitacao />} />
                <Route element={<ExigirAdmin />}>
                  <Route path="/admin" element={<Admin />} />
                </Route>
              </Route>
              <Route
                path="/projetos/:projetoId/tags/:tagId/formularios/:formId"
                element={<Preenchimento />}
              />
              <Route path="/solicitacoes/:solicitacaoId/checklist" element={<Preenchimento />} />
            </Route>

            {/* Rota desconhecida volta à raiz, que já passa pelo portão. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </LimiteDeErro>
      </HashRouter>
    </ProvedorSessao>
  );
}
