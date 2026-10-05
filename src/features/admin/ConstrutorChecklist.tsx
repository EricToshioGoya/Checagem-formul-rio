import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DESCRICOES_TIPO_RESPOSTA,
  ROTULOS_TIPO_RESPOSTA,
  novaEtapa,
  novaSecao,
  tiposResposta,
  validarDefinicao,
  type DefinicaoFormulario,
  type Etapa,
  type MidiaApoio,
  type Secao,
  type TipoResposta,
} from '../../../compartilhado/formulario';
import { api } from '../../core/api/cliente';
import { ehApoioDoServidor, enviarImagemApoio } from '../../core/media/apoio';
import { ehImagem } from '../../core/media/imagem';
import { ImagemApoio } from '../../shared/componentes/ImagemApoio';
import { plural } from '../../../compartilhado/plural';
import { useSalvamentoAutomatico } from '../../shared/hooks/useSalvamentoAutomatico';
import { baixarBlob } from '../../shared/utils/download';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Aviso, Carregando, Erro, Vazio } from '../../shared/componentes/Estado';
import { IconeVoltar } from '../../shared/componentes/Icones';

interface Props {
  formId: string;
  painelNome: string;
  /**
   * Se o checklist está ativo. Vem de fora porque a gravação reenvia o valor:
   * sem ele, abrir um checklist desativado e mexer em qualquer campo o
   * reativaria em silêncio.
   */
  ativoInicial: boolean;
  onVoltar: () => void;
  /** Avisa a lista de painéis que as contagens mudaram. */
  onAlterado: () => void;
}

/** O que a gravação automática leva ao servidor. */
interface Pendente {
  definicao: DefinicaoFormulario;
  ativo: boolean;
}

const campoSelect =
  'min-h-12 w-full rounded-md border border-abb-line bg-white px-3 text-base text-abb-black focus:border-abb-red';

/**
 * Construtor do checklist de um painel.
 *
 * É aqui que o checklist ganha forma: as seções (S1, S2…), as verificações de
 * cada uma (S1.1, S1.2…) e, para cada verificação, o que o montador terá de
 * fazer — só conferir, conferir e fotografar, medir um valor, escolher entre
 * opções. O que se grava vai para o servidor e vale para todos os montadores
 * aprovados naquele painel.
 *
 * Remover uma verificação não renumera as vizinhas: apagar a S1.5 deixa a S1.6
 * onde está, e a próxima criada é a S1.8 se a maior for a S1.7. Os ids saem
 * impressos no relatório e são citados em conversa — renumerar em silêncio
 * faria o papel de ontem falar de outra etapa.
 */
