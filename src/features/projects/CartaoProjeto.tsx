import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ResumoProjeto } from '../../core/db/repositorios';
import { progressoDoProjeto } from '../../core/forms/progressoProjeto';
import { excluirProjetoEmTodaParte } from '../../core/sync/sincronizacao';
import { Botao } from '../../shared/componentes/Botao';
import { BarraProgresso } from '../../shared/componentes/BarraProgresso';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { IconeLixeira, IconeSeta } from '../../shared/componentes/Icones';
import { dataHoraBr } from '../../shared/utils/texto';
import { SituacaoSincronizacao } from './SituacaoSincronizacao';

/**
 * Percentual de preenchimento de cada projeto. Calculado com o painel do
 * projeto, como na tela dele: sem o painel, a conta usaria os checklists de
 * todos os painéis guardados no aparelho, e o número da lista não bateria com
 * o de dentro do projeto.
 */
export function usePercentuaisDosProjetos(projetos: ResumoProjeto[] | undefined): Record<number, number> {
  const [percentuais, setPercentuais] = useState<Record<number, number>>({});

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

  return percentuais;
}

interface Props {
  projeto: ResumoProjeto;
  percentual: number;
  onExcluir: (projeto: ResumoProjeto) => void;
}

/** Cartão de um projeto nas listas "Meus projetos" e "Projetos do painel". */
export function CartaoProjeto({ projeto: p, percentual, onExcluir }: Props) {
  const navegar = useNavigate();
  return (
    <li className="rounded-lg border border-abb-line bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
            {p.empresa.trim() || 'Empresa não informada'}
          </p>
          <h2 className="text-xl font-bold break-words">{p.nomeProjeto}</h2>
          <p className="mt-1 text-base text-abb-gray">
            {p.quantidadeTags} {p.quantidadeTags === 1 ? 'TAG' : 'TAGs'} • Operador: {p.operador || '—'}
          </p>
          <p className="text-sm text-abb-gray">Última alteração: {dataHoraBr(p.atualizadoEm)}</p>
          <SituacaoSincronizacao projeto={p} />
        </div>
        <div className="flex gap-2">
          <Botao
            variante="perigo"
            aria-label={`Excluir projeto ${p.nomeProjeto}`}
            onClick={() => onExcluir(p)}
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
        <BarraProgresso percentual={percentual} rotulo="Preenchimento" compacta />
      </div>
    </li>
  );
}

interface PropsExclusao {
  projeto: ResumoProjeto | null;
  onFechar: () => void;
}

/** Confirmação de exclusão, aqui e na cópia do servidor. */
export function ConfirmacaoExcluirProjeto({ projeto, onFechar }: PropsExclusao) {
  return (
    <Confirmacao
      aberto={projeto !== null}
      titulo="Excluir projeto"
      mensagem={
        projeto
          ? `O projeto “${projeto.nomeProjeto}” será apagado deste aparelho e da cópia no servidor, junto com todas as TAGs, respostas e fotos.\n\nEsta ação não pode ser desfeita aqui. Se foi por engano, a administração tem o backup dos últimos dias.`
          : ''
      }
      onCancelar={onFechar}
      onConfirmar={async () => {
        if (projeto) await excluirProjetoEmTodaParte(projeto);
        onFechar();
      }}
    />
  );
}
