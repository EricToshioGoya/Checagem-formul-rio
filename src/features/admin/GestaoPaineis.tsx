import {
  infoDoTipo,
  TIPOS_CHECKLIST,
  type TipoChecklist,
} from '../../../compartilhado/tiposChecklist';
import { useCallback, useEffect, useState } from 'react';
import type { EntradaCatalogo } from '../../core/forms/tipos';
import { api, type AdministradorApi, type PainelAdmin } from '../../core/api/cliente';
import { useSessao } from '../../core/api/SessaoContexto';
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

const VAZIO: Rascunho = { id: null, nome: '', descricao: '', responsaveis: [] };

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
  const [admins, setAdmins] = useState<AdministradorApi[]>([]);
  const { usuario } = useSessao();

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

  // Responsável por painel é sempre administrador: a escolha é entre eles.
  useEffect(() => {
    api
      .get<{ administradores: AdministradorApi[] }>('/api/admin/administradores')
      .then((r) => setAdmins(r.administradores))
      .catch(() => setAdmins([]));
  }, []);

  const alternarResponsavel = (email: string, marcado: boolean) => {
    setRascunho((r) =>
      r
        ? {
            ...r,
            responsaveis: marcado
              ? [...r.responsaveis, email]
              : r.responsaveis.filter((e) => e !== email),
          }
        : r,
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
        responsaveis: rascunho.responsaveis,
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

  const criarChecklist = async (painel: PainelAdmin, tipo: TipoChecklist) => {
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
                  {' · responsáveis: '}
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
                      responsaveis: [...p.responsaveis],
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
                  {TIPOS_CHECKLIST.map((t) => (
                    <Botao
                      key={t.id}
                      tamanho="compacto"
                      onClick={() => void criarChecklist(p, t.id)}
                    >
                      <IconeMais className="h-4 w-4" />
                      {t.rotulo}
                    </Botao>
                  ))}
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
                          {infoDoTipo(f.tipo).rotulo} ·{' '}
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

            <fieldset>
              <legend className="mb-1 text-base font-semibold">
                Administradores responsáveis<span className="text-abb-red"> *</span>
                <span className="block text-sm font-normal text-abb-gray">
                  Recebem os avisos de pedido de acesso e preenchem este painel sem pedir
                  acesso. Quem aprova ou recusa pedidos é qualquer administrador, em Acessos.
                </span>
              </legend>
              <div className="space-y-1.5">
                {admins.map((a) => (
                  <label
                    key={a.id}
                    className="flex min-h-12 items-center gap-3 rounded-md border border-abb-line bg-white px-3"
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0"
                      checked={rascunho.responsaveis.includes(a.email)}
                      onChange={(e) => alternarResponsavel(a.email, e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold">
                        {a.nome}
                        {a.email === usuario?.email ? ' (você)' : ''}
                      </span>
                      <span className="block truncate text-sm text-abb-gray">{a.email}</span>
                    </span>
                  </label>
                ))}
                {/* Quem já não é administrador continua marcado, só para poder ser desmarcado. */}
                {rascunho.responsaveis
                  .filter((e) => !admins.some((a) => a.email === e))
                  .map((e) => (
                    <label
                      key={e}
                      className="flex min-h-12 items-center gap-3 rounded-md border border-abb-red/60 bg-red-50 px-3"
                    >
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0"
                        checked
                        onChange={() => alternarResponsavel(e, false)}
                      />
                      <span className="min-w-0 text-base">
                        {e}
                        <span className="block text-sm text-abb-red">Não é mais administrador</span>
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>

            <Aviso>
              {rascunho.id === null
                ? 'O painel nasce com um checklist de montagem em branco, pronto para você montar as verificações.'
                : 'Só contas de administrador podem ser responsáveis. Quem deixa de ser administrador precisa ser desmarcado aqui.'}
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
