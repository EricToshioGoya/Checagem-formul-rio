import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProjetoRepository } from '../../core/db/repositorios';
import {
  progressoDoProjeto,
  type ProgressoDeProjeto,
} from '../../core/forms/progressoProjeto';
import type { Projeto } from '../../core/db/tipos';
import { DialogoGerarPdf } from '../pdf/DialogoGerarPdf';
import { Botao } from '../../shared/componentes/Botao';
import { BarraProgresso } from '../../shared/componentes/BarraProgresso';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Modal } from '../../shared/componentes/Modal';
import { Carregando, Erro, Vazio } from '../../shared/componentes/Estado';
import {
  IconeLixeira,
  IconeMais,
  IconePdf,
  IconeSeta,
  IconeVoltar,
} from '../../shared/componentes/Icones';

export function DetalheProjeto() {
  const { projetoId } = useParams();
  const id = Number(projetoId);
  const navegar = useNavigate();

  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [dados, setDados] = useState<ProgressoDeProjeto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tagParaExcluir, setTagParaExcluir] = useState<{ id: number; nome: string } | null>(null);
  const [tagParaRenomear, setTagParaRenomear] = useState<{ id: number; nome: string } | null>(null);
  const [novoNome, setNovoNome] = useState('');
  const [adicionando, setAdicionando] = useState(false);
  const [nomeNovaTag, setNomeNovaTag] = useState('');
  const [pdfAberto, setPdfAberto] = useState(false);
  const [exportando, setExportando] = useState(false);

  const recarregar = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    try {
      const [p, d] = await Promise.all([ProjetoRepository.obter(id), progressoDoProjeto(id)]);
      if (!p) {
        setErro('Projeto não encontrado neste aparelho.');
        return;
      }
      setProjeto(p);
      setDados(d);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o projeto.');
    }
  }, [id]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  if (erro) return <Erro detalhe={erro} />;
  if (!projeto || !dados) return <Carregando mensagem="Carregando o projeto…" />;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <Botao variante="texto" onClick={() => navegar('/')} aria-label="Voltar aos projetos">
          <IconeVoltar />
        </Botao>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-wide text-abb-gray uppercase">
            {projeto.empresa}
          </p>
          <h1 className="text-2xl font-bold break-words">{projeto.nomeProjeto}</h1>
          <p className="text-base text-abb-gray">Operador: {projeto.operador || '—'}</p>
        </div>
      </div>

      <div className="rounded-lg border border-abb-line bg-white p-4">
        <BarraProgresso
          percentual={dados.progresso.percentual}
          rotulo={`Preenchimento geral — ${dados.progresso.respondidas} de ${dados.progresso.total} etapas`}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Botao variante="primario" onClick={() => setPdfAberto(true)}>
            <IconePdf className="h-5 w-5" />
            Gerar PDF
          </Botao>
          <Botao onClick={() => setAdicionando(true)}>
            <IconeMais className="h-5 w-5" />
            Adicionar TAG
          </Botao>
          <Botao
            disabled={exportando}
            onClick={async () => {
              setExportando(true);
              try {
                const { exportarProjeto } = await import('../../core/export/backupProjeto');
                await exportarProjeto(id);
              } catch (e) {
                setErro(e instanceof Error ? e.message : 'Falha ao exportar.');
              } finally {
                setExportando(false);
              }
            }}
          >
            {exportando ? 'Exportando…' : 'Exportar projeto'}
          </Botao>
        </div>
      </div>

      {dados.tags.length === 0 ? (
        <Vazio titulo="Nenhuma TAG cadastrada">
          Adicione a primeira TAG para começar o preenchimento.
        </Vazio>
      ) : (
        <ul className="space-y-4">
          {dados.tags.map((tag) => (
            <li key={tag.tagId} className="rounded-lg border border-abb-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-bold break-words">{tag.nome}</h2>
                <div className="flex gap-2">
                  <Botao
                    onClick={() => {
                      setTagParaRenomear({ id: tag.tagId, nome: tag.nome });
                      setNovoNome(tag.nome);
                    }}
                  >
                    Renomear
                  </Botao>
                  <Botao
                    variante="perigo"
                    aria-label={`Remover TAG ${tag.nome}`}
                    onClick={() => setTagParaExcluir({ id: tag.tagId, nome: tag.nome })}
                  >
                    <IconeLixeira className="h-5 w-5" />
                  </Botao>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {tag.formularios.map((f) => (
                  <button
                    key={f.formId}
                    type="button"
                    onClick={() =>
                      navegar(`/projetos/${id}/tags/${tag.tagId}/formularios/${f.formId}`)
                    }
                    className="flex min-h-24 flex-col justify-between rounded-lg border-2 border-abb-line p-3 text-left hover:border-abb-red focus-visible:border-abb-red"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-base font-bold">
                          {f.entrada.tipo === 'montagem' ? 'Montagem' : 'Rotina'}
                        </p>
                        <p className="text-sm text-abb-gray">{f.entrada.linhaProduto}</p>
                      </div>
                      <IconeSeta className="h-5 w-5 shrink-0 text-abb-red" />
                    </div>
                    <div className="mt-3">
                      <BarraProgresso percentual={f.progresso.percentual} compacta />
                      <p className="mt-1 text-sm text-abb-gray">
                        {f.progresso.respondidas} de {f.progresso.total} etapas
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        aberto={adicionando}
        titulo="Adicionar TAG"
        onFechar={() => setAdicionando(false)}
        rodape={
          <>
            <Botao onClick={() => setAdicionando(false)}>Cancelar</Botao>
            <Botao
              variante="primario"
              onClick={async () => {
                if (!nomeNovaTag.trim()) return;
                await ProjetoRepository.adicionarTag(id, nomeNovaTag);
                setNomeNovaTag('');
                setAdicionando(false);
                await recarregar();
              }}
            >
              Adicionar
            </Botao>
          </>
        }
      >
        <CampoTexto rotulo="Nome da TAG" valor={nomeNovaTag} onChange={setNomeNovaTag} autoFoco />
      </Modal>

      <Modal
        aberto={tagParaRenomear !== null}
        titulo="Renomear TAG"
        onFechar={() => setTagParaRenomear(null)}
        rodape={
          <>
            <Botao onClick={() => setTagParaRenomear(null)}>Cancelar</Botao>
            <Botao
              variante="primario"
              onClick={async () => {
                if (tagParaRenomear && novoNome.trim()) {
                  await ProjetoRepository.renomearTag(tagParaRenomear.id, novoNome);
                }
                setTagParaRenomear(null);
                await recarregar();
              }}
            >
              Salvar
            </Botao>
          </>
        }
      >
        <CampoTexto rotulo="Novo nome" valor={novoNome} onChange={setNovoNome} autoFoco />
      </Modal>

      <Confirmacao
        aberto={tagParaExcluir !== null}
        titulo="Remover TAG"
        mensagem={
          tagParaExcluir
            ? `A TAG “${tagParaExcluir.nome}” será removida, junto com as respostas e fotos dos dois formulários.\n\nEsta ação não pode ser desfeita.`
            : ''
        }
        textoConfirmar="Remover"
        onCancelar={() => setTagParaExcluir(null)}
        onConfirmar={async () => {
          if (tagParaExcluir) await ProjetoRepository.removerTag(tagParaExcluir.id);
          setTagParaExcluir(null);
          await recarregar();
        }}
      />

      <DialogoGerarPdf
        aberto={pdfAberto}
        projetoId={id}
        onFechar={() => setPdfAberto(false)}
      />
    </div>
  );
}