export function ConstrutorChecklist({
  formId,
  painelNome,
  ativoInicial,
  onVoltar,
  onAlterado,
}: Props) {
  const [definicao, setDefinicao] = useState<DefinicaoFormulario | null>(null);
  const [ativo, setAtivo] = useState(ativoInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [secaoParaExcluir, setSecaoParaExcluir] = useState<Secao | null>(null);
  const entradaArquivo = useRef<HTMLInputElement>(null);
  const entradaImagem = useRef<HTMLInputElement>(null);
  /** Etapa que recebe a imagem escolhida no seletor de arquivo. */
  const alvoImagem = useRef<{ secaoId: string; etapaId: string } | null>(null);
  const [enviandoImagem, setEnviandoImagem] = useState<string | null>(null);
  /**
   * A definição mais recente, para o que termina depois de uma espera (o envio
   * da imagem): o estado capturado no início já pode estar velho.
   */
  const atual = useRef<DefinicaoFormulario | null>(null);

  const gravar = useCallback(
    async ({ definicao: nova, ativo: ligado }: Pendente) => {
      await api.put(`/api/admin/formularios/${formId}`, {
        nome: nova.nome,
        ativo: ligado,
        definicao: nova,
      });
      onAlterado();
    },
    [formId, onAlterado],
  );

  const { estado, agendar, descarregar } = useSalvamentoAutomatico(gravar);

  useEffect(() => {
    let vivo = true;
    api
      .get<{ definicao: DefinicaoFormulario }>(`/api/admin/formularios/${formId}`)
      .then(({ definicao: d }) => {
        if (!vivo) return;
        atual.current = d;
        setDefinicao(d);
      })
      .catch((e: unknown) =>
        setErro(e instanceof Error ? e.message : 'Falha ao abrir o checklist.'),
      );
    return () => {
      vivo = false;
    };
  }, [formId]);

  // Sair da tela sem perder o que estava na fila dos 500 ms.
  useEffect(() => () => void descarregar(), [descarregar]);

  /** Aplica a mudança na tela na hora e agenda a gravação. */
  const alterar = (nova: DefinicaoFormulario) => {
    setErro(null);
    atual.current = nova;
    setDefinicao(nova);
    agendar({ definicao: nova, ativo });
  };

  const alterarAtivo = (ligado: boolean) => {
    setAtivo(ligado);
    if (definicao) agendar({ definicao, ativo: ligado });
  };

  const alterarSecoes = (fn: (secoes: Secao[]) => Secao[]) => {
    if (!definicao) return;
    alterar({ ...definicao, secoes: fn(definicao.secoes) });
  };

  const alterarSecao = (secaoId: string, mudanca: Partial<Secao>) =>
    alterarSecoes((secoes) =>
      secoes.map((s) => (s.id === secaoId ? { ...s, ...mudanca } : s)),
    );

  const alterarEtapa = (secaoId: string, etapaId: string, mudanca: Partial<Etapa>) =>
    alterarSecoes((secoes) =>
      secoes.map((s) =>
        s.id !== secaoId
          ? s
          : { ...s, etapas: s.etapas.map((e) => (e.id === etapaId ? { ...e, ...mudanca } : e)) },
      ),
    );

  const mover = <T,>(lista: T[], indice: number, direcao: -1 | 1): T[] => {
    const destino = indice + direcao;
    if (destino < 0 || destino >= lista.length) return lista;
    const copia = [...lista];
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    return copia;
  };

  const alterarMidia = (
    secaoId: string,
    etapa: Etapa,
    indice: number,
    mudanca: Partial<MidiaApoio> | null,
  ) => {
    const midias = [...(etapa.midiaApoio ?? [])];
    if (mudanca === null) midias.splice(indice, 1);
    else if (indice >= midias.length) midias.push({ tipo: 'imagem', src: '', ...mudanca });
    else midias[indice] = { ...midias[indice], ...mudanca };
    alterarEtapa(secaoId, etapa.id, { midiaApoio: midias });
  };

  const enviarImagem = async (arquivo: File) => {
    const alvo = alvoImagem.current;
    alvoImagem.current = null;
    if (!alvo) return;
    if (!ehImagem(arquivo)) {
      setErro('Escolha um arquivo de imagem (JPEG, PNG…).');
      return;
    }
    setEnviandoImagem(`${alvo.secaoId}/${alvo.etapaId}`);
    try {
      const src = await enviarImagemApoio(arquivo);
      const d = atual.current;
      if (!d) return;
      alterar({
        ...d,
        secoes: d.secoes.map((s) =>
          s.id !== alvo.secaoId
            ? s
            : {
                ...s,
                etapas: s.etapas.map((e) =>
                  e.id !== alvo.etapaId
                    ? e
                    : { ...e, midiaApoio: [...(e.midiaApoio ?? []), { tipo: 'imagem' as const, src }] },
                ),
              },
        ),
      });
    } catch (e) {
      setErro(e instanceof Error ? `Não foi possível enviar a imagem: ${e.message}` : 'Falha ao enviar a imagem.');
    } finally {
      setEnviandoImagem(null);
    }
  };

  const importar = async (arquivo: File) => {
    try {
      const nova = validarDefinicao(JSON.parse(await arquivo.text()));
      // O id do registro manda: importar um checklist de outro painel copia o
      // conteúdo para cá, e não sequestra o registro de lá.
      alterar({ ...nova, id: formId });
    } catch (e) {
      setErro(
        e instanceof Error ? `Não foi possível importar:\n${e.message}` : 'Arquivo inválido.',
      );
    }
  };

  if (erro && !definicao) return <Erro detalhe={erro} />;
  if (!definicao) return <Carregando mensagem="Abrindo o checklist…" />;

  const totalEtapas = definicao.secoes.reduce((n, s) => n + s.etapas.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Botao variante="texto" onClick={onVoltar} aria-label="Voltar">
          <IconeVoltar />
        </Botao>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-abb-gray">{painelNome}</p>
          <h1 className="truncate text-xl font-bold">{definicao.nome}</h1>
        </div>
        <span className="text-sm text-abb-gray">
          {estado === 'salvando' || estado === 'pendente'
            ? 'Gravando…'
            : estado === 'salvo'
              ? 'Gravado'
              : estado === 'erro'
                ? 'Falha ao gravar'
                : ''}
        </span>
      </div>

      <div className="rounded-lg border border-abb-line bg-white p-4 space-y-3">
        <CampoTexto
          rotulo="Nome do checklist"
          valor={definicao.nome}
          onChange={(v) => alterar({ ...definicao, nome: v })}
        />
        <p className="text-sm text-abb-gray">
          {plural(definicao.secoes.length, 'seção', 'seções')} · {plural(totalEtapas, 'verificação', 'verificações')}
        </p>

        <label className="flex items-center gap-2 text-base">
          <input
            type="checkbox"
            className="size-5 accent-abb-red"
            checked={ativo}
            onChange={(e) => alterarAtivo(e.target.checked)}
          />
          <span>
            Disponível para os montadores
            <span className="block text-sm text-abb-gray">
              Desmarcado, o checklist some do aparelho dos montadores sem ser
              apagado daqui.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Botao
            onClick={() =>
              baixarBlob(
                new Blob([JSON.stringify(definicao, null, 2)], { type: 'application/json' }),
                `${definicao.id}.json`,
              )
            }
          >
            Exportar JSON
          </Botao>
          <Botao onClick={() => entradaArquivo.current?.click()}>Importar JSON</Botao>
        </div>
      </div>

      <input
        ref={entradaArquivo}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = '';
          if (arquivo) void importar(arquivo);
        }}
      />

      <input
        ref={entradaImagem}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Imagem de apoio"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = '';
          if (arquivo) void enviarImagem(arquivo);
        }}
      />

      {erro ? <Erro titulo="Erro" detalhe={erro} /> : null}

      {definicao.secoes.length === 0 ? (
        <Vazio titulo="Checklist ainda vazio">
          Comece criando a primeira seção — por exemplo “Estrutura” ou
          “Barramentos”. Dentro dela ficam as verificações que o montador vai
          conferir no painel.
        </Vazio>
      ) : null}

      {definicao.secoes.map((secao, indiceSecao) => {
        const aberta = abertas.has(secao.id);
        return (
          <section key={secao.id} className="rounded-lg border border-abb-line bg-white">
            <div className="flex min-h-14 items-center gap-2 px-3">
              <button
                type="button"
                onClick={() =>
                  setAbertas((s) => {
                    const novo = new Set(s);
                    if (novo.has(secao.id)) novo.delete(secao.id);
                    else novo.add(secao.id);
                    return novo;
                  })
                }
                aria-expanded={aberta}
                className="flex flex-1 items-center gap-2 py-2 text-left"
              >
                <span className="rounded bg-abb-black px-2 py-1 text-sm font-bold text-white">
                  {secao.id}
                </span>
                <span className="text-base font-bold">{secao.titulo}</span>
                <span className="text-sm text-abb-gray">
                  {plural(secao.etapas.length, 'verificação', 'verificações')}
                </span>
              </button>
              <div className="flex shrink-0 gap-1">
                <Botao
                  onClick={() => alterarSecoes((s) => mover(s, indiceSecao, -1))}
                  disabled={indiceSecao === 0}
                  aria-label={`Mover seção ${secao.id} para cima`}
                >
                  ↑
                </Botao>
                <Botao
                  onClick={() => alterarSecoes((s) => mover(s, indiceSecao, 1))}
                  disabled={indiceSecao === definicao.secoes.length - 1}
                  aria-label={`Mover seção ${secao.id} para baixo`}
                >
                  ↓
                </Botao>
                <Botao variante="perigo" onClick={() => setSecaoParaExcluir(secao)}>
                  Excluir
                </Botao>
              </div>
            </div>

            {aberta ? (
              <div className="space-y-4 border-t border-abb-line p-4">
                <CampoTexto
                  rotulo="Título da seção"
                  valor={secao.titulo}
                  onChange={(v) => alterarSecao(secao.id, { titulo: v })}
                />

                {secao.etapas.map((etapa, indiceEtapa) => (
                  <article
                    key={etapa.id}
                    className={[
                      'space-y-3 rounded-md border p-3',
                      etapa.ativa === false
                        ? 'border-abb-line bg-neutral-100'
                        : 'border-abb-line',
                    ].join(' ')}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded bg-abb-black px-2 py-1 text-sm font-bold text-white">
                        {etapa.id}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        <Botao
                          onClick={() =>
                            alterarSecao(secao.id, {
                              etapas: mover(secao.etapas, indiceEtapa, -1),
                            })
                          }
                          disabled={indiceEtapa === 0}
                          aria-label={`Mover ${etapa.id} para cima`}
                        >
                          ↑
                        </Botao>
                        <Botao
                          onClick={() =>
                            alterarSecao(secao.id, {
                              etapas: mover(secao.etapas, indiceEtapa, 1),
                            })
                          }
                          disabled={indiceEtapa === secao.etapas.length - 1}
                          aria-label={`Mover ${etapa.id} para baixo`}
                        >
                          ↓
                        </Botao>
                        <Botao
                          onClick={() =>
                            alterarEtapa(secao.id, etapa.id, { ativa: etapa.ativa === false })
                          }
                        >
                          {etapa.ativa === false ? 'Ativar' : 'Desativar'}
                        </Botao>
                        <Botao
                          variante="perigo"
                          onClick={() =>
                            alterarSecao(secao.id, {
                              etapas: secao.etapas.filter((e) => e.id !== etapa.id),
                            })
                          }
                          aria-label={`Excluir ${etapa.id}`}
                        >
                          Excluir
                        </Botao>
                      </div>
                    </div>

                    <CampoTexto
                      rotulo="O que verificar"
                      multilinha
                      valor={etapa.descricao}
                      onChange={(v) => alterarEtapa(secao.id, etapa.id, { descricao: v })}
                    />

                    <div>
                      <label
                        htmlFor={`tipo-${etapa.id}`}
                        className="mb-1 block text-base font-semibold"
                      >
                        Resposta exigida do montador
                      </label>
                      <select
                        id={`tipo-${etapa.id}`}
                        aria-describedby={`tipo-ajuda-${etapa.id}`}
                        className={campoSelect}
                        value={etapa.tipoResposta}
                        onChange={(e) =>
                          alterarEtapa(secao.id, etapa.id, {
                            tipoResposta: e.target.value as TipoResposta,
                          })
                        }
                      >
                        {tiposResposta.map((t) => (
                          <option key={t} value={t}>
                            {ROTULOS_TIPO_RESPOSTA[t]}
                          </option>
                        ))}
                      </select>
                      <p id={`tipo-ajuda-${etapa.id}`} className="mt-1 text-sm text-abb-gray">
                        {DESCRICOES_TIPO_RESPOSTA[etapa.tipoResposta]}
                      </p>
                    </div>

                    {etapa.tipoResposta === 'selecao' ? (
                      <CampoTexto
                        rotulo="Opções (uma por linha)"
                        multilinha
                        valor={(etapa.opcoes ?? []).join('\n')}
                        onChange={(v) =>
                          alterarEtapa(secao.id, etapa.id, {
                            opcoes: v.split('\n').map((l) => l.trim()).filter(Boolean),
                          })
                        }
                      />
                    ) : null}

                    {etapa.tipoResposta === 'numero' ? (
                      <CampoTexto
                        rotulo="Unidade"
                        valor={etapa.unidade ?? ''}
                        placeholder="mm, V, N·m…"
                        onChange={(v) =>
                          alterarEtapa(secao.id, etapa.id, { unidade: v || undefined })
                        }
                      />
                    ) : null}

                    {etapa.tipoResposta === 'grade_numerica' && !etapa.grade ? (
                      <Aviso>
                        Grade de medições precisa das linhas e colunas, que hoje só
                        se definem importando o JSON.
                      </Aviso>
                    ) : null}

                    <CampoTexto
                      rotulo="Detalhes (um por linha)"
                      multilinha
                      valor={(etapa.detalhes ?? []).join('\n')}
                      onChange={(v) =>
                        alterarEtapa(secao.id, etapa.id, {
                          detalhes: v.split('\n').map((l) => l.trim()).filter(Boolean),
                        })
                      }
                    />

                    <div className="space-y-2">
                      <p className="text-base font-semibold">
                        Imagem de apoio{' '}
                        <span className="font-normal text-abb-gray">(opcional)</span>
                      </p>
                      <p className="text-sm text-abb-gray">
                        Aparece na etapa para o montador comparar com o painel.
                      </p>
                      {(etapa.midiaApoio ?? []).map((midia, i) =>
                        ehApoioDoServidor(midia.src) ? (
                          <div
                            key={midia.src}
                            className="grid items-start gap-2 rounded border border-abb-line p-2 sm:grid-cols-[10rem_1fr_auto]"
                          >
                            <ImagemApoio
                              src={midia.src}
                              alt={midia.legenda || `Imagem de apoio da ${etapa.id}`}
                              className="h-28 w-full rounded border border-abb-line object-contain"
                            />
                            <CampoTexto
                              valor={midia.legenda ?? ''}
                              placeholder="Legenda (opcional)"
                              onChange={(v) =>
                                alterarMidia(secao.id, etapa, i, { legenda: v || undefined })
                              }
                            />
                            <Botao
                              variante="perigo"
                              onClick={() => alterarMidia(secao.id, etapa, i, null)}
                            >
                              Remover
                            </Botao>
                          </div>
                        ) : (
                          <div
                            key={i}
                            className="grid gap-2 rounded border border-abb-line p-2 sm:grid-cols-[9rem_1fr_auto]"
                          >
                            <select
                              className={campoSelect}
                              aria-label="Tipo de mídia"
                              value={midia.tipo}
                              onChange={(e) =>
                                alterarMidia(secao.id, etapa, i, {
                                  tipo: e.target.value as MidiaApoio['tipo'],
                                })
                              }
                            >
                              <option value="imagem">imagem</option>
                              <option value="video">vídeo</option>
                              <option value="pdf">pdf</option>
                            </select>
                            <CampoTexto
                              valor={midia.src}
                              placeholder="/media/sen-plus/arquivo.png"
                              onChange={(v) => alterarMidia(secao.id, etapa, i, { src: v })}
                            />
                            <Botao
                              variante="perigo"
                              onClick={() => alterarMidia(secao.id, etapa, i, null)}
                            >
                              Remover
                            </Botao>
                            <CampoTexto
                              valor={midia.legenda ?? ''}
                              placeholder="Legenda"
                              onChange={(v) => alterarMidia(secao.id, etapa, i, { legenda: v })}
                            />
                          </div>
                        ),
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Botao
                          disabled={enviandoImagem !== null}
                          onClick={() => {
                            alvoImagem.current = { secaoId: secao.id, etapaId: etapa.id };
                            entradaImagem.current?.click();
                          }}
                        >
                          {enviandoImagem === `${secao.id}/${etapa.id}`
                            ? 'Enviando imagem…'
                            : 'Adicionar imagem'}
                        </Botao>
                        <Botao
                          variante="texto"
                          onClick={() =>
                            alterarMidia(secao.id, etapa, (etapa.midiaApoio ?? []).length, {
                              tipo: 'video',
                              src: '',
                            })
                          }
                        >
                          Vídeo ou PDF por endereço
                        </Botao>
                      </div>
                    </div>
                  </article>
                ))}

                <Botao
                  variante="primario"
                  onClick={() =>
                    alterarSecao(secao.id, { etapas: [...secao.etapas, novaEtapa(secao)] })
                  }
                >
                  Adicionar verificação
                </Botao>
              </div>
            ) : null}
          </section>
        );
      })}

      <Botao
        variante="primario"
        larguraTotal
        onClick={() => {
          const nova = novaSecao(definicao.secoes);
          alterarSecoes((s) => [...s, nova]);
          setAbertas((s) => new Set(s).add(nova.id));
        }}
      >
        Adicionar seção
      </Botao>

      <Confirmacao
        aberto={secaoParaExcluir !== null}
        titulo="Excluir seção"
        mensagem={
          secaoParaExcluir
            ? `Excluir a seção ${secaoParaExcluir.id} — ${secaoParaExcluir.titulo} apaga também ${plural(secaoParaExcluir.etapas.length, 'a verificação', 'as verificações')} dentro dela.\n\nO que os montadores já preencheram nos aparelhos não é apagado.`
            : ''
        }
        textoConfirmar="Excluir"
        onCancelar={() => setSecaoParaExcluir(null)}
        onConfirmar={() => {
          if (secaoParaExcluir) {
            alterarSecoes((s) => s.filter((x) => x.id !== secaoParaExcluir.id));
          }
          setSecaoParaExcluir(null);
        }}
      />
    </div>
  );
}
