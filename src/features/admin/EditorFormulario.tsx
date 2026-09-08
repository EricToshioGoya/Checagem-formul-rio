import { useCallback, useEffect, useRef, useState } from 'react';
import {
  carregarFormulario,
  carregarFormularioOriginal,
  limparCacheFormulario,
  validarDefinicao,
} from '../../core/forms/catalogo';
import { FormularioRepository } from '../../core/db/repositorios';
import { tiposResposta } from '../../core/forms/schema';
import type {
  DefinicaoFormulario,
  Etapa,
  MidiaApoio,
  Secao,
  TipoResposta,
} from '../../core/forms/tipos';
import { baixarBlob } from '../../shared/utils/download';
import { Botao } from '../../shared/componentes/Botao';
import { CampoSelecao, CampoTexto } from '../../shared/componentes/Campos';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeVoltar } from '../../shared/componentes/Icones';

interface Props {
  formId: string;
  onVoltar: () => void;
}

type Estado = 'ocioso' | 'salvando' | 'salvo';

/** Remoção pendente de confirmação. */
type Remocao =
  | { tipo: 'secao'; secaoId: string }
  | { tipo: 'etapa'; secaoId: string; etapaId: string };

/**
 * Id novo que não colide com nenhum existente. A resposta gravada é indexada
 * pelo id da etapa: reaproveitar um id colaria a resposta antiga na pergunta
 * nova.
 */
function idLivre(usados: Set<string>, prefixo: string): string {
  for (let n = usados.size + 1; ; n += 1) {
    const candidato = `${prefixo}${n}`;
    if (!usados.has(candidato)) return candidato;
  }
}

/**
 * Troca de tipo de resposta sem deixar a etapa inconsistente: seleção precisa
 * de opções e grade precisa de linhas e colunas para ser renderizada.
 */
function ajustarAoTipo(etapa: Etapa, tipoResposta: TipoResposta): Partial<Etapa> {
  const mudanca: Partial<Etapa> = { tipoResposta };
  if (tipoResposta === 'selecao' && !etapa.opcoes?.length) {
    mudanca.opcoes = ['Sim', 'Não'];
  }
  if (tipoResposta === 'grade_numerica' && !etapa.grade) {
    mudanca.grade = {
      linhas: [{ id: 'linha-1', rotulo: 'Linha 1' }],
      colunas: [{ id: 'coluna-1', rotulo: 'Valor medido' }],
    };
  }
  return mudanca;
}

type Grade = NonNullable<Etapa['grade']>;

function paraId(rotulo: string, indice: number): string {
  const limpo = rotulo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return limpo || `item-${indice + 1}`;
}

const emLinhas = (texto: string) =>
  texto.split('\n').map((l) => l.trim()).filter(Boolean);

const lerLinhasGrade = (texto: string): Grade['linhas'] =>
  emLinhas(texto).map((rotulo, i) => ({ id: paraId(rotulo, i), rotulo }));

/** `Rótulo|unidade` por linha, que é como a grade é editada em texto. */
const lerColunasGrade = (texto: string): Grade['colunas'] =>
  emLinhas(texto).map((linha, i) => {
    const [rotulo, unidade] = linha.split('|').map((parte) => parte.trim());
    return { id: paraId(rotulo, i), rotulo, ...(unidade ? { unidade } : {}) };
  });

const escreverColunasGrade = (colunas: Grade['colunas']) =>
  colunas.map((c) => (c.unidade ? `${c.rotulo}|${c.unidade}` : c.rotulo)).join('\n');

