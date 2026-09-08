import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PAINEL_PADRAO } from '../../core/config';
import { ProjetoRepository, type ResumoProjeto } from '../../core/db/repositorios';
import { progressoDoProjeto } from '../../core/forms/progressoProjeto';
import { obterPainel } from '../../core/paineis/catalogo';
import { Botao } from '../../shared/componentes/Botao';
import { BarraProgresso } from '../../shared/componentes/BarraProgresso';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Carregando, Erro, Vazio, Aviso } from '../../shared/componentes/Estado';
import { IconeLixeira, IconeMais, IconeSeta } from '../../shared/componentes/Icones';
import { VoltarAosPaineis } from '../../shared/componentes/VoltarAosPaineis';
import { dataHoraBr } from '../../shared/utils/texto';

function ehIphone(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const instalado = window.matchMedia('(display-mode: standalone)').matches;
  return iOS && !instalado;
}

export function ListaProjetos() {
  const navegar = useNavigate();
  const { tipoPainel = PAINEL_PADRAO } = useParams();
  const projetos = useLiveQuery(
    () => ProjetoRepository.listar(tipoPainel),
    [tipoPainel],
    undefined,
  );
  const [nomePainel, setNomePainel] = useState('');
  const [percentuais, setPercentuais] = useState<Record<number, number>>({});
  const [paraExcluir, setParaExcluir] = useState<ResumoProjeto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const entradaArquivo = useRef<HTMLInputElement>(null);

  // O nome do painel dá sentido ao botão de troca: mostra de onde se está saindo.
  useEffect(() => {
    let ativo = true;
    obterPainel(tipoPainel)
      .then((p) => ativo && setNomePainel(p.nome))
      .catch(() => ativo && setNomePainel(''));
    return () => {
      ativo = false;
    };
  }, [tipoPainel]);

  useEffect(() => {
    if (!projetos) return;
    let ativo = true;
    (async () => {
      const mapa: Record<number, number> = {};
      for (const p of projetos) {
        try {
          mapa[p.id] = (await progressoDoProjeto(p.id)).progresso.percentual;
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

  const aoImportar = useCallback(async (arquivo: File) => {
    setImportando(true);
    setErro(null);
    try {
      const { importarProjeto } = await import('../../core/export/backupProjeto');
      await importarProjeto(arquivo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao importar o arquivo.');
    } finally {
      setImportando(false);
    }
  }, []);

  if (!projetos) return <Carregando mensagem="Abrindo seus projetos…" />;

  return (
    <div className="space-y-4">
      <VoltarAosPaineis />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {nomePainel ? (
            <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
              {nomePainel}
            </p>
          ) : null}
          <h1 className="text-2xl font-bold">Meus projetos</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Botao onClick={() => entradaArquivo.current?.click()} disabled={importando}>
            {importando ? 'Importando…' : 'Importar projeto'}
          </Botao>
          <Botao
            variante="primario"
            onClick={() => navegar(`/paineis/${tipoPainel}/projetos/novo`)}
          >
            <IconeMais className="h-5 w-5" />
            Novo projeto
          </Botao>
        </div>
      </div>

      <input
        ref={entradaArquivo}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = '';
          if (arquivo) void aoImportar(arquivo);
        }}
      />

      {erro ? <Erro detalhe={erro} /> : null}

      {ehIphone() ? (
        <Aviso>
          <strong>iPhone e iPad:</strong> toque em Compartilhar e escolha
          “Adicionar à Tela de Início”. Sem isso, o Safari apaga os dados
          gravados depois de 7 dias sem uso.
        </Aviso>
      ) : null}

      {projetos.length === 0 ? (
        <Vazio titulo="Nenhum projeto gravado neste aparelho">
          Toque em <strong>Novo projeto</strong> para começar a registrar as
          verificações de montagem.
        </Vazio>
      ) : (
        <ul className="space-y-3">
          {projetos.map((p) => (
            <li key={p.id} className="rounded-lg border border-abb-line bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
                    {p.empresa}
                  </p>
                  <h2 className="text-xl font-bold break-words">{p.nomeProjeto}</h2>
                  <p className="mt-1 text-base text-abb-gray">
                    {p.quantidadeTags} {p.quantidadeTags === 1 ? 'TAG' : 'TAGs'} • Operador:{' '}
                    {p.operador || '—'}
                  </p>
                  <p className="text-sm text-abb-gray">
                    Última alteração: {dataHoraBr(p.atualizadoEm)}
                  </p>
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
                <BarraProgresso
                  percentual={percentuais[p.id] ?? 0}
                  rotulo="Preenchimento"
                  compacta
                />
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
            ? `O projeto “${paraExcluir.nomeProjeto}” será apagado deste aparelho, junto com todas as TAGs, respostas e fotos.\n\nEsta ação não pode ser desfeita.`
            : ''
        }
        onCancelar={() => setParaExcluir(null)}
        onConfirmar={async () => {
          if (paraExcluir) await ProjetoRepository.excluir(paraExcluir.id);
          setParaExcluir(null);
        }}
      />
    </div>
  );
}
