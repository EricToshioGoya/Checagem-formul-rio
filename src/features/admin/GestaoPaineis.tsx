import { useCallback, useEffect, useState } from 'react';
import type { EntradaCatalogo } from '../../core/forms/tipos';
import { api, type PainelAdmin } from '../../core/api/cliente';
import { plural } from '../../../compartilhado/plural';
import { ConstrutorChecklist } from './ConstrutorChecklist';
import { Botao } from '../../shared/componentes/Botao';
import { CampoTexto } from '../../shared/componentes/Campos';
import { Confirmacao } from '../../shared/componentes/Confirmacao';
import { Aviso, Carregando, Erro, Vazio } from '../../shared/componentes/Estado';
import { IconeMais } from '../../shared/componentes/Icones';
import { Modal } from '../../shared/componentes/Modal';

interface Rascunho {
  id: number | null;
  nome: string;
  descricao: string;
  responsaveis: string[];
}

const VAZIO: Rascunho = { id: null, nome: '', descricao: '', responsaveis: [''] };

/** Checklist aberto no construtor, com o painel a que pertence. */
interface Aberto {
  formId: string;
  painelNome: string;
  ativo: boolean;
}

/**
 * Cadastro dos painéis e dos checklists de cada um.
 *
 * Painel e checklist são a mesma decisão vista de dois ângulos: quem cadastra
 * o painel é quem vai dizer o que se verifica nele. Por isso o painel nasce já
 * com um checklist em branco e a edição dele fica aqui dentro, no cartão do
 * próprio painel — antes eram duas abas separadas, e o checklist criado numa
 * não tinha como encontrar o painel criado na outra.
 */
