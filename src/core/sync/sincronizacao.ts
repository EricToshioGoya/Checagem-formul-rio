import { api, ErroApi } from '../api/cliente';
import { db, novoUid } from '../db/db';
import { ProjetoRepository } from '../db/repositorios';
import type { Midia, Preenchimento, Projeto } from '../db/tipos';
import type { MapaRespostas, ValoresCabecalho } from '../forms/tipos';

/**
 * Sincronização das checagens com o servidor.
 *
 * Cada projeto (uma conta num painel) vai inteiro para o servidor como um
 * documento — dados, TAGs, respostas e a lista das fotos —, e as fotos vão
 * uma a uma, só as que o servidor ainda não tem. O aparelho continua sendo
 * onde se trabalha, offline; o servidor guarda a cópia, leva o trabalho para
 * outro aparelho da mesma conta e mostra o andamento ao responsável.
 *
 * Duas pessoas nunca disputam um projeto: cada montador tem o seu. A disputa
 * possível é entre aparelhos da mesma conta, e aí as duas versões são
 * juntadas — nenhuma resposta ou foto se perde (ver `juntarDocumentos`).
 */

export interface DocumentoProjeto {
  projeto: {
    empresa: string;
    nomeProjeto: string;
    operador: string;
    numeroPedido?: string;
    painelSlug?: string;
    criadoEm: number;
    atualizadoEm: number;
  };
  /** `formIds` ausente: TAG que segue com todos os checklists do painel. */
  tags: Array<{ uid: string; nome: string; ordem: number; formIds?: string[] }>;
  preenchimentos: Array<{
    tagUid: string;
    formId: string;
    formRevisao: string;
    cabecalho: ValoresCabecalho;
    respostas: MapaRespostas;
    atualizadoEm: number;
  }>;
  midias: Array<{
    uid: string;
    tagUid: string;
    formId: string;
    etapaId: string;
    mime: string;
    largura: number;
    altura: number;
    tamanho: number;
    nomeOriginal?: string;
    criadoEm: number;
    ordem: number;
  }>;
}

// ---------------------------------------------------------------- estado

export type FaseProjeto = 'enviado' | 'enviando' | 'sem-acesso' | 'erro';

export interface EstadoSync {
  /** O que a última passada encontrou: rede fora, erro, ou tudo certo. */
  fase: 'ocioso' | 'sincronizando' | 'sem-rede' | 'erro';
  ultimaEm: number | null;
  erro: string | null;
  projetos: Record<number, { fase: FaseProjeto; erro?: string }>;
}

let estado: EstadoSync = { fase: 'ocioso', ultimaEm: null, erro: null, projetos: {} };
const ouvintes = new Set<() => void>();

function mudar(parcial: Partial<EstadoSync>): void {
  estado = { ...estado, ...parcial };
  ouvintes.forEach((ouvir) => ouvir());
}

function mudarProjeto(id: number, valor: EstadoSync['projetos'][number]): void {
  mudar({ projetos: { ...estado.projetos, [id]: valor } });
}

export function lerEstadoSync(): EstadoSync {
  return estado;
}

export function ouvirEstadoSync(ouvir: () => void): () => void {
  ouvintes.add(ouvir);
  return () => ouvintes.delete(ouvir);
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : 'Falha desconhecida.';
}

/** Sem rede ou servidor fora do ar: tenta-se de novo depois, sem alarde. */
function ehFaltaDeConexao(erro: unknown): boolean {
  return erro instanceof ErroApi && (erro.semRede || erro.status >= 500);
}

// --------------------------------------------------- exclusões pendentes

const CHAVE_EXCLUSOES = 'sync-exclusoes-pendentes';

/** Projetos excluídos sem rede: a exclusão vai ao servidor na próxima conexão. */
function lerExclusoes(usuarioId: number): number[] {
  try {
    const todas = JSON.parse(localStorage.getItem(CHAVE_EXCLUSOES) ?? '{}') as Record<string, number[]>;
    return todas[usuarioId] ?? [];
  } catch {
    return [];
  }
}

function gravarExclusoes(usuarioId: number, lista: number[]): void {
  try {
    const todas = JSON.parse(localStorage.getItem(CHAVE_EXCLUSOES) ?? '{}') as Record<string, number[]>;
    if (lista.length) todas[usuarioId] = lista;
    else delete todas[usuarioId];
    localStorage.setItem(CHAVE_EXCLUSOES, JSON.stringify(todas));
  } catch {
    // Armazenamento bloqueado: a exclusão fica só neste aparelho.
  }
}

