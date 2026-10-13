import { api, ErroApi, type PainelApi } from '../api/cliente';
import { db } from '../db/db';
import { MidiaRepository, PreenchimentoRepository } from '../db/repositorios';
import type { Certificado, EstadoSolicitacao, EventoSolicitacao, Solicitacao } from '../db/tipos';
import { guardarCatalogoPaineis, lerCatalogoPaineis } from '../api/acessoLocal';

/**
 * Sincronização das solicitações de certificação com o servidor.
 *
 * O montador prepara a solicitação no aparelho, offline. Ao pedir a validação,
 * ela sobe inteira — dados, respostas e fotos — e, dali em diante, o servidor
 * é quem decide: devolve, aprova e atribui o número do certificado, que é único
 * para todo o sistema. O aparelho só reflete o que o servidor respondeu.
 */

interface RespostaServidor {
  uid: string;
  painelSlug: string;
  estado: EstadoSolicitacao;
  versao: number;
  apontamentos: string | null;
  numero: string | null;
  aprovadoEm: number | null;
  aprovadoPor: string | null;
  historico: EventoSolicitacao[];
  atualizadoEm: number;
  certificado: Omit<Certificado, 'id' | 'solicitacaoId'> | null;
}

/** Ordem em que a solicitação avança: o servidor nunca volta um estado. */
const ORDEM: Record<EstadoSolicitacao, number> = {
  rascunho: 0,
  enviada: 1,
  devolvida: 2,
  aprovada: 3,
  emitida: 4,
};

async function idDoPainel(slug: string): Promise<number> {
  const guardado = lerCatalogoPaineis()[slug];
  if (guardado?.id !== undefined) return guardado.id;
  const { paineis } = await api.get<{ paineis: PainelApi[] }>('/api/paineis');
  guardarCatalogoPaineis(paineis);
  const painel = paineis.find((p) => p.slug === slug);
  if (!painel) throw new Error('Painel não encontrado no servidor.');
  return painel.id;
}

/** Sobe a solicitação (e as fotos que o servidor ainda não tem). */
export async function enviarSolicitacaoAoServidor(solicitacao: Solicitacao, tentativa = 1): Promise<void> {
  const id = solicitacao.id!;
  const uid = solicitacao.uid!;
  const preenchimento = await PreenchimentoRepository.obterPorSolicitacao(id);
  if (!preenchimento) throw new Error('A solicitação ainda não tem checklist preenchido.');
  const midias = await MidiaRepository.listarPorPreenchimento(preenchimento.id!);
  const painelId = await idDoPainel(solicitacao.tipoPainel);

  let resposta: { versao: number; faltando: string[] };
  try {
    resposta = await api.put(`/api/certificacoes/${uid}`, {
      versaoBase: solicitacao.versaoServidor ?? 0,
      painelId,
      formId: solicitacao.formId,
      criadoEm: solicitacao.criadoEm,
      dados: solicitacao.dados,
      preenchimento: {
        formRevisao: preenchimento.formRevisao,
        cabecalho: preenchimento.cabecalho,
        respostas: preenchimento.respostas,
      },
      midias: midias.map((m) => ({
        uid: m.uid!,
        etapaId: m.etapaId,
        mime: m.mime,
        largura: m.largura,
        altura: m.altura,
        tamanho: m.tamanho,
        nomeOriginal: m.nomeOriginal,
        criadoEm: m.criadoEm,
        ordem: m.ordem,
      })),
    });
  } catch (erro) {
    // Outro aparelho da mesma conta mexeu antes: adota a versão do servidor e tenta de novo.
    if (erro instanceof ErroApi && erro.codigo === 'versao-desatualizada' && tentativa === 1) {
      const { solicitacoes } = await api.get<{ solicitacoes: RespostaServidor[] }>('/api/certificacoes');
      const remota = solicitacoes.find((s) => s.uid === uid);
      if (remota) {
        await db.solicitacoes.update(id, { versaoServidor: remota.versao });
        return enviarSolicitacaoAoServidor({ ...solicitacao, versaoServidor: remota.versao }, 2);
      }
    }
    throw erro;
  }

  await db.solicitacoes.update(id, { versaoServidor: resposta.versao });
  const porUid = new Map(midias.map((m) => [m.uid!.toLowerCase(), m]));
  for (const faltando of resposta.faltando) {
    const midia = porUid.get(faltando.toLowerCase());
    if (midia) {
      await api.enviarArquivo(`/api/sync/midias/${midia.uid}?projeto=${uid}`, midia.blob);
    }
  }
}

