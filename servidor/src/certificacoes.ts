import { calcularProgresso, idsPendentes, type MapaRespostas } from '../../compartilhado/progresso';
import { registrar } from './auditoria';
import { avisar } from './avisos';
import { banco, emTransacao, type Usuario } from './banco';
import { PREFIXO_CERTIFICADO } from './configuracao';
import { devolucaoSchema, envioCertificacaoSchema, primeiroErro } from './esquemas';
import { obterDefinicao, painelDoFormulario } from './formularios';
import { moverParaLixeira, uidValido } from './midias';
import {
  ErroHttp,
  emailsDosAdmins,
  exigirAcessoAoPainel,
  exigirAdmin,
  exigirSessao,
  type Contexto,
} from './rotas';

/**
 * Solicitações de certificação (checklists marcados com "Emite certificado").
 *
 * O montador prepara a solicitação no aparelho, offline, e envia o conjunto —
 * dados, respostas e a lista das fotos — ao pedir a validação. Dali em diante o
 * servidor é quem decide: devolver, aprovar (com o número do certificado) e
 * registrar a emissão. O número sai de um contador gravado na mesma transação
 * do certificado, único para todo o sistema, e não se reaproveita.
 */

type Manipulador = (ctx: Contexto) => unknown;

type Estado = 'rascunho' | 'enviada' | 'devolvida' | 'aprovada' | 'emitida';

interface Evento {
  estado: Estado;
  em: number;
  por: string;
  observacao?: string;
}

interface Linha {
  id: number;
  uid: string;
  usuarioId: number;
  painelId: number;
  formId: string;
  estado: Estado;
  dados: string;
  preenchimento: string;
  midias: string;
  apontamentos: string | null;
  historico: string;
  numero: string | null;
  aprovadoEm: number | null;
  aprovadoPor: string | null;
  versao: number;
  criadoEm: number;
  atualizadoEm: number;
}

interface MidiaCitada {
  uid: string;
  etapaId: string;
  mime: string;
}

const NUMERO_DIGITOS = 4;
const CONTADOR = 'certificado';
const EDITAVEIS: Estado[] = ['rascunho', 'devolvida'];

function formatarNumero(sequencial: number): string {
  return `${PREFIXO_CERTIFICADO}${String(sequencial).padStart(NUMERO_DIGITOS, '0')}`;
}

function uidDaUrl(ctx: Contexto): string {
  const uid = ctx.params.uid.toLowerCase();
  if (!uidValido(uid)) throw new ErroHttp(400, 'Identificador de solicitação inválido.');
  return uid;
}

function linhaDoMontador(eu: Usuario, uid: string): Linha | undefined {
  return banco
    .prepare('SELECT * FROM certificacoes WHERE usuarioId = ? AND uid = ?')
    .get(eu.id, uid) as Linha | undefined;
}

function nomeDoPainel(painelId: number): { slug: string; nome: string } | undefined {
  return banco.prepare('SELECT slug, nome FROM paineis WHERE id = ?').get(painelId) as
    | { slug: string; nome: string }
    | undefined;
}

function historicoDe(l: Linha): Evento[] {
  return JSON.parse(l.historico) as Evento[];
}

function snapshotDoCertificado(numero: string) {
  const c = banco.prepare('SELECT * FROM certificados WHERE numero = ?').get(numero) as
    | Record<string, unknown>
    | undefined;
  if (!c) return null;
  return {
    numero: String(c.numero),
    tipoPainel: String(c.painelSlug),
    nomePainel: String(c.nomePainel),
    projeto: String(c.projeto),
    tagPainel: String(c.tagPainel),
    clienteFinal: String(c.clienteFinal),
    montador: String(c.montador),
    correnteNominal: String(c.correnteNominal),
    correnteCurtoCircuito: String(c.correnteCurtoCircuito),
    responsavel: String(c.responsavel),
    emitidoEm: Number(c.emitidoEm),
  };
}

function descrever(l: Linha) {
  const painel = nomeDoPainel(Number(l.painelId));
  return {
    uid: l.uid,
    painelSlug: painel?.slug ?? '',
    estado: l.estado,
    versao: Number(l.versao),
    apontamentos: l.apontamentos,
    numero: l.numero,
    aprovadoEm: l.aprovadoEm === null ? null : Number(l.aprovadoEm),
    aprovadoPor: l.aprovadoPor,
    historico: historicoDe(l),
    atualizadoEm: Number(l.atualizadoEm),
    certificado: l.numero ? snapshotDoCertificado(l.numero) : null,
  };
}