/**
 * Exclui o projeto daqui e do servidor. Sem rede, a exclusão no servidor fica
 * guardada para a próxima conexão — senão a sincronização traria o projeto
 * de volta.
 */
export async function excluirProjetoEmTodaParte(projeto: Projeto & { id: number }): Promise<void> {
  await ProjetoRepository.excluir(projeto.id);
  if (projeto.painelId === undefined || projeto.usuarioId === undefined) return;
  try {
    await api.delete(`/api/sync/projetos/${projeto.painelId}`);
  } catch {
    gravarExclusoes(projeto.usuarioId, [...new Set([...lerExclusoes(projeto.usuarioId), projeto.painelId])]);
  }
}

async function enviarExclusoesPendentes(usuarioId: number): Promise<void> {
  const pendentes = lerExclusoes(usuarioId);
  const restantes: number[] = [];
  for (const painelId of pendentes) {
    try {
      await api.delete(`/api/sync/projetos/${painelId}`);
    } catch (erro) {
      if (ehFaltaDeConexao(erro)) restantes.push(painelId);
    }
  }
  gravarExclusoes(usuarioId, restantes);
}

// -------------------------------------------------- documento ↔ aparelho

async function conteudoDoProjeto(projetoId: number) {
  const tags = await db.tags.where('projetoId').equals(projetoId).toArray();
  // TAG anterior à versão 5 sem `uid` (não deveria haver): recebe um agora.
  for (const t of tags) {
    if (!t.uid) {
      t.uid = novoUid();
      await db.tags.update(t.id!, { uid: t.uid });
    }
  }
  const preenchimentos = tags.length
    ? await db.preenchimentos.where('tagId').anyOf(tags.map((t) => t.id!)).toArray()
    : [];
  const midias = preenchimentos.length
    ? await db.midias.where('preenchimentoId').anyOf(preenchimentos.map((p) => p.id!)).toArray()
    : [];
  for (const m of midias) {
    if (!m.uid) {
      m.uid = novoUid();
      await db.midias.update(m.id!, { uid: m.uid });
    }
  }
  return { tags, preenchimentos, midias };
}

export async function montarDocumento(
  projeto: Projeto,
): Promise<{ documento: DocumentoProjeto; arquivos: Map<string, Blob> }> {
  const { tags, preenchimentos, midias } = await conteudoDoProjeto(projeto.id!);
  const uidDaTag = new Map(tags.map((t) => [t.id!, t.uid!]));
  const preenchimentoPorId = new Map(preenchimentos.map((p) => [p.id!, p]));

  const documento: DocumentoProjeto = {
    projeto: {
      empresa: projeto.empresa,
      nomeProjeto: projeto.nomeProjeto,
      operador: projeto.operador,
      numeroPedido: projeto.numeroPedido,
      painelSlug: projeto.painelSlug,
      criadoEm: projeto.criadoEm,
      atualizadoEm: projeto.atualizadoEm,
    },
    tags: tags.map((t) => ({ uid: t.uid!, nome: t.nome, ordem: t.ordem, formIds: t.formIds })),
    preenchimentos: preenchimentos.map((p) => ({
      tagUid: uidDaTag.get(p.tagId!)!,
      formId: p.formId,
      formRevisao: p.formRevisao,
      cabecalho: p.cabecalho ?? {},
      respostas: p.respostas ?? {},
      atualizadoEm: p.atualizadoEm,
    })),
    midias: midias
      .filter((m) => preenchimentoPorId.has(m.preenchimentoId))
      .map((m) => {
        const p = preenchimentoPorId.get(m.preenchimentoId)!;
        return {
          uid: m.uid!,
          tagUid: uidDaTag.get(p.tagId!)!,
          formId: p.formId,
          etapaId: m.etapaId,
          mime: m.mime,
          largura: m.largura,
          altura: m.altura,
          tamanho: m.tamanho,
          nomeOriginal: m.nomeOriginal,
          criadoEm: m.criadoEm,
          ordem: m.ordem,
        };
      }),
  };
  return { documento, arquivos: new Map(midias.map((m) => [m.uid!, m.blob])) };
}

/**
 * Grava no aparelho o que veio do servidor. As fotos que faltam são baixadas
 * antes, fora da transação — o IndexedDB não espera pela rede no meio dela.
 * Preenchimentos daqui que o documento não tem ficam: podem ser o que está
 * aberto na tela agora, ainda vazio.
 */
