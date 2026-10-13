import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ProjetoRepository, type ResumoProjeto } from '../../core/db/repositorios';
import { useSessao } from '../../core/api/SessaoContexto';
import { Botao } from '../../shared/componentes/Botao';
import { Carregando, Vazio, Aviso } from '../../shared/componentes/Estado';
import { IconeMais } from '../../shared/componentes/Icones';
import {
  CartaoProjeto,
  ConfirmacaoExcluirProjeto,
  usePercentuaisDosProjetos,
} from './CartaoProjeto';

function ehIphone(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const instalado = window.matchMedia('(display-mode: standalone)').matches;
  return iOS && !instalado;
}

export function ListaProjetos() {
  const navegar = useNavigate();
  const { usuario } = useSessao();
  const projetos = useLiveQuery(
    () => ProjetoRepository.listar(usuario?.id),
    [usuario?.id],
    undefined,
  );
  const percentuais = usePercentuaisDosProjetos(projetos);
  const [paraExcluir, setParaExcluir] = useState<ResumoProjeto | null>(null);

  if (!projetos) return <Carregando mensagem="Abrindo seus projetos…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Meus projetos</h1>
        <Botao variante="primario" onClick={() => navegar('/paineis')}>
          <IconeMais className="h-5 w-5" />
          Escolher painel
        </Botao>
      </div>

      {ehIphone() ? (
        <Aviso>
          <strong>iPhone e iPad:</strong> toque em Compartilhar e escolha
          “Adicionar à Tela de Início”. Sem isso, o Safari apaga os dados
          gravados depois de 7 dias sem uso.
        </Aviso>
      ) : null}

      {projetos.length === 0 ? (
        <Vazio titulo="Nenhum projeto gravado neste aparelho">
          Toque em <strong>Escolher painel</strong> e abra um painel aprovado
          para começar a registrar as verificações de montagem.
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
