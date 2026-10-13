import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ProjetoRepository, type ResumoProjeto } from '../../core/db/repositorios';
import { useSessao } from '../../core/api/SessaoContexto';
import { conferirAcessoPainel, painelGuardado, type Bloqueio } from '../../core/api/acessoLocal';
import { AcessoBloqueado } from '../paineis/AcessoBloqueado';
import { Botao } from '../../shared/componentes/Botao';
import { Carregando, Erro, Vazio } from '../../shared/componentes/Estado';
import { IconeMais } from '../../shared/componentes/Icones';
import { VoltarAosPaineis } from '../../shared/componentes/VoltarAosPaineis';
import {
  CartaoProjeto,
  ConfirmacaoExcluirProjeto,
  usePercentuaisDosProjetos,
} from './CartaoProjeto';

/**
 * Projetos do montador num painel. Um painel (SEN Plus, MNS…) é o tipo; cada
 * obra é um projeto, com as suas TAGs.
 */
export function ProjetosDoPainel() {
  const { painelId } = useParams();
  const id = Number(painelId);
  const navegar = useNavigate();
  const { usuario } = useSessao();

  const [bloqueio, setBloqueio] = useState<Bloqueio | null | undefined>(undefined);
  const [nomePainel, setNomePainel] = useState<string | null>(null);
  const [paraExcluir, setParaExcluir] = useState<ResumoProjeto | null>(null);

  const projetos = useLiveQuery(
    () => (usuario && Number.isFinite(id) ? ProjetoRepository.listarDoPainel(usuario.id, id) : []),
    [usuario?.id, id],
    undefined,
  );

  useEffect(() => {
    if (!usuario || !Number.isFinite(id)) return;
    let ativo = true;
    void conferirAcessoPainel(usuario.id, id).then((b) => {
      if (!ativo) return;
      setBloqueio(b);
      setNomePainel(painelGuardado(usuario.id, id)?.nome ?? null);
    });
    return () => {
      ativo = false;
    };
  }, [usuario, id]);

  const percentuais = usePercentuaisDosProjetos(projetos);

  if (!Number.isFinite(id)) return <Erro detalhe="Painel inválido." />;
  if (!projetos || bloqueio === undefined) return <Carregando mensagem="Abrindo os projetos…" />;
  if (bloqueio) return <AcessoBloqueado bloqueio={bloqueio} />;

  const novo = () => navegar(`/paineis/${id}/projetos/novo`);

  return (
    <div className="space-y-4">
      <VoltarAosPaineis />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
            Verificação de montagem
          </p>
          <h1 className="text-2xl font-bold break-words">{nomePainel ?? 'Projetos'}</h1>
        </div>
        <Botao variante="primario" onClick={novo}>
          <IconeMais className="h-5 w-5" />
          Novo projeto
        </Botao>
      </div>

      {projetos.length === 0 ? (
        <Vazio titulo="Nenhum projeto neste painel">
          <p>Crie o projeto com as TAGs e os dados de cada painel para começar as checagens.</p>
          <div className="mt-4 flex justify-center">
            <Botao variante="primario" onClick={novo}>
              <IconeMais className="h-5 w-5" />
              Novo projeto
            </Botao>
          </div>
        </Vazio>
      ) : (
        <ul className="space-y-3">
          {projetos.map((p) => (
            <CartaoProjeto
              key={p.id}
              projeto={p}
              percentual={percentuais[p.id] ?? 0}
              onExcluir={setParaExcluir}
            />
          ))}
        </ul>
      )}

      <ConfirmacaoExcluirProjeto projeto={paraExcluir} onFechar={() => setParaExcluir(null)} />
    </div>
  );
}