async function aplicarDocumento(
  usuarioId: number,
  painelId: number,
  versao: number,
  documento: DocumentoProjeto,
  local?: Projeto,
): Promise<number> {
  const daqui = local ? await conteudoDoProjeto(local.id!) : { tags: [], preenchimentos: [], midias: [] };
  const uidsDaqui = new Set(daqui.midias.map((m) => m.uid));
  const baixadas = new Map<string, Blob>();
  for (const m of documento.midias) {
    if (uidsDaqui.has(m.uid)) continue;
    try {
      baixadas.set(m.uid, await api.baixarArquivo(`/api/sync/midias/${m.uid}`));
    } catch (erro) {
      // Foto citada que o servidor ainda não recebeu (o outro aparelho caiu
      // no meio do envio): entra na próxima passada.
      if (ehFaltaDeConexao(erro)) throw erro;
    }
  }

  return db.transaction('rw', db.projetos, db.tags, db.preenchimentos, db.midias, async () => {
    const dados = {
      empresa: documento.projeto.empresa,
      nomeProjeto: documento.projeto.nomeProjeto,
      operador: documento.projeto.operador,
      numeroPedido: documento.projeto.numeroPedido,
      atualizadoEm: documento.projeto.atualizadoEm,
      sincronizadoEm: documento.projeto.atualizadoEm,
      versaoServidor: versao,
    };
    let projetoId = local?.id;
    if (projetoId === undefined) {
      // Outra aba pode ter criado o projeto deste painel enquanto as fotos baixavam.
      const existente = await db.projetos.where('[usuarioId+painelId]').equals([usuarioId, painelId]).first();
      projetoId =
        existente?.id ??
        (await db.projetos.add({
          ...dados,
          painelId,
          painelSlug: documento.projeto.painelSlug,
          usuarioId,
          criadoEm: documento.projeto.criadoEm,
        }));
    }
    await db.projetos.update(projetoId, dados);

    // TAGs: as do documento entram ou se atualizam; as daqui que ele não tem
    // saem, com o que estava nelas.
    const tagsDaqui = await db.tags.where('projetoId').equals(projetoId).toArray();
    const tagPorUid = new Map(tagsDaqui.map((t) => [t.uid, t]));
    const idDaTag = new Map<string, number>();
    for (const t of documento.tags) {
      const existente = tagPorUid.get(t.uid);
      if (existente) {
        await db.tags.update(existente.id!, { nome: t.nome, ordem: t.ordem, formIds: t.formIds });
        idDaTag.set(t.uid, existente.id!);
      } else {
        idDaTag.set(
          t.uid,
          await db.tags.add({ projetoId, nome: t.nome, ordem: t.ordem, uid: t.uid, formIds: t.formIds }),
        );
      }
    }
    const uidsTags = new Set(documento.tags.map((t) => t.uid));
    for (const t of tagsDaqui) {
      if (uidsTags.has(t.uid!)) continue;
      const ids = (await db.preenchimentos.where('tagId').equals(t.id!).toArray()).map((p) => p.id!);
      if (ids.length) await db.midias.where('preenchimentoId').anyOf(ids).delete();
      await db.preenchimentos.where('tagId').equals(t.id!).delete();
      await db.tags.delete(t.id!);
    }

    // Preenchimentos: criados ou substituídos pelo do documento.
    const idDoPreenchimento = new Map<string, number>();
    const garantirPreenchimento = async (tagId: number, formId: string, base?: Partial<Preenchimento>) => {
      const chave = `${tagId}|${formId}`;
      if (idDoPreenchimento.has(chave) && !base) return idDoPreenchimento.get(chave)!;
      const existente = await db.preenchimentos.where('[tagId+formId]').equals([tagId, formId]).first();
      let id: number;
      if (existente) {
        if (base) await db.preenchimentos.update(existente.id!, base);
        id = existente.id!;
      } else {
        id = await db.preenchimentos.add({
          tagId,
          formId,
          formRevisao: base?.formRevisao ?? '',
          cabecalho: base?.cabecalho ?? {},
          respostas: base?.respostas ?? {},
          atualizadoEm: base?.atualizadoEm ?? Date.now(),
        });
      }
      idDoPreenchimento.set(chave, id);
      return id;
    };
    for (const p of documento.preenchimentos) {
      const tagId = idDaTag.get(p.tagUid);
      if (tagId === undefined) continue;
      await garantirPreenchimento(tagId, p.formId, {
        formRevisao: p.formRevisao,
        cabecalho: p.cabecalho,
        respostas: p.respostas,
        atualizadoEm: p.atualizadoEm,
      });
    }

    // Mídias: entram as baixadas; saem as daqui que o documento não cita.
    for (const m of documento.midias) {
      const blob = baixadas.get(m.uid);
      const tagId = idDaTag.get(m.tagUid);
      if (!blob || tagId === undefined) continue;
      const preenchimentoId = await garantirPreenchimento(tagId, m.formId);
      const registro: Midia = {
        uid: m.uid,
        preenchimentoId,
        etapaId: m.etapaId,
        blob: new Blob([blob], { type: m.mime }),
        mime: m.mime,
        largura: m.largura,
        altura: m.altura,
        tamanho: m.tamanho,
        nomeOriginal: m.nomeOriginal,
        criadoEm: m.criadoEm,
        ordem: m.ordem,
      };
      await db.midias.add(registro);
    }
    const uidsDocumento = new Set(documento.midias.map((m) => m.uid));
    const sobrando = daqui.midias.filter((m) => !uidsDocumento.has(m.uid!)).map((m) => m.id!);
    if (sobrando.length) await db.midias.bulkDelete(sobrando);

    return projetoId;
  });
}

