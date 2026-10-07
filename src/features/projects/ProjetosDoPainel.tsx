import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ProjetoRepository, type ResumoProjeto } from '../../core/db/repositorios';
import { useSessao } from '../../core/api/SessaoContexto';
import { conferirAcessoPainel, painelGuardado, type Bloqueio } from '../../core/api/acessoLocal';
import { progressoDoProjeto } from '../../core/forms/progressoProjeto';
import { excluirProjetoEmTodaParte } from '../../core/sync/sincronizacao';
import { AcessoBloqueado } from '../paineis/AcessoBloqueado';
import { Botao } from '../../shared/componentes/Botao';
import { BarraProgresso } from '../../shared/componentes/BarraProgresso';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Carregando, Erro, Vazio } from '../../shared/componentes/Estado';
import { IconeLixeira, IconeMais, IconeSeta } from '../../shared/componentes/Icones';
import { VoltarAosPaineis } from '../../shared/componentes/VoltarAosPaineis';
import { dataHoraBr } from '../../shared/utils/texto';
import { SituacaoSincronizacao } from './SituacaoSincronizacao';

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
  const [percentuais, setPercentuais] = useState<Record<number, number>>({});
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

  useEffect(() => {
    if (!projetos) return;
    let ativo = true;
    (async () => {
      const mapa: Record<number, number> = {};
      for (const p of projetos) {
        try {
          mapa[p.id] = (await progressoDoProjeto(p.id, p.painelSlug)).progresso.percentual;
        } catch {
          mapa[p.id] = 0;
        }
      }
      if (ativo) setPercentuais(mapa);
    })();
    return () => {
      ativo = false;
    };
  }, [projetos]);

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
            <li key={p.id} className="rounded-lg border border-abb-line bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
                    {p.empresa.trim() || 'Empresa não informada'}
                  </p>
                  <h2 className="text-xl font-bold break-words">{p.nomeProjeto}</h2>
                  <p className="mt-1 text-base text-abb-gray">
                    {p.quantidadeTags} {p.quantidadeTags === 1 ? 'TAG' : 'TAGs'} • Operador:{' '}
                    {p.operador || '—'}
                  </p>
                  <p className="text-sm text-abb-gray">
                    Última alteração: {dataHoraBr(p.atualizadoEm)}
                  </p>
                  <SituacaoSincronizacao projeto={p} />
                </div>
                <div className="flex gap-2">
                  <Botao
                    variante="perigo"
                    aria-label={`Excluir projeto ${p.nomeProjeto}`}
                    onClick={() => setParaExcluir(p)}
                  >
                    <IconeLixeira className="h-5 w-5" />
                    <span className="hidden sm:inline">Excluir</span>
                  </Botao>
                  <Botao variante="primario" onClick={() => navegar(`/projetos/${p.id}`)}>
                    Abrir
                    <IconeSeta className="h-5 w-5" />
                  </Botao>
                </div>
              </div>
              <div className="mt-3">
                <BarraProgresso percentual={percentuais[p.id] ?? 0} rotulo="Preenchimento" compacta />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Confirmacao
        aberto={paraExcluir !== null}
        titulo="Excluir projeto"
        mensagem={
          paraExcluir
            ? `O projeto “${paraExcluir.nomeProjeto}” será apagado deste aparelho e da cópia no servidor, junto com todas as TAGs, respostas e fotos.\n\nEsta ação não pode ser desfeita aqui. Se foi por engano, a administração tem o backup dos últimos dias.`
            : ''
        }
        onCancelar={() => setParaExcluir(null)}
        onConfirmar={async () => {
          if (paraExcluir) await excluirProjetoEmTodaParte(paraExcluir);
          setParaExcluir(null);
        }}
      />
    </div>
  );
}
