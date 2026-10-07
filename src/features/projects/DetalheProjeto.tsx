import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProjetoRepository } from '../../core/db/repositorios';
import { useSessao } from '../../core/api/SessaoContexto';
import { useEstadoSincronizacao } from '../../core/sync/useSincronizacao';
import { conferirAcessoPainel, type Bloqueio } from '../../core/api/acessoLocal';
import { AcessoBloqueado } from '../paineis/AcessoBloqueado';
import {
  progressoDoProjeto,
  type ProgressoDeProjeto,
} from '../../core/forms/progressoProjeto';
import { carregarFormulario, formulariosDoPainel } from '../../core/forms/catalogo';
import {
  prepararTag,
  trocarChecklistsDaTag,
  valoresDoProjeto,
} from '../../core/forms/dadosTag';
import type {
  DefinicaoFormulario,
  EntradaCatalogo,
  ValoresCabecalho,
} from '../../core/forms/tipos';
import type { Projeto } from '../../core/db/tipos';
import { DialogoGerarPdf } from '../pdf/DialogoGerarPdf';
import { Botao } from '../../shared/componentes/Botao';
import { BarraProgresso } from '../../shared/componentes/BarraProgresso';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Modal } from '../../shared/componentes/Modal';
import { Aviso, Carregando, Erro, Vazio } from '../../shared/componentes/Estado';
import { SituacaoSincronizacao } from './SituacaoSincronizacao';
import { EscolhaChecklists } from './EscolhaChecklists';
import {
  CamposTag,
  pendenciasDaTag,
  rascunhoVazio,
  tagCompleta,
  type RascunhoTag,
} from './CamposTag';
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
  const { usuario } = useSessao();

  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [dados, setDados] = useState<ProgressoDeProjeto | null>(null);
  const [checklists, setChecklists] = useState<EntradaCatalogo[]>([]);
  const [definicoes, setDefinicoes] = useState<Record<string, DefinicaoFormulario>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [bloqueio, setBloqueio] = useState<Bloqueio | null>(null);
  const [tagParaExcluir, setTagParaExcluir] = useState<{ id: number; nome: string } | null>(null);
  const [tagParaRenomear, setTagParaRenomear] = useState<{ id: number; nome: string } | null>(null);
  const [novoNome, setNovoNome] = useState('');
  const [adicionando, setAdicionando] = useState(false);
  const [novaTag, setNovaTag] = useState<RascunhoTag>(rascunhoVazio);
  // Fabricante e cliente final já informados no projeto: a TAG nova herda.
  const [herdadosDoProjeto, setHerdadosDoProjeto] = useState<ValoresCabecalho>({});
  const [tentouNovaTag, setTentouNovaTag] = useState(false);
  const [gravandoTag, setGravandoTag] = useState(false);
  const [tagChecklists, setTagChecklists] = useState<{
    id: number;
    nome: string;
    formIds: string[];
  } | null>(null);
  const [pdfAberto, setPdfAberto] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [empresaEditada, setEmpresaEditada] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    if (!Number.isFinite(id) || !usuario) return;
    try {
      const p = await ProjetoRepository.obterDoUsuario(id, usuario.id);
      if (!p) {
        setErro('Projeto não encontrado neste aparelho.');
        return;
      }
      // O painel do projeto decide quais formulários existem aqui — e se o
      // acesso a ele ainda vale. Projeto anterior aos painéis não tem a quem
      // perguntar.
      const [d, b, c] = await Promise.all([
        progressoDoProjeto(id, p.painelSlug),
        p.painelId === undefined ? null : conferirAcessoPainel(usuario.id, p.painelId),
        formulariosDoPainel(p.painelSlug),
      ]);
      setBloqueio(b);
      setProjeto(p);
      setDados(d);
      const mapa: Record<string, DefinicaoFormulario> = {};
      for (const entrada of c) mapa[entrada.id] = await carregarFormulario(entrada.id);
      setChecklists(c);
      setDefinicoes(mapa);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o projeto.');
    }
  }, [id, usuario]);

  // Uma passada de sincronização pode ter trazido TAGs e respostas de outro aparelho.
  const { ultimaEm: sincronizadoEm } = useEstadoSincronizacao();
  useEffect(() => {
    void recarregar();
  }, [recarregar, sincronizadoEm]);

  if (erro) return <Erro detalhe={erro} />;
  if (!projeto || !dados) return <Carregando mensagem="Carregando o projeto…" />;
  if (bloqueio) return <AcessoBloqueado bloqueio={bloqueio} />;

  // Projetos abertos antes desta versão receberam o e-mail do responsável
  // como empresa — valor provisório, que não vale como nome de empresa.
  const empresaInformada =
    projeto.empresa.trim() !== '' && projeto.empresa !== '—' && !projeto.empresa.includes('@');

  const gravarEmpresa = async () => {
    if (empresaEditada === null) return;
    await ProjetoRepository.atualizar(id, { empresa: empresaEditada.trim() });
    setEmpresaEditada(null);
    await recarregar();
  };

  const abrirNovaTag = async () => {
    setNovaTag(rascunhoVazio());
    setTentouNovaTag(false);
    setHerdadosDoProjeto(await valoresDoProjeto(id));
    setAdicionando(true);
  };

  // Campo do projeto sem valor em nenhuma TAG ainda é perguntado aqui.
  const ocultarNaNovaTag = Object.keys(herdadosDoProjeto);
  const novaTagCompleta = () =>
    tagCompleta(pendenciasDaTag(novaTag, checklists, definicoes, ocultarNaNovaTag));

  const adicionarTag = async () => {
    setTentouNovaTag(true);
    if (gravandoTag || !novaTagCompleta()) return;
    setGravandoTag(true);
    try {
      // Painel sem checklist cadastrado: não há o que escolher, e a TAG segue
      // com os que vierem a existir.
      const formIds = checklists.length
        ? checklists.filter((c) => novaTag.formIds.includes(c.id)).map((c) => c.id)
        : undefined;
      await ProjetoRepository.adicionarTag(
        id,
        await prepararTag(novaTag.nome, formIds, { ...novaTag.dados, ...herdadosDoProjeto }),
      );
      setAdicionando(false);
      await recarregar();
    } finally {
      setGravandoTag(false);
    }
  };

  const voltar = projeto.painelId === undefined ? '/projetos' : `/paineis/${projeto.painelId}/projetos`;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <Botao variante="texto" onClick={() => navegar(voltar)} aria-label="Voltar aos projetos">
          <IconeVoltar />
        </Botao>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setEmpresaEditada(empresaInformada ? projeto.empresa : '')}
            className="inline-flex max-w-full items-center gap-2 rounded text-left text-sm font-semibold tracking-wide text-abb-gray uppercase hover:text-abb-black"
          >
            <span className="truncate">{empresaInformada ? projeto.empresa : 'Empresa não informada'}</span>
            <span className="text-xs font-semibold tracking-normal text-abb-red normal-case">
              editar
            </span>
          </button>
          <h1 className="text-2xl font-bold break-words">{projeto.nomeProjeto}</h1>
          <p className="text-base text-abb-gray">Operador: {projeto.operador || '—'}</p>
          <SituacaoSincronizacao projeto={projeto} />
        </div>
      </div>

      {empresaInformada ? null : (
        <Aviso>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>Informe a empresa: ela aparece na capa e no nome do arquivo do PDF.</span>
            <Botao tamanho="compacto" onClick={() => setEmpresaEditada('')}>
              Informar empresa
            </Botao>
          </span>
        </Aviso>
      )}

      <Modal
        aberto={empresaEditada !== null}
        titulo="Empresa do projeto"
        onFechar={() => setEmpresaEditada(null)}
        rodape={
          <>
            <Botao onClick={() => setEmpresaEditada(null)}>Cancelar</Botao>
            <Botao
              variante="primario"
              disabled={!empresaEditada?.trim()}
              onClick={() => void gravarEmpresa()}
            >
              Gravar
            </Botao>
          </>
        }
      >
        <CampoTexto
          rotulo="Nome da empresa"
          valor={empresaEditada ?? ''}
          onChange={setEmpresaEditada}
          placeholder="Ex.: Montadora Parceira Ltda."
          ajuda="Aparece na capa e no nome do arquivo do PDF."
          autoFoco
        />
      </Modal>

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
          <Botao onClick={() => void abrirNovaTag()}>
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
          <p>
            Cadastre a TAG do painel e escolha quais checklists vai preencher.
            As checagens aparecem depois disso.
          </p>
          <div className="mt-4 flex justify-center">
            <Botao variante="primario" onClick={() => void abrirNovaTag()}>
              <IconeMais className="h-5 w-5" />
              Adicionar TAG
            </Botao>
          </div>
        </Vazio>
      ) : (
        <ul className="space-y-4">
          {dados.tags.map((tag) => (
            <li key={tag.tagId} className="rounded-lg border border-abb-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-bold break-words">{tag.nome}</h2>
                <div className="flex gap-2">
                  {checklists.length ? (
                    <Botao
                      onClick={() =>
                        setTagChecklists({
                          id: tag.tagId,
                          nome: tag.nome,
                          formIds: tag.formIds ?? checklists.map((c) => c.id),
                        })
                      }
                    >
                      Checklists
                    </Botao>
                  ) : null}
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

              {tag.formularios.length === 0 && checklists.length > 0 ? (
                <div className="mt-3">
                  <Aviso>
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span>Nenhum checklist escolhido para esta TAG.</span>
                      <Botao
                        tamanho="compacto"
                        onClick={() =>
                          setTagChecklists({ id: tag.tagId, nome: tag.nome, formIds: [] })
                        }
                      >
                        Escolher checklists
                      </Botao>
                    </span>
                  </Aviso>
                </div>
              ) : null}

              {checklists.length === 0 ? (
                <div className="mt-3">
                  <Aviso>
                    Nenhum checklist cadastrado para a linha{' '}
                    <strong>{projeto.nomeProjeto}</strong>. Assim que o JSON
                    dela entrar em <code>public/forms</code> e for citado no
                    catálogo, os formulários aparecem aqui — sem alteração de
                    código e sem perder o que já estiver preenchido.
                  </Aviso>
                </div>
              ) : null}

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
            <Botao variante="primario" disabled={gravandoTag} onClick={() => void adicionarTag()}>
              {gravandoTag ? 'Adicionando…' : 'Adicionar'}
            </Botao>
          </>
        }
      >
        <div className="space-y-4">
          <CamposTag
            rascunho={novaTag}
            onChange={setNovaTag}
            checklists={checklists}
            definicoes={definicoes}
            mostrarPendencias={tentouNovaTag}
            prefixoId="nova-tag"
            autoFoco
            ocultar={ocultarNaNovaTag}
          />
          {tentouNovaTag && !novaTagCompleta() ? (
            <Erro titulo="Preencha os campos destacados" />
          ) : null}
        </div>
      </Modal>

      <Modal
        aberto={tagChecklists !== null}
        titulo={tagChecklists ? `Checklists da TAG ${tagChecklists.nome}` : 'Checklists'}
        onFechar={() => setTagChecklists(null)}
        rodape={
          <>
            <Botao onClick={() => setTagChecklists(null)}>Cancelar</Botao>
            <Botao
              variante="primario"
              disabled={!tagChecklists?.formIds.length}
              onClick={async () => {
                if (tagChecklists?.formIds.length) {
                  await trocarChecklistsDaTag(
                    tagChecklists.id,
                    checklists.filter((c) => tagChecklists.formIds.includes(c.id)).map((c) => c.id),
                  );
                }
                setTagChecklists(null);
                await recarregar();
              }}
            >
              Salvar
            </Botao>
          </>
        }
      >
        {tagChecklists ? (
          <div className="space-y-3">
            <EscolhaChecklists
              checklists={checklists}
              selecionados={tagChecklists.formIds}
              onChange={(formIds) => setTagChecklists({ ...tagChecklists, formIds })}
            />
            <p className="text-sm text-abb-gray">
              Desmarcar não apaga o que já foi respondido: volta ao marcar de novo.
            </p>
          </div>
        ) : null}
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
            ? `A TAG “${tagParaExcluir.nome}” será removida, junto com as respostas e fotos dos checklists dela.\n\nEsta ação não pode ser desfeita.`
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
        painelSlug={projeto.painelSlug}
        onFechar={() => setPdfAberto(false)}
      />
    </div>
  );
}