/**
 * Junta duas versões do mesmo projeto. Nada se perde: TAGs e fotos são a
 * soma das duas; numa resposta dada nos dois aparelhos, vale a do
 * preenchimento alterado por último. O preço é que algo apagado num aparelho
 * e mantido no outro volta.
 */
export function juntarDocumentos(a: DocumentoProjeto, b: DocumentoProjeto): DocumentoProjeto {
  const [velho, novo] = a.projeto.atualizadoEm >= b.projeto.atualizadoEm ? [b, a] : [a, b];

  const tags = new Map(velho.tags.map((t) => [t.uid, t]));
  for (const t of novo.tags) tags.set(t.uid, t);

  const preenchimentos = new Map(velho.preenchimentos.map((p) => [`${p.tagUid}|${p.formId}`, p]));
  for (const p of novo.preenchimentos) {
    const chave = `${p.tagUid}|${p.formId}`;
    const outro = preenchimentos.get(chave);
    if (!outro) {
      preenchimentos.set(chave, p);
      continue;
    }
    const [antes, depois] = outro.atualizadoEm <= p.atualizadoEm ? [outro, p] : [p, outro];
    preenchimentos.set(chave, {
      ...depois,
      cabecalho: { ...antes.cabecalho, ...depois.cabecalho },
      respostas: { ...antes.respostas, ...depois.respostas },
      atualizadoEm: Math.max(antes.atualizadoEm, depois.atualizadoEm),
    });
  }

  const midias = new Map(velho.midias.map((m) => [m.uid, m]));
  for (const m of novo.midias) midias.set(m.uid, m);

  return {
    projeto: { ...novo.projeto, atualizadoEm: Date.now() },
    tags: [...tags.values()],
    preenchimentos: [...preenchimentos.values()],
    midias: [...midias.values()],
  };
}

// ---------------------------------------------------------------- envio

interface RespostaEnvio {
  versao: number;
  faltando: string[];
}

async function enviar(projeto: Projeto, tentativa = 1): Promise<void> {
  const { documento, arquivos } = await montarDocumento(projeto);
  let resposta: RespostaEnvio;
  try {
    resposta = await api.put<RespostaEnvio>(`/api/sync/projetos/${projeto.painelId}`, {
      versaoBase: projeto.versaoServidor ?? 0,
      documento,
    });
  } catch (erro) {
    if (erro instanceof ErroApi && erro.codigo === 'versao-desatualizada' && tentativa <= 3) {
      await juntarEEnviar(projeto, tentativa);
      return;
    }
    throw erro;
  }

  // A versão vale assim que o documento foi aceito; o projeto só conta como
  // enviado depois que todas as fotos subirem — se uma falhar, a próxima
  // passada manda o documento de novo e recebe a lista do que falta.
  await db.projetos.update(projeto.id!, { versaoServidor: resposta.versao });
  for (const uid of resposta.faltando) {
    const arquivo = arquivos.get(uid);
    if (arquivo) await api.enviarArquivo(`/api/sync/midias/${uid}`, arquivo);
  }
  await db.projetos.update(projeto.id!, { sincronizadoEm: documento.projeto.atualizadoEm });
}

/** Outro aparelho da mesma conta enviou antes: junta, grava aqui e envia de novo. */
async function juntarEEnviar(projeto: Projeto, tentativa: number): Promise<void> {
  const remoto = await api.get<{ versao: number; documento: DocumentoProjeto }>(
    `/api/sync/projetos/${projeto.painelId}`,
  );
  const { documento: local } = await montarDocumento(projeto);
  const juntado = juntarDocumentos(local, remoto.documento);
  await aplicarDocumento(projeto.usuarioId!, projeto.painelId!, remoto.versao, juntado, projeto);
  // O juntado ainda não está no servidor: marca como pendente e manda.
  await db.projetos.update(projeto.id!, { sincronizadoEm: 0 });
  const atualizado = await db.projetos.get(projeto.id!);
  if (atualizado) await enviar(atualizado, tentativa + 1);
}