export function EditorFormulario({ formId, onVoltar }: Props) {
  const [definicao, setDefinicao] = useState<DefinicaoFormulario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>('ocioso');
  const [secaoAberta, setSecaoAberta] = useState<string | null>(null);
  const [confirmarRestauro, setConfirmarRestauro] = useState(false);
  const [remocao, setRemocao] = useState<Remocao | null>(null);
  const entradaArquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    carregarFormulario(formId, true)
      .then(setDefinicao)
      .catch((e: unknown) =>
        setErro(e instanceof Error ? e.message : 'Falha ao carregar o formulário.'),
      );
  }, [formId]);

  const gravar = useCallback(
    async (nova: DefinicaoFormulario) => {
      setEstado('salvando');
      try {
        // Revalida antes de gravar: a edição nunca produz um JSON inválido.
        const validada = validarDefinicao(nova);
        await FormularioRepository.salvar(formId, validada);
        limparCacheFormulario(formId);
        setDefinicao(validada);
        setEstado('salvo');
        setErro(null);
      } catch (e) {
        setEstado('ocioso');
        setErro(e instanceof Error ? e.message : 'Falha ao gravar a alteração.');
      }
    },
    [formId],
  );

  const alterarEtapa = (secaoId: string, etapaId: string, mudanca: Partial<Etapa>) => {
    if (!definicao) return;
    void gravar({
      ...definicao,
      secoes: definicao.secoes.map((s) =>
        s.id !== secaoId
          ? s
          : {
              ...s,
              etapas: s.etapas.map((e) => (e.id === etapaId ? { ...e, ...mudanca } : e)),
            },
      ),
    });
  };

  const moverEtapa = (secaoId: string, indice: number, direcao: -1 | 1) => {
    if (!definicao) return;
    void gravar({
      ...definicao,
      secoes: definicao.secoes.map((s) => {
        if (s.id !== secaoId) return s;
        const etapas = [...s.etapas];
        const destino = indice + direcao;
        if (destino < 0 || destino >= etapas.length) return s;
        [etapas[indice], etapas[destino]] = [etapas[destino], etapas[indice]];
        return { ...s, etapas };
      }),
    });
  };

  const alterarMidia = (
    secaoId: string,
    etapaId: string,
    indice: number,
    mudanca: Partial<MidiaApoio> | null,
  ) => {
    if (!definicao) return;
    const secao = definicao.secoes.find((s) => s.id === secaoId);
    const etapa = secao?.etapas.find((e) => e.id === etapaId);
    if (!etapa) return;
    const midias = [...(etapa.midiaApoio ?? [])];
    if (mudanca === null) midias.splice(indice, 1);
    else if (indice >= midias.length) midias.push({ tipo: 'imagem', src: '', ...mudanca });
    else midias[indice] = { ...midias[indice], ...mudanca };
    alterarEtapa(secaoId, etapaId, { midiaApoio: midias });
  };

  const alterarSecao = (secaoId: string, mudanca: Partial<Secao>) => {
    if (!definicao) return;
    void gravar({
      ...definicao,
      secoes: definicao.secoes.map((s) => (s.id === secaoId ? { ...s, ...mudanca } : s)),
    });
  };

  const idsUsados = (d: DefinicaoFormulario) =>
    new Set(d.secoes.flatMap((s) => [s.id, ...s.etapas.map((e) => e.id)]));

  const etapaNova = (secaoId: string, usados: Set<string>): Etapa => ({
    id: idLivre(usados, `${secaoId}.`),
    descricao: 'Nova pergunta',
    tipoResposta: 'check',
    observacao: true,
    ativa: true,
    fotoObrigatoria: false,
    midiaApoio: [],
  });

  const adicionarEtapa = (secaoId: string) => {
    if (!definicao) return;
    const nova = etapaNova(secaoId, idsUsados(definicao));
    void gravar({
      ...definicao,
      secoes: definicao.secoes.map((s) =>
        s.id === secaoId ? { ...s, etapas: [...s.etapas, nova] } : s,
      ),
    });
  };

  const removerEtapa = (secaoId: string, etapaId: string) => {
    if (!definicao) return;
    const secao = definicao.secoes.find((s) => s.id === secaoId);
    if (secao && secao.etapas.length === 1) {
      setErro(
        'Uma seção precisa de pelo menos uma pergunta. Remova a seção inteira, ou ' +
          'acrescente outra pergunta antes de remover esta.',
      );
      return;
    }
    void gravar({
      ...definicao,
      secoes: definicao.secoes.map((s) =>
        s.id !== secaoId ? s : { ...s, etapas: s.etapas.filter((e) => e.id !== etapaId) },
      ),
    });
  };

  const adicionarSecao = () => {
    if (!definicao) return;
    const usados = idsUsados(definicao);
    const id = idLivre(usados, 'S');
    usados.add(id);
    void gravar({
      ...definicao,
      secoes: [
        ...definicao.secoes,
        { id, titulo: 'Nova seção', etapas: [etapaNova(id, usados)] },
      ],
    });
    setSecaoAberta(id);
  };

  const removerSecao = (secaoId: string) => {
    if (!definicao) return;
    if (definicao.secoes.length === 1) {
      setErro('O formulário precisa de pelo menos uma seção.');
      return;
    }
    void gravar({
      ...definicao,
      secoes: definicao.secoes.filter((s) => s.id !== secaoId),
    });
  };

  const importar = async (arquivo: File) => {
    try {
      const texto = await arquivo.text();
      const nova = validarDefinicao(JSON.parse(texto));
      if (nova.id !== formId) {
        throw new Error(
          `O arquivo importado tem id "${nova.id}", diferente de "${formId}".`,
        );
      }
      await gravar(nova);
    } catch (e) {
      setErro(
        e instanceof Error
          ? `Não foi possível importar o arquivo:\n${e.message}`
          : 'Arquivo inválido.',
      );
    }
  };

  if (erro && !definicao) return <Erro detalhe={erro} />;
  if (!definicao) return <Carregando mensagem="Carregando o formulário…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Botao variante="texto" onClick={onVoltar} aria-label="Voltar">
          <IconeVoltar />
        </Botao>
        <h1 className="flex-1 text-xl font-bold">{definicao.nome}</h1>
        <span className="text-sm text-abb-gray">
          {estado === 'salvando' ? 'Gravando…' : estado === 'salvo' ? 'Alterações gravadas' : ''}
        </span>
      </div>

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
        <Botao variante="perigo" onClick={() => setConfirmarRestauro(true)}>
          Restaurar original
        </Botao>
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

      {erro ? <Erro titulo="Erro de validação" detalhe={erro} /> : null}

      <Aviso>
        As alterações valem apenas neste aparelho. Para distribuir, exporte o JSON
        e substitua o arquivo em <code>/public/forms</code> na próxima publicação.
      </Aviso>

      <Aviso>
        Remover uma pergunta, ou trocar o tipo de resposta dela, não apaga o que já foi
        preenchido: a resposta antiga fica órfã nos registros existentes. Em formulário
        já em uso, prefira desativar a pergunta a removê-la.
      </Aviso>

      {definicao.secoes.map((secao) => {
        const aberta = secaoAberta === secao.id;
        return (
          <section key={secao.id} className="rounded-lg border border-abb-line bg-white">
            <button
              type="button"
              onClick={() => setSecaoAberta(aberta ? null : secao.id)}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left"
              aria-expanded={aberta}
            >
              <span className="text-base font-bold">
                {secao.id} — {secao.titulo}
              </span>
              <span className="text-sm text-abb-gray">
                {secao.etapas.length} etapa{secao.etapas.length === 1 ? '' : 's'}
              </span>
            </button>

            {aberta ? (
              <div className="space-y-4 border-t border-abb-line p-4">
                <div className="space-y-3 rounded-md border border-dashed border-abb-line p-3">
                  <CampoTexto
                    rotulo="Título da seção"
                    valor={secao.titulo}
                    onChange={(v) => alterarSecao(secao.id, { titulo: v })}
                  />
                  <CampoTexto
                    rotulo="Descrição da seção"
                    multilinha
                    valor={secao.descricao ?? ''}
                    onChange={(v) =>
                      alterarSecao(secao.id, { descricao: v.trim() || undefined })
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    <Botao variante="primario" onClick={() => adicionarEtapa(secao.id)}>
                      Adicionar pergunta
                    </Botao>
                    <Botao
                      variante="perigo"
                      onClick={() => setRemocao({ tipo: 'secao', secaoId: secao.id })}
                    >
                      Remover seção
                    </Botao>
                  </div>
                </div>

                {secao.etapas.map((etapa, indice) => (
                  <article
                    key={etapa.id}
                    className={[
                      'space-y-3 rounded-md border p-3',
                      etapa.ativa === false ? 'border-abb-line bg-neutral-100' : 'border-abb-line',
                    ].join(' ')}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded bg-abb-black px-2 py-1 text-sm font-bold text-white">
                        {etapa.id}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Botao
                          onClick={() => moverEtapa(secao.id, indice, -1)}
                          disabled={indice === 0}
                          aria-label={`Mover ${etapa.id} para cima`}
                        >
                          ↑
                        </Botao>
                        <Botao
                          onClick={() => moverEtapa(secao.id, indice, 1)}
                          disabled={indice === secao.etapas.length - 1}
                          aria-label={`Mover ${etapa.id} para baixo`}
                        >
                          ↓
                        </Botao>
                        <Botao
                          variante={etapa.ativa === false ? 'primario' : 'perigo'}
                          onClick={() =>
                            alterarEtapa(secao.id, etapa.id, { ativa: etapa.ativa === false })
                          }
                        >
                          {etapa.ativa === false ? 'Ativar' : 'Desativar'}
                        </Botao>
                        <Botao
                          variante="perigo"
                          onClick={() =>
                            setRemocao({ tipo: 'etapa', secaoId: secao.id, etapaId: etapa.id })
                          }
                        >
                          Remover
                        </Botao>
                      </div>
                    </div>

                    <CampoTexto
                      rotulo="Descrição"
                      multilinha
                      valor={etapa.descricao}
                      onChange={(v) => alterarEtapa(secao.id, etapa.id, { descricao: v })}
                    />

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

                    <div className="grid gap-3 sm:grid-cols-2">
                      <CampoSelecao
                        rotulo="Tipo de resposta"
                        valor={etapa.tipoResposta}
                        opcoes={[...tiposResposta]}
                        onChange={(v) =>
                          alterarEtapa(
                            secao.id,
                            etapa.id,
                            ajustarAoTipo(etapa, v as TipoResposta),
                          )
                        }
                      />
                      <CampoTexto
                        rotulo="Referência (norma, documento)"
                        valor={etapa.referencia ?? ''}
                        onChange={(v) =>
                          alterarEtapa(secao.id, etapa.id, {
                            referencia: v.trim() || undefined,
                          })
                        }
                      />
                    </div>

                    {etapa.tipoResposta === 'selecao' ? (
                      <CampoTexto
                        rotulo="Opções (uma por linha)"
                        multilinha
                        valor={(etapa.opcoes ?? []).join('\n')}
                        onChange={(v) =>
                          alterarEtapa(secao.id, etapa.id, {
                            opcoes: v.split('\n').map((o) => o.trim()).filter(Boolean),
                          })
                        }
                      />
                    ) : null}

                    {etapa.tipoResposta === 'numero' ? (
                      <CampoTexto
                        rotulo="Unidade"
                        valor={etapa.unidade ?? ''}
                        placeholder="A, kA, V, N·m"
                        onChange={(v) =>
                          alterarEtapa(secao.id, etapa.id, { unidade: v.trim() || undefined })
                        }
                      />
                    ) : null}

                    {etapa.tipoResposta === 'grade_numerica' && etapa.grade ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <CampoTexto
                          rotulo="Linhas da grade (uma por linha)"
                          multilinha
                          valor={etapa.grade.linhas.map((l) => l.rotulo).join('\n')}
                          onChange={(v) => {
                            const linhas = lerLinhasGrade(v);
                            if (!linhas.length || !etapa.grade) return;
                            alterarEtapa(secao.id, etapa.id, {
                              grade: { ...etapa.grade, linhas },
                            });
                          }}
                        />
                        <CampoTexto
                          rotulo="Colunas da grade"
                          multilinha
                          ajuda="Uma por linha, no formato Rótulo|unidade."
                          valor={escreverColunasGrade(etapa.grade.colunas)}
                          onChange={(v) => {
                            const colunas = lerColunasGrade(v);
                            if (!colunas.length || !etapa.grade) return;
                            alterarEtapa(secao.id, etapa.id, {
                              grade: { ...etapa.grade, colunas },
                            });
                          }}
                        />
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-4">
                      <label className="flex min-h-12 items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-6 w-6"
                          checked={etapa.observacao !== false}
                          onChange={(e) =>
                            alterarEtapa(secao.id, etapa.id, { observacao: e.target.checked })
                          }
                        />
                        <span className="text-base">Aceita observação</span>
                      </label>
                      <label className="flex min-h-12 items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-6 w-6"
                          checked={etapa.fotoObrigatoria === true}
                          onChange={(e) =>
                            alterarEtapa(secao.id, etapa.id, {
                              fotoObrigatoria: e.target.checked,
                            })
                          }
                        />
                        <span className="text-base">Exige anexo para contar como respondida</span>
                      </label>
                    </div>

                    <div className="space-y-2">
                      <p className="text-base font-semibold">Conteúdo de apoio</p>
                      {(etapa.midiaApoio ?? []).map((midia, i) => (
                        <div
                          key={i}
                          className="grid gap-2 rounded border border-abb-line p-2 sm:grid-cols-[9rem_1fr_auto]"
                        >
                          <CampoSelecao
                            valor={midia.tipo}
                            opcoes={['imagem', 'video', 'pdf']}
                            onChange={(v) =>
                              alterarMidia(secao.id, etapa.id, i, {
                                tipo: v as MidiaApoio['tipo'],
                              })
                            }
                          />
                          <CampoTexto
                            valor={midia.src}
                            placeholder="/media/sen-plus/arquivo.png"
                            onChange={(v) => alterarMidia(secao.id, etapa.id, i, { src: v })}
                          />
                          <Botao
                            variante="perigo"
                            onClick={() => alterarMidia(secao.id, etapa.id, i, null)}
                          >
                            Remover
                          </Botao>
                          <CampoTexto
                            valor={midia.legenda ?? ''}
                            placeholder="Legenda"
                            onChange={(v) => alterarMidia(secao.id, etapa.id, i, { legenda: v })}
                          />
                        </div>
                      ))}
                      <Botao
                        onClick={() =>
                          alterarMidia(secao.id, etapa.id, (etapa.midiaApoio ?? []).length, {
                            tipo: 'imagem',
                            src: '',
                          })
                        }
                      >
                        Adicionar mídia
                      </Botao>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}

      <Botao variante="primario" larguraTotal onClick={adicionarSecao}>
        Adicionar seção
      </Botao>

      <Confirmacao
        aberto={remocao !== null}
        titulo={remocao?.tipo === 'secao' ? 'Remover seção' : 'Remover pergunta'}
        mensagem={
          remocao?.tipo === 'secao'
            ? 'A seção e todas as perguntas dela saem do formulário.\n\nRespostas já gravadas para essas perguntas ficam órfãs nos registros existentes.'
            : 'A pergunta sai do formulário.\n\nRespostas já gravadas para ela ficam órfãs nos registros existentes.'
        }
        textoConfirmar="Remover"
        onCancelar={() => setRemocao(null)}
        onConfirmar={() => {
          if (remocao?.tipo === 'secao') removerSecao(remocao.secaoId);
          if (remocao?.tipo === 'etapa') removerEtapa(remocao.secaoId, remocao.etapaId);
          setRemocao(null);
        }}
      />

      <Confirmacao
        aberto={confirmarRestauro}
        titulo="Restaurar formulário original"
        mensagem="Todas as edições feitas nesta aba serão descartadas e o formulário voltará ao arquivo publicado.\n\nEsta ação não pode ser desfeita."
        textoConfirmar="Restaurar"
        onCancelar={() => setConfirmarRestauro(false)}
        onConfirmar={async () => {
          await FormularioRepository.restaurarOriginal(formId);
          limparCacheFormulario(formId);
          setDefinicao(await carregarFormularioOriginal(formId));
          setConfirmarRestauro(false);
          setEstado('salvo');
        }}
      />
    </div>
  );
}
