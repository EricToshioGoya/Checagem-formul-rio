import { infoDoTipo, type TipoChecklist } from '../../../compartilhado/tiposChecklist';
import { useCallback, useEffect, useState } from 'react';
import type { EntradaCatalogo } from '../../core/forms/tipos';
import {
  api,
  type AdministradorApi,
  type PainelAdmin,
  type Signatario,
  type TipoChecklistAdmin,
} from '../../core/api/cliente';
import { guardarTiposChecklist } from '../../core/forms/tiposChecklist';
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
  /** O painel tem certificado ABB configurado (modelo e quem assina). */
  comCertificado: boolean;
  certificado: string;
  signatario: Signatario;
}

const SIGNATARIO_VAZIO: Signatario = { nome: '', cargo: '', area: '', empresa: 'ABB Ltda', email: '' };

const VAZIO: Rascunho = {
  id: null,
  nome: '',
  descricao: '',
  responsaveis: [],
  comCertificado: false,
  certificado: '',
  signatario: SIGNATARIO_VAZIO,
};

/** Checklist aberto no construtor, com o painel a que pertence. */
interface Aberto {
  formId: string;
  painelNome: string;
  ativo: boolean;
}

/**
 * Nome de tipo sendo digitado: criar um tipo novo (e, vindo de um painel, já
 * o checklist dele) ou renomear um existente.
 */
interface EdicaoTipo {
  modo: 'criar' | 'renomear';
  /** No modo `renomear`, o tipo alterado. */
  tipo: TipoChecklistAdmin | null;
  /** No modo `criar` a partir de um painel: o painel que recebe o checklist. */
  painel: PainelAdmin | null;
  rotulo: string;
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
  const [modelos, setModelos] = useState<string[]>([]);
  const [tipos, setTipos] = useState<TipoChecklistAdmin[]>([]);
  const [edicaoTipo, setEdicaoTipo] = useState<EdicaoTipo | null>(null);
  const [erroTipo, setErroTipo] = useState<string | null>(null);
  const [gravandoTipo, setGravandoTipo] = useState(false);
  const [tipoParaExcluir, setTipoParaExcluir] = useState<TipoChecklistAdmin | null>(null);
  const { usuario } = useSessao();