async function sincronizarProjeto(
  usuarioId: number,
  projeto: Projeto,
  remoto: { versao: number } | undefined,
): Promise<void> {
  const id = projeto.id!;
  // O servidor não tem mais a cópia que este aparelho julga ter enviado (um
  // backup antigo foi restaurado, por exemplo): o projeto vai de novo, inteiro.
  if (remoto === undefined && (projeto.versaoServidor ?? 0) > 0) {
    await db.projetos.update(id, { versaoServidor: 0, sincronizadoEm: 0 });
    projeto = { ...projeto, versaoServidor: 0, sincronizadoEm: 0 };
  }
  const alterado = (projeto.sincronizadoEm ?? 0) < projeto.atualizadoEm;
  const servidorAvancou = remoto !== undefined && remoto.versao > (projeto.versaoServidor ?? 0);
  if (!alterado && !servidorAvancou) {
    mudarProjeto(id, { fase: 'enviado' });
    return;
  }

  mudarProjeto(id, { fase: 'enviando' });
  try {
    if (servidorAvancou && !alterado) {
      const r = await api.get<{ versao: number; documento: DocumentoProjeto }>(
        `/api/sync/projetos/${projeto.painelId}`,
      );
      await aplicarDocumento(usuarioId, projeto.painelId!, r.versao, r.documento, projeto);
    } else if (servidorAvancou) {
      await juntarEEnviar(projeto, 1);
    } else {
      await enviar(projeto);
    }
    mudarProjeto(id, { fase: 'enviado' });
  } catch (erro) {
    if (erro instanceof ErroApi && erro.codigo === 'sem-acesso') {
      mudarProjeto(id, { fase: 'sem-acesso' });
      return;
    }
    if (ehFaltaDeConexao(erro)) {
      mudarProjeto(id, { fase: 'erro', erro: 'Sem conexão.' });
      throw erro;
    }
    mudarProjeto(id, { fase: 'erro', erro: mensagem(erro) });
  }
}

let rodando = false;
let repetir = false;

/**
 * Uma passada completa: exclusões pendentes, envio do que mudou aqui, e o que
 * existe só no servidor vem para o aparelho. Chamadas durante uma passada
 * pedem outra logo depois, em vez de rodar duas ao mesmo tempo.
 */
export async function sincronizarAgora(usuarioId: number): Promise<void> {
  if (rodando) {
    repetir = true;
    return;
  }
  rodando = true;
  mudar({ fase: 'sincronizando', erro: null });
  try {
    await enviarExclusoesPendentes(usuarioId);
    const { projetos: remotos } = await api.get<{
      projetos: Array<{ painelId: number; versao: number; enviadoEm: number }>;
    }>('/api/sync/projetos');
    const locais = (await db.projetos.where('usuarioId').equals(usuarioId).toArray()).filter(
      (p) => p.painelId !== undefined,
    );
    const excluidos = new Set(lerExclusoes(usuarioId));

    for (const projeto of locais) {
      await sincronizarProjeto(
        usuarioId,
        projeto,
        remotos.find((r) => r.painelId === projeto.painelId),
      );
    }
    // Aparelho novo, ou projeto começado em outro aparelho: vem do servidor.
    for (const remoto of remotos) {
      if (excluidos.has(remoto.painelId) || locais.some((p) => p.painelId === remoto.painelId)) continue;
      try {
        const r = await api.get<{ versao: number; documento: DocumentoProjeto }>(
          `/api/sync/projetos/${remoto.painelId}`,
        );
        await aplicarDocumento(usuarioId, remoto.painelId, r.versao, r.documento);
      } catch (erro) {
        if (ehFaltaDeConexao(erro)) throw erro;
        // Sem acesso a esse painel agora: o projeto fica no servidor.
      }
    }
    mudar({ fase: 'ocioso', ultimaEm: Date.now() });
  } catch (erro) {
    if (ehFaltaDeConexao(erro)) mudar({ fase: 'sem-rede' });
    else mudar({ fase: 'erro', erro: mensagem(erro) });
  } finally {
    rodando = false;
    if (repetir) {
      repetir = false;
      void sincronizarAgora(usuarioId);
    }
  }
}