/** Pede a validação ao servidor. Exige conexão: o estado `enviada` é dele. */
export async function pedirValidacaoNoServidor(solicitacao: Solicitacao): Promise<void> {
  await enviarSolicitacaoAoServidor(solicitacao);
  await api.post(`/api/certificacoes/${solicitacao.uid}/enviar`);
}

/** Registra no servidor que o certificado foi gerado. */
export async function registrarEmissaoNoServidor(solicitacao: Solicitacao): Promise<void> {
  await api.post(`/api/certificacoes/${solicitacao.uid}/emissao`);
}

/**
 * Traz do servidor o que mudou nas solicitações desta conta — devolvida,
 * aprovada com número, emitida — e atualiza a cópia do aparelho. Sem conexão
 * não faz nada: a próxima abertura tenta de novo.
 */
export async function atualizarSolicitacoesDoServidor(usuarioId: number): Promise<number> {
  let remotas: RespostaServidor[];
  try {
    remotas = (await api.get<{ solicitacoes: RespostaServidor[] }>('/api/certificacoes')).solicitacoes;
  } catch {
    return 0;
  }
  if (!remotas.length) return 0;

  let mudou = 0;
  for (const remota of remotas) {
    const local = (await db.solicitacoes.where('uid').equals(remota.uid).first()) as Solicitacao | undefined;
    if (!local || (local.usuarioId !== undefined && local.usuarioId !== usuarioId)) continue;
    const avancou = ORDEM[remota.estado] > ORDEM[local.estado];
    // `devolvida` volta ao montador mesmo depois de ele ter reaberto o rascunho? Não:
    // só vale se a cópia local ainda estiver `enviada`.
    const devolucaoValida = remota.estado === 'devolvida' ? local.estado === 'enviada' : avancou;
    if (!devolucaoValida) continue;

    await db.transaction('rw', db.solicitacoes, db.certificados, async () => {
      await db.solicitacoes.update(local.id!, {
        estado: remota.estado,
        apontamentos: remota.apontamentos ?? undefined,
        numeroCertificado: remota.numero ?? undefined,
        aprovadoEm: remota.aprovadoEm ?? undefined,
        aprovadoPor: remota.aprovadoPor ?? undefined,
        historico: remota.historico,
        versaoServidor: remota.versao,
        atualizadoEm: remota.atualizadoEm,
      });
      if (remota.certificado) {
        const existente = await db.certificados.where('numero').equals(remota.certificado.numero).first();
        if (!existente) {
          await db.certificados.add({ ...remota.certificado, solicitacaoId: local.id! });
        }
      }
    });
    mudou += 1;
  }
  return mudou;
}

/**
 * Exclui a solicitação aqui e no servidor. Uma já enviada exige conexão: se o
 * servidor não for avisado, a cópia dele continuaria à espera de validação.
 */
export async function excluirSolicitacaoEmTodaParte(solicitacao: Solicitacao): Promise<void> {
  const foiAoServidor = solicitacao.estado !== 'rascunho' || (solicitacao.versaoServidor ?? 0) > 0;
  if (foiAoServidor && solicitacao.uid) {
    try {
      await api.delete(`/api/certificacoes/${solicitacao.uid}`);
    } catch (erro) {
      if (erro instanceof ErroApi && erro.status === 0) {
        throw new Error('Sem conexão: uma solicitação já enviada só pode ser excluída com o servidor.');
      }
      throw erro;
    }
  }
  const { localSolicitacaoStore } = await import('./localSolicitacaoStore');
  await localSolicitacaoStore.excluir(solicitacao.id!);
}