  const carregar = useCallback(async () => {
    try {
      const {
        paineis: lista,
        modelosCertificado: modelos,
        tiposChecklist,
      } = await api.get<{
        paineis: PainelAdmin[];
        modelosCertificado: string[];
        tiposChecklist: TipoChecklistAdmin[];
      }>('/api/admin/paineis');
      // Os nomes valem para as telas e o PDF deste aparelho também.
      guardarTiposChecklist(tiposChecklist);
      setTipos(tiposChecklist);
      setPaineis(lista);
      setModelos(modelos);
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
        ...(rascunho.comCertificado
          ? { certificado: rascunho.certificado || undefined, signatario: rascunho.signatario }
          : {}),
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
      setAberto({
        formId: formulario.id,
        painelNome: painel.nome,
        ativo: formulario.ativo,
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar o checklist.');
    }
  };

  /** Grava o tipo digitado; vindo de um painel, já cria o checklist dele. */
  const gravarTipo = async () => {
    if (!edicaoTipo) return;
    setErroTipo(null);
    setGravandoTipo(true);
    try {
      if (edicaoTipo.modo === 'renomear' && edicaoTipo.tipo) {
        await api.put(`/api/admin/tipos-checklist/${edicaoTipo.tipo.id}`, {
          rotulo: edicaoTipo.rotulo,
        });
        setEdicaoTipo(null);
        await carregar();
        return;
      }
      const { tipo } = await api.post<{ tipo: TipoChecklistAdmin }>('/api/admin/tipos-checklist', {
        rotulo: edicaoTipo.rotulo,
      });
      const painel = edicaoTipo.painel;
      setEdicaoTipo(null);
      if (painel) await criarChecklist(painel, tipo.id);
      else await carregar();
    } catch (e) {
      setErroTipo(e instanceof Error ? e.message : 'Não foi possível gravar o tipo.');
    } finally {
      setGravandoTipo(false);
    }
  };

  const excluirTipo = async (tipo: TipoChecklistAdmin) => {
    setTipoParaExcluir(null);
    try {
      await api.delete(`/api/admin/tipos-checklist/${tipo.id}`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível excluir o tipo.');
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
        tipos={tipos}
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

      <section className="rounded-2xl border border-abb-line bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-lg leading-tight font-bold">Tipos de verificação</p>
            <p className="mt-0.5 text-xs text-abb-gray">
              Valem para todos os painéis. O nome aparece nos botões, nas telas do
              montador e no título do PDF.
            </p>
          </div>
          <Botao
            tamanho="compacto"
            onClick={() => {
              setErroTipo(null);
              setEdicaoTipo({ modo: 'criar', tipo: null, painel: null, rotulo: '' });
            }}
          >
            <IconeMais className="h-4 w-4" />
            Novo tipo
          </Botao>
        </div>
        <ul className="mt-3 flex flex-wrap gap-2">
          {tipos.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-1 rounded-lg border border-abb-line/70 bg-neutral-50 py-1 pr-1 pl-3"
            >
              <span className="text-sm font-semibold">{t.rotulo}</span>
              <span className="text-xs text-abb-gray">
                · {plural(t.checklists, 'checklist', 'checklists')}
              </span>
              <Botao
                tamanho="compacto"
                variante="texto"
                onClick={() => {
                  setErroTipo(null);
                  setEdicaoTipo({ modo: 'renomear', tipo: t, painel: null, rotulo: t.rotulo });
                }}
              >
                Renomear
              </Botao>
              {t.padrao || t.checklists > 0 ? null : (
                <Botao tamanho="compacto" variante="texto" onClick={() => setTipoParaExcluir(t)}>
                  Excluir
                </Botao>
              )}
            </li>
          ))}
        </ul>
      </section>

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
                      comCertificado: p.certificado !== null,
                      certificado: p.certificado ?? '',
                      signatario: p.signatario ?? SIGNATARIO_VAZIO,
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
                  {tipos.map((t) => (
                    <Botao
                      key={t.id}
                      tamanho="compacto"
                      onClick={() => void criarChecklist(p, t.id)}
                    >
                      <IconeMais className="h-4 w-4" />
                      {t.rotulo}
                    </Botao>
                  ))}
                  <Botao
                    tamanho="compacto"
                    onClick={() => {
                      setErroTipo(null);
                      setEdicaoTipo({ modo: 'criar', tipo: null, painel: p, rotulo: '' });
                    }}
                  >
                    <IconeMais className="h-4 w-4" />
                    Outro tipo…
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
                          {infoDoTipo(f.tipo).rotulo} ·{' '}
                          {f.etapas === 0
                            ? 'em branco'
                            : plural(f.etapas, 'verificação', 'verificações')}
                          {f.emiteCertificado
                            ? f.temModeloCertificado
                              ? ' · contém certificado'
                              : ' · contém certificado (falta o modelo em PDF)'
                            : ''}
                          {f.ativo ? '' : ' · desativado'}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Botao
                          tamanho="compacto"
                          variante="primario"
                          onClick={() =>
                            setAberto({
                              formId: f.id,
                              painelNome: p.nome,
                              ativo: f.ativo,
                            })
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

            <label className="flex items-start gap-3 rounded-md border border-abb-line bg-white p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0"
                checked={rascunho.comCertificado}
                onChange={(e) => setRascunho({ ...rascunho, comCertificado: e.target.checked })}
              />
              <span className="min-w-0">
                <span className="block text-base font-semibold">Certificado ABB das solicitações antigas</span>
                <span className="block text-sm text-abb-gray">
                  Só para as solicitações de certificação abertas antes da mudança. Nos
                  checklists, o certificado agora é o modelo em PDF enviado no próprio
                  checklist, em "Contém certificado?".
                </span>
              </span>
            </label>

            {rascunho.comCertificado ? (
              <div className="space-y-3 rounded-lg border border-abb-line bg-neutral-50 p-3">
                <div>
                  <label htmlFor="modelo-certificado" className="mb-1 block text-base font-semibold">
                    Modelo do certificado<span className="text-abb-red"> *</span>
                  </label>
                  <select
                    id="modelo-certificado"
                    className="min-h-12 w-full rounded-md border border-abb-line bg-white px-3 text-base focus:border-abb-red"
                    value={rascunho.certificado}
                    onChange={(e) => setRascunho({ ...rascunho, certificado: e.target.value })}
                  >
                    <option value="">Escolha…</option>
                    {modelos.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-base font-semibold">Quem assina o certificado (ABB)</p>
                {(
                  [
                    ['nome', 'Nome', true],
                    ['cargo', 'Cargo', true],
                    ['area', 'Área', false],
                    ['empresa', 'Empresa', false],
                    ['email', 'E-mail', false],
                  ] as const
                ).map(([campo, rotulo, obrigatorio]) => (
                  <CampoTexto
                    key={campo}
                    rotulo={rotulo}
                    obrigatorio={obrigatorio}
                    valor={rascunho.signatario[campo]}
                    onChange={(v) =>
                      setRascunho({
                        ...rascunho,
                        signatario: { ...rascunho.signatario, [campo]: v },
                      })
                    }
                  />
                ))}
              </div>
            ) : null}

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

      <Modal
        aberto={edicaoTipo !== null}
        titulo={edicaoTipo?.modo === 'renomear' ? 'Renomear tipo de verificação' : 'Novo tipo de verificação'}
        onFechar={() => setEdicaoTipo(null)}
      >
        {edicaoTipo ? (
          <div className="space-y-4">
            <CampoTexto
              rotulo="Nome do tipo"
              valor={edicaoTipo.rotulo}
              onChange={(v) => setEdicaoTipo({ ...edicaoTipo, rotulo: v })}
              placeholder="Ex.: Comissionamento, Inspeção final"
              obrigatorio
            />
            <Aviso>
              {edicaoTipo.modo === 'renomear'
                ? 'O nome novo vale para todos os checklists deste tipo, nas telas e nos próximos PDFs.'
                : edicaoTipo.painel
                  ? `O tipo fica disponível para todos os painéis, e ${edicaoTipo.painel.nome} já recebe um checklist dele em branco.`
                  : 'O tipo fica disponível como botão em todos os painéis.'}
            </Aviso>
            {erroTipo ? <Erro detalhe={erroTipo} /> : null}
            <div className="flex gap-2">
              <Botao variante="primario" disabled={gravandoTipo} onClick={() => void gravarTipo()}>
                {gravandoTipo
                  ? 'Gravando…'
                  : edicaoTipo.modo === 'renomear'
                    ? 'Gravar'
                    : edicaoTipo.painel
                      ? 'Criar e montar checklist'
                      : 'Criar tipo'}
              </Botao>
              <Botao onClick={() => setEdicaoTipo(null)}>Cancelar</Botao>
            </div>
          </div>
        ) : null}
      </Modal>

      <Confirmacao
        aberto={tipoParaExcluir !== null}
        titulo="Excluir tipo de verificação"
        mensagem={
          tipoParaExcluir
            ? `Excluir o tipo "${tipoParaExcluir.rotulo}"? Ele deixa de aparecer como opção nos painéis.`
            : ''
        }
        textoConfirmar="Excluir"
        onConfirmar={() => tipoParaExcluir && void excluirTipo(tipoParaExcluir)}
        onCancelar={() => setTipoParaExcluir(null)}
      />

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