/** Fotos que o documento cita e o servidor ainda não recebeu. */
function fotosFaltando(eu: Usuario, citadas: MidiaCitada[]): string[] {
  const recebidas = new Set(
    (
      banco.prepare('SELECT uid FROM sync_midias WHERE usuarioId = ?').all(eu.id) as Array<{
        uid: string;
      }>
    ).map((m) => m.uid.toLowerCase()),
  );
  return citadas.map((m) => m.uid.toLowerCase()).filter((uid) => !recebidas.has(uid));
}

function acrescentar(l: Linha, evento: Evento): string {
  return JSON.stringify([...historicoDe(l), evento]);
}

export const rotasCertificacoes: Record<string, Manipulador> = {
  // ------------------------------------------------------------ montador

  /** O estado de cada solicitação da conta: o aparelho compara e atualiza a sua cópia. */
  'GET /api/certificacoes': (ctx) => {
    const eu = exigirSessao(ctx);
    const linhas = banco
      .prepare('SELECT * FROM certificacoes WHERE usuarioId = ? ORDER BY atualizadoEm DESC')
      .all(eu.id) as unknown as Linha[];
    return { solicitacoes: linhas.map(descrever) };
  },

  /**
   * Grava a solicitação como o aparelho a tem. Só enquanto for rascunho ou
   * estiver devolvida: depois de enviada, quem a mexe é a validação.
   */
  'PUT /api/certificacoes/:uid': (ctx) => {
    const eu = exigirSessao(ctx);
    const uid = uidDaUrl(ctx);
    const r = envioCertificacaoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const e = r.data;

    const painel = nomeDoPainel(e.painelId);
    if (!painel) throw new ErroHttp(404, 'Painel não encontrado.');
    exigirAcessoAoPainel(eu, e.painelId);

    const citadas = e.midias.map((m) => m.uid.toLowerCase());
    if (new Set(citadas).size !== citadas.length) throw new ErroHttp(400, 'Mídia repetida na solicitação.');

    const atual = linhaDoMontador(eu, uid);
    if (atual && Number(atual.painelId) !== e.painelId) {
      throw new ErroHttp(400, 'A solicitação pertence a outro painel.');
    }
    // Quem emite certificado é o checklist. Uma solicitação já aberta segue
    // com o checklist dela mesmo que a marca seja tirada depois; uma nova, ou
    // a troca de checklist, exige um checklist do painel que emite certificado.
    if (!atual || atual.formId !== e.formId) {
      if (painelDoFormulario(e.formId) !== e.painelId) {
        throw new ErroHttp(400, 'O checklist não pertence a este painel.');
      }
      if (!obterDefinicao(e.formId)?.emiteCertificado) {
        throw new ErroHttp(400, 'Este checklist não emite certificado.');
      }
    }
    if (atual && !EDITAVEIS.includes(atual.estado)) {
      throw new ErroHttp(409, 'A solicitação já foi enviada e não pode mais ser alterada.', 'travada');
    }
    if ((atual?.versao ?? 0) !== e.versaoBase) {
      throw new ErroHttp(409, 'Outro aparelho desta conta enviou alterações antes.', 'versao-desatualizada');
    }

    const agora = Date.now();
    const versao = e.versaoBase + 1;
    const citadasSet = new Set(citadas);

    const sobrando = emTransacao(() => {
      if (atual) {
        banco
          .prepare(
            `UPDATE certificacoes SET formId = ?, dados = ?, preenchimento = ?, midias = ?,
                    versao = ?, atualizadoEm = ? WHERE id = ?`,
          )
          .run(
            e.formId,
            JSON.stringify(e.dados),
            JSON.stringify(e.preenchimento),
            JSON.stringify(e.midias),
            versao,
            agora,
            atual.id,
          );
      } else {
        banco
          .prepare(
            `INSERT INTO certificacoes
               (uid, usuarioId, painelId, formId, estado, dados, preenchimento, midias,
                historico, versao, criadoEm, atualizadoEm)
             VALUES (?, ?, ?, ?, 'rascunho', ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            uid,
            eu.id,
            e.painelId,
            e.formId,
            JSON.stringify(e.dados),
            JSON.stringify(e.preenchimento),
            JSON.stringify(e.midias),
            JSON.stringify([{ estado: 'rascunho', em: e.criadoEm, por: eu.nome }]),
            versao,
            e.criadoEm,
            agora,
          );
      }
      // Fotos que a solicitação não cita mais saem do servidor.
      const antes = banco
        .prepare('SELECT uid FROM sync_midias WHERE usuarioId = ? AND projetoUid = ?')
        .all(eu.id, uid) as Array<{ uid: string }>;
      const fora = antes.map((m) => m.uid.toLowerCase()).filter((m) => !citadasSet.has(m));
      const apagar = banco.prepare('DELETE FROM sync_midias WHERE uid = ?');
      for (const m of fora) apagar.run(m);
      return fora;
    });
    moverParaLixeira(sobrando);

    return { versao, faltando: fotosFaltando(eu, e.midias) };
  },

  /** Pede a validação: a solicitação trava para edição e a ABB é avisada. */
  'POST /api/certificacoes/:uid/enviar': (ctx) => {
    const eu = exigirSessao(ctx);
    const uid = uidDaUrl(ctx);
    const l = linhaDoMontador(eu, uid);
    if (!l) throw new ErroHttp(404, 'Solicitação não encontrada no servidor.');
    exigirAcessoAoPainel(eu, Number(l.painelId));
    if (!EDITAVEIS.includes(l.estado)) {
      throw new ErroHttp(409, 'Só um rascunho ou uma solicitação devolvida pode ser enviada.');
    }
    if (fotosFaltando(eu, JSON.parse(l.midias) as MidiaCitada[]).length) {
      throw new ErroHttp(409, 'Ainda faltam fotos a enviar. Tente de novo com conexão.', 'faltam-fotos');
    }

    const agora = Date.now();
    emTransacao(() => {
      banco
        .prepare(
          `UPDATE certificacoes SET estado = 'enviada', apontamentos = NULL, historico = ?, atualizadoEm = ?
            WHERE id = ?`,
        )
        .run(acrescentar(l, { estado: 'enviada', em: agora, por: eu.nome }), agora, l.id);
    });

    const dados = JSON.parse(l.dados) as Record<string, string>;
    const painel = nomeDoPainel(Number(l.painelId));
    avisar({
      assunto: `Solicitação de certificação para validar: ${painel?.nome ?? ''}`,
      texto:
        `${eu.nome} (${eu.email}) enviou a solicitação do painel ${painel?.nome ?? ''}` +
        (dados.tagPainel ? ` — TAG ${dados.tagPainel}` : '') +
        '.\n\nValide em Administração → Validação ABB.',
      emails: emailsDosAdmins(),
      rota: '#/admin?aba=validacao',
    });
    return { ok: true };
  },

  /** O montador baixou o certificado: registra a emissão. */
  'POST /api/certificacoes/:uid/emissao': (ctx) => {
    const eu = exigirSessao(ctx);
    const uid = uidDaUrl(ctx);
    const l = linhaDoMontador(eu, uid);
    if (!l) throw new ErroHttp(404, 'Solicitação não encontrada no servidor.');
    if (!l.numero) throw new ErroHttp(409, 'A solicitação ainda não foi aprovada.');
    if (l.estado === 'emitida') return { ok: true };
    const agora = Date.now();
    banco
      .prepare("UPDATE certificacoes SET estado = 'emitida', historico = ?, atualizadoEm = ? WHERE id = ?")
      .run(
        acrescentar(l, { estado: 'emitida', em: agora, por: eu.nome, observacao: `Certificado ${l.numero} gerado.` }),
        agora,
        l.id,
      );
    return { ok: true };
  },

  'DELETE /api/certificacoes/:uid': (ctx) => {
    const eu = exigirSessao(ctx);
    const uid = uidDaUrl(ctx);
    const l = linhaDoMontador(eu, uid);
    if (!l) return { ok: true };
    if (l.numero) {
      throw new ErroHttp(409, 'Uma solicitação com certificado numerado não pode ser excluída.');
    }
    const fotos = emTransacao(() => {
      const uids = (
        banco.prepare('SELECT uid FROM sync_midias WHERE usuarioId = ? AND projetoUid = ?').all(eu.id, uid) as Array<{
          uid: string;
        }>
      ).map((m) => m.uid.toLowerCase());
      banco.prepare('DELETE FROM sync_midias WHERE usuarioId = ? AND projetoUid = ?').run(eu.id, uid);
      banco.prepare('DELETE FROM certificacoes WHERE id = ?').run(l.id);
      return uids;
    });
    moverParaLixeira(fotos);
    return { ok: true };
  },

  // ------------------------------------------------------- administração

  /** Solicitações por estado (padrão: as enviadas, à espera de validação). */
  'GET /api/admin/certificacoes': (ctx) => {
    exigirAdmin(ctx);
    const estado = (ctx.consulta.get('estado') ?? 'enviada') as Estado;
    const linhas = banco
      .prepare(
        `SELECT c.*, u.nome AS usuarioNome, u.email AS usuarioEmail
           FROM certificacoes c JOIN usuarios u ON u.id = c.usuarioId
          WHERE c.estado = ? ORDER BY c.atualizadoEm ASC`,
      )
      .all(estado) as unknown as Array<Linha & { usuarioNome: string; usuarioEmail: string }>;

    return {
      itens: linhas.map((l) => {
        const definicao = obterDefinicao(l.formId);
        const preenchimento = JSON.parse(l.preenchimento) as { respostas: MapaRespostas };
        const midias = JSON.parse(l.midias) as MidiaCitada[];
        const fotos: Record<string, number> = {};
        for (const m of midias) fotos[m.etapaId] = (fotos[m.etapaId] ?? 0) + 1;
        const progresso = definicao
          ? calcularProgresso(definicao, preenchimento.respostas, fotos)
          : { total: 0, respondidas: 0, pendentes: 0, percentual: 0 };
        const painel = nomeDoPainel(Number(l.painelId));
        return {
          id: Number(l.id),
          uid: l.uid,
          estado: l.estado,
          painel: { slug: painel?.slug ?? '', nome: painel?.nome ?? '' },
          montador: { nome: l.usuarioNome, email: l.usuarioEmail },
          dados: JSON.parse(l.dados) as Record<string, string>,
          progresso,
          etapasPendentes: definicao ? idsPendentes(definicao, preenchimento.respostas, fotos) : [],
          historico: historicoDe(l),
          enviadaEm: Number(l.atualizadoEm),
          numero: l.numero,
        };
      }),
    };
  },

  /** Aprova e numera. O número sai do contador, na mesma transação do certificado. */
  'POST /api/admin/certificacoes/:id/aprovar': (ctx) => {
    const eu = exigirAdmin(ctx);
    const id = Number(ctx.params.id);
    const l = banco.prepare('SELECT * FROM certificacoes WHERE id = ?').get(id) as Linha | undefined;
    if (!l) throw new ErroHttp(404, 'Solicitação não encontrada.');
    if (l.numero) {
      throw new ErroHttp(409, `Solicitação já aprovada sob o número ${l.numero}. O número é imutável.`);
    }
    if (l.estado !== 'enviada') {
      throw new ErroHttp(409, 'Só uma solicitação enviada para validação pode ser aprovada.');
    }

    const painel = banco.prepare('SELECT slug, nome, signatario FROM paineis WHERE id = ?').get(Number(l.painelId)) as {
      slug: string;
      nome: string;
      signatario: string | null;
    };
    const dados = JSON.parse(l.dados) as Record<string, string>;
    const signatario = painel.signatario ? (JSON.parse(painel.signatario) as { nome: string }) : null;
    const agora = Date.now();

    const numero = emTransacao(() => {
      const contador = banco.prepare('SELECT proximo FROM contadores WHERE id = ?').get(CONTADOR) as
        | { proximo: number }
        | undefined;
      const sequencial = Number(contador?.proximo ?? 1);
      banco
        .prepare(
          'INSERT INTO contadores (id, proximo) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET proximo = excluded.proximo',
        )
        .run(CONTADOR, sequencial + 1);
      const numeroNovo = formatarNumero(sequencial);

      banco
        .prepare(
          `INSERT INTO certificados
             (numero, certificacaoId, painelSlug, nomePainel, projeto, tagPainel, clienteFinal, montador,
              correnteNominal, correnteCurtoCircuito, responsavel, emitidoEm)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          numeroNovo,
          l.id,
          painel.slug,
          painel.nome,
          dados.projeto ?? '',
          dados.tagPainel ?? '',
          dados.clienteFinal ?? '',
          dados.montador ?? '',
          dados.correnteNominal ?? '',
          dados.correnteCurtoCircuito ?? '',
          signatario?.nome ?? eu.nome,
          agora,
        );
      banco
        .prepare(
          `UPDATE certificacoes SET estado = 'aprovada', numero = ?, aprovadoEm = ?, aprovadoPor = ?,
                  apontamentos = NULL, historico = ?, atualizadoEm = ? WHERE id = ?`,
        )
        .run(
          numeroNovo,
          agora,
          signatario?.nome ?? eu.nome,
          acrescentar(l, {
            estado: 'aprovada',
            em: agora,
            por: signatario?.nome ?? eu.nome,
            observacao: `Certificado ${numeroNovo}`,
          }),
          agora,
          l.id,
        );
      registrar({
        autor: eu,
        acao: 'aprovou a solicitação e numerou o certificado',
        alvoTipo: 'certificado',
        alvoId: l.id,
        alvo: numeroNovo,
        detalhe: `${painel.nome}${dados.tagPainel ? ` — TAG ${dados.tagPainel}` : ''}`,
      });
      return numeroNovo;
    });

    const dono = banco.prepare('SELECT email FROM usuarios WHERE id = ?').get(Number(l.usuarioId)) as
      | { email: string }
      | undefined;
    if (dono) {
      avisar({
        assunto: `Solicitação aprovada: certificado ${numero}`,
        texto: `A sua solicitação do painel ${painel.nome}${dados.tagPainel ? ` (TAG ${dados.tagPainel})` : ''} foi aprovada. Certificado nº ${numero}. Abra a solicitação para gerar o PDF.`,
        emails: [dono.email],
        rota: '#/paineis',
      });
    }
    return { numero };
  },

  'POST /api/admin/certificacoes/:id/devolver': (ctx) => {
    const eu = exigirAdmin(ctx);
    const r = devolucaoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const id = Number(ctx.params.id);
    const l = banco.prepare('SELECT * FROM certificacoes WHERE id = ?').get(id) as Linha | undefined;
    if (!l) throw new ErroHttp(404, 'Solicitação não encontrada.');
    if (l.estado !== 'enviada') throw new ErroHttp(409, 'Só uma solicitação enviada pode ser devolvida.');

    const agora = Date.now();
    const dados = JSON.parse(l.dados) as Record<string, string>;
    emTransacao(() => {
      banco
        .prepare(
          `UPDATE certificacoes SET estado = 'devolvida', apontamentos = ?, historico = ?, atualizadoEm = ?
            WHERE id = ?`,
        )
        .run(
          r.data.apontamentos,
          acrescentar(l, { estado: 'devolvida', em: agora, por: eu.nome, observacao: r.data.apontamentos }),
          agora,
          l.id,
        );
      registrar({
        autor: eu,
        acao: 'devolveu a solicitação de certificado',
        alvoTipo: 'certificado',
        alvoId: l.id,
        alvo: dados.tagPainel || `solicitação #${l.id}`,
        detalhe: nomeDoPainel(Number(l.painelId))?.nome,
      });
    });

    const dono = banco.prepare('SELECT email FROM usuarios WHERE id = ?').get(Number(l.usuarioId)) as
      | { email: string }
      | undefined;
    if (dono) {
      avisar({
        assunto: 'Solicitação devolvida com apontamentos',
        texto: `A sua solicitação${dados.tagPainel ? ` (TAG ${dados.tagPainel})` : ''} voltou com apontamentos:\n\n${r.data.apontamentos}`,
        emails: [dono.email],
        rota: '#/paineis',
      });
    }
    return { ok: true };
  },

  /** Registro das emissões: todos os certificados numerados. */
  'GET /api/admin/certificados': (ctx) => {
    exigirAdmin(ctx);
    const linhas = banco.prepare('SELECT * FROM certificados ORDER BY emitidoEm DESC LIMIT 500').all() as Array<
      Record<string, unknown>
    >;
    return {
      certificados: linhas.map((c) => ({
        numero: String(c.numero),
        tipoPainel: String(c.painelSlug),
        nomePainel: String(c.nomePainel),
        projeto: String(c.projeto),
        tagPainel: String(c.tagPainel),
        clienteFinal: String(c.clienteFinal),
        montador: String(c.montador),
        correnteNominal: String(c.correnteNominal),
        correnteCurtoCircuito: String(c.correnteCurtoCircuito),
        responsavel: String(c.responsavel),
        emitidoEm: Number(c.emitidoEm),
      })),
    };
  },
};
