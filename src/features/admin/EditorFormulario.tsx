import { useCallback, useEffect, useRef, useState } from 'react';
import {
  carregarFormulario,
  carregarFormularioOriginal,
  limparCacheFormulario,
  validarDefinicao,
} from '../../core/forms/catalogo';
import { FormularioRepository } from '../../core/db/repositorios';
import type { DefinicaoFormulario, Etapa, MidiaApoio } from '../../core/forms/tipos';
import { baixarBlob } from '../../shared/utils/download';
import { Botao } from '../../shared/componentes/Botao';
import { CampoSelecao } from '../../shared/componentes/Campos';
import { CampoTextoAdiado } from '../../shared/componentes/CampoTextoAdiado';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Aviso, Carregando, Erro } from '../../shared/componentes/Estado';
import { IconeVoltar } from '../../shared/componentes/Icones';

interface Props {
  formId: string;
  onVoltar: () => void;
}

type Estado = 'ocioso' | 'salvando' | 'salvo';

export function EditorFormulario({ formId, onVoltar }: Props) {
  const [definicao, setDefinicao] = useState<DefinicaoFormulario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>('ocioso');
  const [secaoAberta, setSecaoAberta] = useState<string | null>(null);
  const [confirmarRestauro, setConfirmarRestauro] = useState(false);
  const entradaArquivo = useRef<HTMLInputElement>(null);
  // Cada campo grava por conta própria, depois da pausa na digitação. Partir
  // sempre da definição mais recente evita que a gravação de um campo desfaça
  // a do campo ao lado.
  const definicaoAtual = useRef<DefinicaoFormulario | null>(null);
  definicaoAtual.current = definicao;

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
    const definicao = definicaoAtual.current;
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
    const definicao = definicaoAtual.current;
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
    const definicao = definicaoAtual.current;
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
                      </div>
                    </div>

                    <CampoTextoAdiado
                      rotulo="Descrição"
                      multilinha
                      valor={etapa.descricao}
                      onGravar={(v) => alterarEtapa(secao.id, etapa.id, { descricao: v })}
                    />

                    <CampoTextoAdiado
                      rotulo="Detalhes (um por linha)"
                      multilinha
                      valor={(etapa.detalhes ?? []).join('\n')}
                      onGravar={(v) =>
                        alterarEtapa(secao.id, etapa.id, {
                          detalhes: v.split('\n').map((l) => l.trim()).filter(Boolean),
                        })
                      }
                    />

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
                          <CampoTextoAdiado
                            valor={midia.src}
                            placeholder="/media/sen-plus/arquivo.png"
                            onGravar={(v) => alterarMidia(secao.id, etapa.id, i, { src: v })}
                          />
                          <Botao
                            variante="perigo"
                            onClick={() => alterarMidia(secao.id, etapa.id, i, null)}
                          >
                            Remover
                          </Botao>
                          <CampoTextoAdiado
                            valor={midia.legenda ?? ''}
                            placeholder="Legenda"
                            onGravar={(v) => alterarMidia(secao.id, etapa.id, i, { legenda: v })}
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
