import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { solicitacaoStore } from '../../core/certificacao';
import { obterPainel } from '../../core/paineis/catalogo';
import type { Painel } from '../../core/paineis/tipos';
import type { Solicitacao } from '../../core/db/tipos';
import { Botao } from '../../shared/componentes/Botao';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Carregando, Erro, Vazio } from '../../shared/componentes/Estado';
import { IconeLixeira, IconeMais, IconeSeta } from '../../shared/componentes/Icones';
import { VoltarAosPaineis } from '../../shared/componentes/VoltarAosPaineis';
import { dataHoraBr } from '../../shared/utils/texto';
import { EtiquetaEstado } from './estado';

/** Solicitações de certificação de um tipo de painel, uma por painel/quadro. */
export function ListaSolicitacoes() {
  const { tipoPainel = '' } = useParams();
  const navegar = useNavigate();

  const [painel, setPainel] = useState<Painel | null>(null);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [paraExcluir, setParaExcluir] = useState<Solicitacao | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const [p, lista] = await Promise.all([
        obterPainel(tipoPainel),
        solicitacaoStore.listar({ tipoPainel }),
      ]);
      setPainel(p);
      setSolicitacoes(lista);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar as solicitações.');
    }
  }, [tipoPainel]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  if (erro) return <Erro detalhe={erro} />;
  if (!painel || !solicitacoes) return <Carregando mensagem="Carregando as solicitações…" />;

  return (
    <div className="space-y-4">
      <VoltarAosPaineis />

      <div className="min-w-0">
        <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
          Solicitação de certificação
        </p>
        <h1 className="text-2xl font-bold break-words">{painel.nome}</h1>
        {painel.responsavel ? (
          <p className="text-base text-abb-gray">
            Responsável ABB: {painel.responsavel.nome}
          </p>
        ) : null}
      </div>

      <Botao
        variante="primario"
        onClick={() => navegar(`/paineis/${tipoPainel}/solicitacoes/nova`)}
      >
        <IconeMais className="h-5 w-5" />
        Nova solicitação
      </Botao>

      {solicitacoes.length === 0 ? (
        <Vazio titulo="Nenhuma solicitação para este painel">
          Toque em <strong>Nova solicitação</strong> para registrar o primeiro
          painel/quadro.
        </Vazio>
      ) : (
        <ul className="space-y-3">
          {solicitacoes.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-abb-line bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold break-words">
                      {s.dados.tagPainel || 'Sem TAG'}
                    </h2>
                    <EtiquetaEstado estado={s.estado} />
                  </div>
                  <p className="mt-1 text-base text-abb-gray">
                    {s.dados.projeto || '—'} • {s.dados.clienteFinal || '—'}
                  </p>
                  {s.numeroCertificado ? (
                    <p className="text-base font-semibold text-green-800">
                      Certificado nº {s.numeroCertificado}
                    </p>
                  ) : null}
                  <p className="text-sm text-abb-gray">
                    Última alteração: {dataHoraBr(s.atualizadoEm)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {s.estado === 'rascunho' ? (
                    <Botao
                      variante="perigo"
                      aria-label={`Excluir solicitação ${s.dados.tagPainel}`}
                      onClick={() => setParaExcluir(s)}
                    >
                      <IconeLixeira className="h-5 w-5" />
                    </Botao>
                  ) : null}
                  <Botao variante="primario" onClick={() => navegar(`/solicitacoes/${s.id}`)}>
                    Abrir
                    <IconeSeta className="h-5 w-5" />
                  </Botao>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Confirmacao
        aberto={paraExcluir !== null}
        titulo="Excluir solicitação"
        mensagem={
          paraExcluir
            ? `A solicitação do painel “${paraExcluir.dados.tagPainel}” será apagada deste aparelho, junto com o checklist e as fotos.\n\nEsta ação não pode ser desfeita.`
            : ''
        }
        onCancelar={() => setParaExcluir(null)}
        onConfirmar={async () => {
          if (paraExcluir?.id) await solicitacaoStore.excluir(paraExcluir.id);
          setParaExcluir(null);
          await recarregar();
        }}
      />
    </div>
  );
}