export function GestaoPaineis() {
  const [paineis, setPaineis] = useState<PainelAdmin[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [paraExcluir, setParaExcluir] = useState<PainelAdmin | null>(null);
  const [checklistParaExcluir, setChecklistParaExcluir] = useState<EntradaCatalogo | null>(null);
  const [aberto, setAberto] = useState<Aberto | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { paineis: lista } = await api.get<{ paineis: PainelAdmin[] }>(
        '/api/admin/paineis',
      );
      setPaineis(lista);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler os painéis.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alterarEmail = (i: number, valor: string) => {
    setRascunho((r) =>
      r ? { ...r, responsaveis: r.responsaveis.map((e, j) => (j === i ? valor : e)) } : r,
    );
  };

  const salvar = async () => {
    if (!rascunho) return;
    setErroForm(null);
    setSalvando(true);
    try {
      const corpo = {
        nome: rascunho.nome,
        // A descrição saiu da tela, mas a que já existe vai de volta intacta:
        // editar o nome não pode apagá-la sem aviso.
        descricao: rascunho.descricao || undefined,
        // Linhas em branco são descartadas: o administrador acrescenta campos
        // à vontade e só preenche os que for usar.
        responsaveis: rascunho.responsaveis.map((e) => e.trim()).filter(Boolean),
      };
      if (rascunho.id === null) await api.post('/api/admin/paineis', corpo);
      else await api.put(`/api/admin/paineis/${rascunho.id}`, corpo);
      setRascunho(null);
      await carregar();
    } catch (e) {
      setErroForm(e instanceof Error ? e.message : 'Não foi possível gravar o painel.');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (painel: PainelAdmin) => {
    setParaExcluir(null);
    try {
      await api.delete(`/api/admin/paineis/${painel.id}`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível excluir o painel.');
    }
  };

  const criarChecklist = async (painel: PainelAdmin, tipo: 'montagem' | 'rotina') => {
    try {
      const { formulario } = await api.post<{ formulario: EntradaCatalogo }>(
        `/api/admin/paineis/${painel.id}/formularios`,
        { tipo },
      );
      await carregar();
      setAberto({ formId: formulario.id, painelNome: painel.nome, ativo: formulario.ativo });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar o checklist.');
    }
  };

  const excluirChecklist = async (entrada: EntradaCatalogo) => {
    setChecklistParaExcluir(null);
    try {
      await api.delete(`/api/admin/formularios/${entrada.id}`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível excluir o checklist.');
    }
  };

  if (aberto) {
    return (
      <ConstrutorChecklist
        formId={aberto.formId}
        painelNome={aberto.painelNome}
        ativoInicial={aberto.ativo}
        onVoltar={() => {
          setAberto(null);
          void carregar();
        }}
        onAlterado={() => void carregar()}
      />
    );
  }

  if (!paineis && !erro) return <Carregando mensagem="Lendo os painéis…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Painéis</h2>
          <p className="text-base text-abb-gray">
            Cada painel vira uma opção na tela de login e traz o seu próprio
            checklist.
          </p>
        </div>
        <Botao variante="primario" onClick={() => setRascunho({ ...VAZIO })}>
          Cadastrar painel
        </Botao>
      </div>

      {erro ? <Erro detalhe={erro} /> : null}

      {paineis?.length === 0 ? (
        <Vazio titulo="Nenhum painel cadastrado">
          Sem painel cadastrado, a tela de login não tem o que oferecer e
          ninguém consegue pedir acesso.
        </Vazio>
      ) : null}

      <ul className="space-y-3">
        {paineis?.map((p) => (
          <li key={p.id} className="rounded-2xl border border-abb-line bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-lg leading-tight font-bold">{p.nome}</p>
                <p className="mt-0.5 text-xs text-abb-gray">
                  {p.montadoresAprovados === 0
                    ? 'Nenhum montador com acesso'
                    : `${p.montadoresAprovados} montador(es) com acesso`}
                  {' · aprovam: '}
                  {p.responsaveis.join(', ') || '—'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Botao
                  tamanho="compacto"
                  onClick={() =>
                    setRascunho({
                      id: p.id,
                      nome: p.nome,
                      descricao: p.descricao ?? '',
                      responsaveis: p.responsaveis.length ? [...p.responsaveis] : [''],
                    })
                  }
                >
                  Editar painel
                </Botao>
                <Botao tamanho="compacto" variante="perigo" onClick={() => setParaExcluir(p)}>
                  Excluir
                </Botao>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-abb-line/70 bg-neutral-50 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-sm font-semibold">Checklists</p>
                <div className="flex flex-wrap gap-2">
                  <Botao tamanho="compacto" onClick={() => void criarChecklist(p, 'montagem')}>
                    <IconeMais className="h-4 w-4" />
                    Montagem
                  </Botao>
                  <Botao tamanho="compacto" onClick={() => void criarChecklist(p, 'rotina')}>
                    <IconeMais className="h-4 w-4" />
                    Rotina
                  </Botao>
                </div>
              </div>

              {p.formularios.length === 0 ? (
                <p className="mt-1 px-1 text-sm text-abb-gray">
                  Nenhum checklist ainda. Crie um para montar as verificações.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {p.formularios.map((f) => (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-abb-line/70 bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{f.nome}</p>
                        <p className="text-xs text-abb-gray">
                          {f.tipo === 'rotina' ? 'Rotina' : 'Montagem'} ·{' '}
                          {f.etapas === 0
                            ? 'em branco'
                            : plural(f.etapas, 'verificação', 'verificações')}
                          {f.ativo ? '' : ' · desativado'}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Botao
                          tamanho="compacto"
                          variante="primario"
                          onClick={() =>
                            setAberto({ formId: f.id, painelNome: p.nome, ativo: f.ativo })
                          }
                        >
                          {f.etapas === 0 ? 'Montar checklist' : 'Editar checklist'}
                        </Botao>
                        <Botao
                          tamanho="compacto"
                          variante="perigo"
                          onClick={() => setChecklistParaExcluir(f)}
                        >
                          Excluir
                        </Botao>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Modal
        aberto={rascunho !== null}
        titulo={rascunho?.id === null ? 'Cadastrar painel' : 'Editar painel'}
        onFechar={() => setRascunho(null)}
      >
        {rascunho ? (
          <div className="space-y-4">
            <CampoTexto
              rotulo="Nome do painel"
              valor={rascunho.nome}
              onChange={(v) => setRascunho({ ...rascunho, nome: v })}
              placeholder="Ex.: System Pro E Power"
              obrigatorio
            />

            <div>
              <p className="mb-1 text-base font-semibold">
                E-mails dos responsáveis<span className="text-abb-red"> *</span>
                <span className="block text-sm font-normal text-abb-gray">
                  Qualquer um deles aprova os montadores deste painel. Pode
                  acrescentar quantos quiser.
                </span>
              </p>
              <div className="space-y-2">
                {rascunho.responsaveis.map((email, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="email"
                      inputMode="email"
                      aria-label={`E-mail do responsável ${i + 1}`}
                      className="min-h-12 w-full rounded-md border border-abb-line bg-white px-3 text-base placeholder:text-neutral-400 focus:border-abb-red"
                      value={email}
                      placeholder="nome@empresa.com"
                      onChange={(e) => alterarEmail(i, e.target.value)}
                    />
                    <Botao
                      variante="perigo"
                      className="shrink-0 px-3"
                      aria-label={`Remover responsável ${i + 1}`}
                      disabled={rascunho.responsaveis.length === 1}
                      onClick={() =>
                        setRascunho({
                          ...rascunho,
                          responsaveis: rascunho.responsaveis.filter((_, j) => j !== i),
                        })
                      }
                    >
                      Remover
                    </Botao>
                  </div>
                ))}
              </div>
              <Botao
                className="mt-2"
                onClick={() =>
                  setRascunho({ ...rascunho, responsaveis: [...rascunho.responsaveis, ''] })
                }
              >
                Acrescentar e-mail
              </Botao>
            </div>

            <Aviso>
              {rascunho.id === null
                ? 'O painel nasce com um checklist de montagem em branco, pronto para você montar as verificações.'
                : 'O responsável não precisa ter conta ainda. Quando criar a conta com esse e-mail, os pedidos que estiverem esperando aparecem para ele.'}
            </Aviso>

            {erroForm ? <Erro detalhe={erroForm} /> : null}

            <div className="flex gap-2">
              <Botao variante="primario" disabled={salvando} onClick={salvar}>
                {salvando ? 'Gravando…' : 'Gravar'}
              </Botao>
              <Botao onClick={() => setRascunho(null)}>Cancelar</Botao>
            </div>
          </div>
        ) : null}
      </Modal>

      <Confirmacao
        aberto={paraExcluir !== null}
        titulo="Excluir painel"
        mensagem={
          paraExcluir
            ? `Excluir "${paraExcluir.nome}" some com ele da tela de login e apaga ${plural(paraExcluir.montadoresAprovados, 'aprovação', 'aprovações')}, os pedidos pendentes e ${plural(paraExcluir.formularios.length, 'checklist', 'checklists')}. O que já foi preenchido nos aparelhos dos montadores não é apagado.`
            : ''
        }
        textoConfirmar="Excluir"
        onConfirmar={() => paraExcluir && void excluir(paraExcluir)}
        onCancelar={() => setParaExcluir(null)}
      />

      <Confirmacao
        aberto={checklistParaExcluir !== null}
        titulo="Excluir checklist"
        mensagem={
          checklistParaExcluir
            ? `Excluir "${checklistParaExcluir.nome}" tira ${plural(checklistParaExcluir.etapas, 'verificação', 'verificações')} dos aparelhos na próxima sincronização.\n\nO que já foi preenchido não é apagado.`
            : ''
        }
        textoConfirmar="Excluir"
        onConfirmar={() => checklistParaExcluir && void excluirChecklist(checklistParaExcluir)}
        onCancelar={() => setChecklistParaExcluir(null)}
      />
    </div>
  );
}
