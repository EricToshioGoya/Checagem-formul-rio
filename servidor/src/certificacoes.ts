import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { codigoDe } from '../../compartilhado/formulario';
import { calcularProgresso, contarMidias, idsPendentes, type MapaRespostas } from '../../compartilhado/progresso';
import { registrar } from './auditoria';
import { avisar } from './avisos';
import { agendarBackupContinuo } from './backup';
import { banco, emTransacao, type Usuario } from './banco';
import { PREFIXO_CERTIFICADO } from './configuracao';
import { caminhoDocumento, conferirHashRecebido, paraBusca } from './documentos';
import {
  devolucaoSchema,
  envioCertificacaoSchema,
  ID_CABECALHO,
  primeiroErro,
  type ItemNaoConforme,
} from './esquemas';
import { obterDefinicao, painelDoFormulario } from './formularios';
import { caminhoMidia, gravarMidia, hashDoArquivo, moverParaLixeira, uidValido } from './midias';
import {
  ErroHttp,
  RespostaArquivo,
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
 *
 * Devolver marca as etapas não conformes, cada uma com o motivo. Aprovar exige
 * o arquivo do certificado, anexado pela administração: é ele que o montador
 * baixa. O certificado, o registro da emissão e as fotos citadas ficam
 * guardados mesmo que a conta do montador seja excluída.
 */

type Manipulador = (ctx: Contexto) => unknown;

type Estado = 'rascunho' | 'enviada' | 'devolvida' | 'aprovada' | 'emitida';

/** Etapa não conforme numa devolução, como fica gravada. */
interface ItemDevolucao {
  tagUid: null;
  tagNome: string;
  formId: string;
  formNome: string;
  etapaId: string;
  etapaCodigo: string;
  etapaDescricao: string;
  motivo: string;
}

interface Evento {
  estado: Estado;
  em: number;
  por: string;
  observacao?: string;
  /** Na devolução: as etapas marcadas, para o histórico continuar legível. */
  itens?: ItemDevolucao[];
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
  itens: string;
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
  ordem?: number;
}

/** O certificado anexado: PDF ou imagem, conferido pelo conteúdo e não só pelo nome. */
const ASSINATURAS: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};
const EXTENSOES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** 25 MB: um certificado digitalizado em boa resolução cabe com folga. */
export const TAMANHO_MAXIMO_CERTIFICADO = 25 * 1024 * 1024;

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

interface LinhaAnexo {
  uid: string;
  nomeArquivo: string;
  mime: string;
  tamanho: number;
  sha256: string;
  anexadoEm: number;
  anexadoPorNome: string;
}

function anexosDe(certificacaoId: number) {
  return (
    banco
      .prepare(
        `SELECT uid, nomeArquivo, mime, tamanho, sha256, anexadoEm, anexadoPorNome FROM certificados_anexos
          WHERE certificacaoId = ? ORDER BY anexadoEm DESC, uid`,
      )
      .all(certificacaoId) as unknown as LinhaAnexo[]
  ).map((a) => ({
    uid: a.uid,
    nomeArquivo: a.nomeArquivo,
    mime: a.mime,
    tamanho: Number(a.tamanho),
    anexadoEm: Number(a.anexadoEm),
    anexadoPor: a.anexadoPorNome,
  }));
}

function descrever(l: Linha) {
  const painel = nomeDoPainel(Number(l.painelId));
  return {
    uid: l.uid,
    painelSlug: painel?.slug ?? '',
    estado: l.estado,
    versao: Number(l.versao),
    apontamentos: l.apontamentos,
    itens: JSON.parse(l.itens ?? '[]') as ItemDevolucao[],
    anexos: anexosDe(Number(l.id)),
    numero: l.numero,
    aprovadoEm: l.aprovadoEm === null ? null : Number(l.aprovadoEm),
    aprovadoPor: l.aprovadoPor,
    historico: historicoDe(l),
    atualizadoEm: Number(l.atualizadoEm),
    certificado: l.numero ? snapshotDoCertificado(l.numero) : null,
  };
}

/**
 * A administração decide sobre o que viu: se o montador reenviou outra versão
 * enquanto a análise estava aberta, a decisão é recusada.
 */
function conferirVersaoAnalisada(l: Linha, vista: number | undefined | null): void {
  if (vista === undefined || vista === null) return;
  if (Number(l.versao) !== vista) {
    throw new ErroHttp(
      409,
      'O montador enviou uma versão nova enquanto a análise estava aberta. Abra a solicitação de novo.',
      'versao-mudou',
    );
  }
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

/** Valida as etapas marcadas na devolução e completa código e texto de cada uma. */
function completarItens(l: Linha, itens: ItemNaoConforme[]): ItemDevolucao[] {
  const definicao = obterDefinicao(l.formId);
  const dados = JSON.parse(l.dados) as Record<string, string>;
  const vistos = new Set<string>();
  return itens.map((item) => {
    if (item.formId !== l.formId) throw new ErroHttp(400, 'Item ligado a um checklist que não é o da solicitação.');
    if (vistos.has(item.etapaId)) throw new ErroHttp(400, 'A mesma etapa foi marcada duas vezes.');
    vistos.add(item.etapaId);
    let codigo = 'Dados da solicitação';
    let descricao = 'Dados da empresa, do projeto e do painel';
    if (item.etapaId !== ID_CABECALHO) {
      const etapa = definicao?.secoes.flatMap((s) => s.etapas).find((e) => e.id === item.etapaId);
      if (definicao && !etapa) throw new ErroHttp(400, `A etapa ${item.etapaId} não existe no checklist.`);
      codigo = etapa ? codigoDe(etapa) : item.etapaId;
      descricao = etapa?.descricao ?? '';
    }
    return {
      tagUid: null,
      tagNome: dados.tagPainel ?? '',
      formId: l.formId,
      formNome: definicao?.nome ?? l.formId,
      etapaId: item.etapaId,
      etapaCodigo: codigo,
      etapaDescricao: descricao,
      motivo: item.motivo,
    };
  });
}

/** Lê e confere o arquivo do certificado enviado no corpo da requisição. */
function lerCertificado(ctx: Contexto): { dados: Buffer; mime: string; nomeArquivo: string; sha256: string } {
  const dados = ctx.corpoBruto;
  if (!dados?.length) throw new ErroHttp(400, 'Selecione o arquivo do certificado.');
  const mime = (ctx.tipoConteudo ?? '').split(';')[0].trim().toLowerCase();
  const confere = ASSINATURAS[mime];
  if (!confere) throw new ErroHttp(400, 'O certificado deve ser um PDF, JPEG ou PNG.');
  if (!confere(dados)) throw new ErroHttp(400, 'O conteúdo do arquivo não corresponde ao tipo informado.');
  if (dados.length > TAMANHO_MAXIMO_CERTIFICADO) throw new ErroHttp(413, 'Arquivo grande demais (máximo 25 MB).');
  const sha256 = conferirHashRecebido(ctx.consulta.get('sha256'), dados);
  const nomeArquivo =
    (ctx.consulta.get('nomeArquivo') ?? '')
      .replace(/[\u0000-\u001f\u007f/\\]/g, '-')
      .trim()
      .slice(0, 200) || `certificado.${EXTENSOES[mime]}`;
  return { dados, mime, nomeArquivo, sha256 };
}

/**
 * Grava o anexo. O arquivo vai para o disco (com fsync) antes da transação;
 * se a transação falhar, sobra um arquivo sem registro, que a faxina recolhe.
 */
function inserirAnexo(
  l: Linha,
  numero: string,
  arquivo: ReturnType<typeof lerCertificado>,
  uid: string,
  eu: Usuario,
  agora: number,
): void {
  const dados = JSON.parse(l.dados) as Record<string, string>;
  const painel = nomeDoPainel(Number(l.painelId));
  const montador = banco.prepare('SELECT nome FROM usuarios WHERE id = ?').get(Number(l.usuarioId)) as
    | { nome: string }
    | undefined;
  const montadorNome = dados.montador || montador?.nome || '';
  banco
    .prepare(
      `INSERT INTO certificados_anexos
         (uid, certificacaoId, certificacaoUid, numero, painelId, painelNome, projeto, tagPainel, clienteFinal,
          empresa, montadorId, montadorNome, nomeArquivo, mime, tamanho, sha256, anexadoPor, anexadoPorNome,
          anexadoEm, busca)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uid,
      l.id,
      l.uid,
      numero,
      l.painelId,
      painel?.nome ?? '',
      dados.projeto ?? '',
      dados.tagPainel ?? '',
      dados.clienteFinal ?? '',
      dados.empresa ?? '',
      l.usuarioId,
      montadorNome,
      arquivo.nomeArquivo,
      arquivo.mime,
      arquivo.dados.length,
      arquivo.sha256,
      eu.id,
      eu.nome,
      agora,
      paraBusca(
        [numero, painel?.nome, dados.projeto, dados.tagPainel, dados.clienteFinal, dados.empresa, montadorNome, montador?.nome, arquivo.nomeArquivo]
          .filter(Boolean)
          .join(' '),
      ),
    );
}

/**
 * As fotos citadas na solicitação aprovada passam a ser protegidas: não vão
 * para a lixeira nem saem do backup, mesmo com a conta excluída.
 */
function protegerFotos(l: Linha): void {
  const inserir = banco.prepare(
    `INSERT OR IGNORE INTO midias_protegidas
       (origem, origemId, uid, mime, tagUid, formId, etapaId, ordem, situacao, sha256, tamanho)
     VALUES ('certificacao', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  );
  for (const m of JSON.parse(l.midias) as MidiaCitada[]) {
    const uid = m.uid.toLowerCase();
    if (!uidValido(uid)) continue;
    const caminho = caminhoMidia(uid);
    const presente = existsSync(caminho);
    inserir.run(
      l.id,
      uid,
      m.mime,
      l.formId,
      m.etapaId,
      m.ordem ?? 0,
      presente ? 'recebida' : 'ausente',
      presente ? hashDoArquivo(caminho) : null,
      presente ? statSync(caminho).size : null,
    );
  }
}

/**
 * Certificações aprovadas antes da guarda permanente: protege as fotos e grava
 * o retrato do que foi aprovado, para que excluir a conta ou o painel não leve
 * nada. Idempotente; roda na subida do servidor.
 */
export function protegerCertificacoesAprovadas(): void {
  const linhas = banco.prepare('SELECT * FROM certificacoes WHERE numero IS NOT NULL').all() as unknown as Linha[];
  const protegida = banco.prepare(
    "SELECT 1 FROM midias_protegidas WHERE origem = 'certificacao' AND origemId = ? LIMIT 1",
  );
  const gravarRetrato = banco.prepare('UPDATE certificados SET retrato = ? WHERE numero = ? AND retrato IS NULL');
  emTransacao(() => {
    for (const l of linhas) {
      if (!protegida.get(l.id)) protegerFotos(l);
      gravarRetrato.run(
        JSON.stringify({
          formId: l.formId,
          dados: JSON.parse(l.dados) as unknown,
          preenchimento: JSON.parse(l.preenchimento) as unknown,
          midias: JSON.parse(l.midias) as unknown,
        }),
        l.numero,
      );
    }
  });
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
          `UPDATE certificacoes SET estado = 'enviada', apontamentos = NULL, itens = '[]', historico = ?,
                  atualizadoEm = ?
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
        '.\n\nAnalise em Administração → Certificados → Solicitações antigas.',
      emails: emailsDosAdmins(),
      rota: '#/admin?aba=certificados&secao=antigas',
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
        acrescentar(l, { estado: 'emitida', em: agora, por: eu.nome, observacao: `Certificado ${l.numero} baixado.` }),
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
        const fotos = contarMidias(midias);
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

  /** A solicitação inteira para a tela de análise: dados, respostas, fotos e o checklist. */
  'GET /api/admin/certificacoes/:id': (ctx) => {
    exigirAdmin(ctx);
    const l = banco.prepare('SELECT * FROM certificacoes WHERE id = ?').get(Number(ctx.params.id)) as
      | Linha
      | undefined;
    if (!l) throw new ErroHttp(404, 'Solicitação não encontrada.');
    const montador = banco.prepare('SELECT nome, email FROM usuarios WHERE id = ?').get(Number(l.usuarioId)) as
      | { nome: string; email: string }
      | undefined;
    const painel = nomeDoPainel(Number(l.painelId));
    const midias = (JSON.parse(l.midias) as MidiaCitada[]).map((m) => ({
      ...m,
      uid: m.uid.toLowerCase(),
      recebida: existsSync(caminhoMidia(m.uid.toLowerCase())),
    }));
    return {
      solicitacao: {
        ...descrever(l),
        id: Number(l.id),
        formId: l.formId,
        painel: { slug: painel?.slug ?? '', nome: painel?.nome ?? '' },
        montador: { nome: montador?.nome ?? '[conta excluída]', email: montador?.email ?? '' },
        dados: JSON.parse(l.dados) as Record<string, string>,
        preenchimento: JSON.parse(l.preenchimento) as unknown,
        midias,
      },
      definicao: obterDefinicao(l.formId),
    };
  },

  /**
   * Aprova, numera e anexa o certificado. O corpo é o arquivo do certificado
   * (PDF, JPEG ou PNG); o nome e o SHA-256 vão na consulta. O número sai do
   * contador, na mesma transação do registro e do anexo.
   */
  'PUT /api/admin/certificacoes/:id/aprovacao': (ctx) => {
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
    const versaoVista = ctx.consulta.get('versao');
    conferirVersaoAnalisada(l, versaoVista ? Number(versaoVista) : undefined);
    const arquivo = lerCertificado(ctx);

    const painel = banco.prepare('SELECT slug, nome, signatario FROM paineis WHERE id = ?').get(Number(l.painelId)) as {
      slug: string;
      nome: string;
      signatario: string | null;
    };
    const dados = JSON.parse(l.dados) as Record<string, string>;
    const signatario = painel.signatario ? (JSON.parse(painel.signatario) as { nome: string }) : null;
    const agora = Date.now();
    const anexoUid = randomUUID();
    gravarMidia(anexoUid, arquivo.dados);

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
              correnteNominal, correnteCurtoCircuito, responsavel, emitidoEm, retrato)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          // O retrato do que foi aprovado: sobrevive à exclusão da solicitação.
          JSON.stringify({
            formId: l.formId,
            dados,
            preenchimento: JSON.parse(l.preenchimento) as unknown,
            midias: JSON.parse(l.midias) as unknown,
          }),
        );
      banco
        .prepare(
          `UPDATE certificacoes SET estado = 'aprovada', numero = ?, aprovadoEm = ?, aprovadoPor = ?,
                  apontamentos = NULL, itens = '[]', historico = ?, atualizadoEm = ? WHERE id = ?`,
        )
        .run(
          numeroNovo,
          agora,
          signatario?.nome ?? eu.nome,
          acrescentar(l, {
            estado: 'aprovada',
            em: agora,
            por: signatario?.nome ?? eu.nome,
            observacao: `Certificado ${numeroNovo} — arquivo "${arquivo.nomeArquivo}" anexado por ${eu.nome}.`,
          }),
          agora,
          l.id,
        );
      inserirAnexo(l, numeroNovo, arquivo, anexoUid, eu, agora);
      protegerFotos(l);
      registrar({
        autor: eu,
        acao: 'aprovou a solicitação e anexou o certificado',
        alvoTipo: 'certificado',
        alvoId: l.id,
        alvo: numeroNovo,
        detalhe: `${painel.nome}${dados.tagPainel ? ` — TAG ${dados.tagPainel}` : ''}`,
      });
      return numeroNovo;
    });
    agendarBackupContinuo();

    const dono = banco.prepare('SELECT email FROM usuarios WHERE id = ?').get(Number(l.usuarioId)) as
      | { email: string }
      | undefined;
    if (dono) {
      avisar({
        assunto: `Certificado ${numero} disponível`,
        texto:
          `A sua solicitação do painel ${painel.nome}${dados.tagPainel ? ` (TAG ${dados.tagPainel})` : ''} foi aprovada. ` +
          `Certificado nº ${numero}. Baixe o certificado na tela inicial do aplicativo.`,
        emails: [dono.email],
        rota: '#/paineis',
      });
    }
    return { numero, anexo: anexosDe(Number(l.id))[0] };
  },

  /**
   * Anexa mais um arquivo de certificado a uma solicitação já aprovada (por
   * exemplo, uma via assinada). Os anteriores continuam guardados.
   */
  'PUT /api/admin/certificacoes/:id/certificado': (ctx) => {
    const eu = exigirAdmin(ctx);
    const id = Number(ctx.params.id);
    const l = banco.prepare('SELECT * FROM certificacoes WHERE id = ?').get(id) as Linha | undefined;
    if (!l) throw new ErroHttp(404, 'Solicitação não encontrada.');
    if (!l.numero || (l.estado !== 'aprovada' && l.estado !== 'emitida')) {
      throw new ErroHttp(409, 'Só uma solicitação aprovada recebe o arquivo do certificado.');
    }
    const arquivo = lerCertificado(ctx);
    const agora = Date.now();
    const anexoUid = randomUUID();
    gravarMidia(anexoUid, arquivo.dados);
    emTransacao(() => {
      inserirAnexo(l, l.numero!, arquivo, anexoUid, eu, agora);
      banco
        .prepare('UPDATE certificacoes SET historico = ?, atualizadoEm = ? WHERE id = ?')
        .run(
          acrescentar(l, {
            estado: l.estado,
            em: agora,
            por: eu.nome,
            observacao: `Arquivo de certificado "${arquivo.nomeArquivo}" anexado.`,
          }),
          agora,
          l.id,
        );
      registrar({
        autor: eu,
        acao: 'anexou um arquivo de certificado',
        alvoTipo: 'certificado',
        alvoId: l.id,
        alvo: l.numero!,
        detalhe: arquivo.nomeArquivo,
      });
    });
    agendarBackupContinuo();

    const dono = banco.prepare('SELECT email FROM usuarios WHERE id = ?').get(Number(l.usuarioId)) as
      | { email: string }
      | undefined;
    if (dono) {
      avisar({
        assunto: `Novo arquivo do certificado ${l.numero}`,
        texto: `Um novo arquivo foi anexado ao certificado nº ${l.numero}. Baixe-o na tela inicial do aplicativo.`,
        emails: [dono.email],
        rota: '#/paineis',
      });
    }
    return { anexo: anexosDe(Number(l.id))[0] };
  },

  /** Devolve marcando as etapas não conformes (e/ou com um comentário geral). */
  'POST /api/admin/certificacoes/:id/devolver': (ctx) => {
    const eu = exigirAdmin(ctx);
    const r = devolucaoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const id = Number(ctx.params.id);
    const l = banco.prepare('SELECT * FROM certificacoes WHERE id = ?').get(id) as Linha | undefined;
    if (!l) throw new ErroHttp(404, 'Solicitação não encontrada.');
    if (l.estado !== 'enviada') throw new ErroHttp(409, 'Só uma solicitação enviada pode ser devolvida.');
    conferirVersaoAnalisada(l, r.data.versao);

    const itens = completarItens(l, r.data.itens);
    const comentario = r.data.apontamentos;
    const resumoTexto = [
      ...itens.map((i) => `${i.etapaCodigo}: ${i.motivo}`),
      ...(comentario ? [comentario] : []),
    ].join('\n');
    const agora = Date.now();
    const dados = JSON.parse(l.dados) as Record<string, string>;
    emTransacao(() => {
      banco
        .prepare(
          `UPDATE certificacoes SET estado = 'devolvida', apontamentos = ?, itens = ?, historico = ?,
                  atualizadoEm = ?
            WHERE id = ?`,
        )
        .run(
          comentario || null,
          JSON.stringify(itens),
          acrescentar(l, { estado: 'devolvida', em: agora, por: eu.nome, observacao: resumoTexto, itens }),
          agora,
          l.id,
        );
      registrar({
        autor: eu,
        acao: 'devolveu a solicitação de certificado',
        alvoTipo: 'certificado',
        alvoId: l.id,
        alvo: dados.tagPainel || `solicitação #${l.id}`,
        detalhe: `${nomeDoPainel(Number(l.painelId))?.nome ?? ''}${itens.length ? `; ${itens.length} etapa(s) não conforme(s)` : ''}`,
      });
    });

    const dono = banco.prepare('SELECT email FROM usuarios WHERE id = ?').get(Number(l.usuarioId)) as
      | { email: string }
      | undefined;
    if (dono) {
      avisar({
        assunto: 'Solicitação devolvida para correção',
        texto: `A sua solicitação${dados.tagPainel ? ` (TAG ${dados.tagPainel})` : ''} voltou para correção:\n\n${resumoTexto}`,
        emails: [dono.email],
        rota: '#/paineis',
      });
    }
    return { ok: true };
  },

  /** O montador baixa o certificado anexado à sua solicitação. */
  'GET /api/certificacoes/:uid/certificados/:anexo': (ctx) => {
    const eu = exigirSessao(ctx);
    const l = linhaDoMontador(eu, uidDaUrl(ctx));
    if (!l) throw new ErroHttp(404, 'Solicitação não encontrada no servidor.');
    const anexoUid = ctx.params.anexo.toLowerCase();
    const anexo = banco
      .prepare('SELECT mime, sha256, tamanho FROM certificados_anexos WHERE uid = ? AND certificacaoId = ?')
      .get(anexoUid, l.id) as { mime: string; sha256: string; tamanho: number } | undefined;
    if (!anexo) throw new ErroHttp(404, 'Certificado não encontrado.');
    return new RespostaArquivo(caminhoDocumento(anexoUid, anexo.sha256, Number(anexo.tamanho)), anexo.mime);
  },

  /** A administração baixa qualquer certificado anexado. */
  'GET /api/admin/certificados/:uid/arquivo': (ctx) => {
    exigirAdmin(ctx);
    const uid = ctx.params.uid.toLowerCase();
    if (!uidValido(uid)) throw new ErroHttp(400, 'Identificador do certificado inválido.');
    const anexo = banco.prepare('SELECT mime, sha256, tamanho FROM certificados_anexos WHERE uid = ?').get(uid) as
      | { mime: string; sha256: string; tamanho: number }
      | undefined;
    if (!anexo) throw new ErroHttp(404, 'Certificado não encontrado.');
    return new RespostaArquivo(caminhoDocumento(uid, anexo.sha256, Number(anexo.tamanho)), anexo.mime);
  },

  /** Registro das emissões: todos os certificados numerados, com o arquivo anexado. */
  'GET /api/admin/certificados': (ctx) => {
    exigirAdmin(ctx);
    const linhas = banco.prepare('SELECT * FROM certificados ORDER BY emitidoEm DESC LIMIT 500').all() as Array<
      Record<string, unknown>
    >;
    const ultimoAnexo = banco.prepare(
      `SELECT uid, nomeArquivo, mime, tamanho, anexadoEm FROM certificados_anexos
        WHERE numero = ? ORDER BY anexadoEm DESC LIMIT 1`,
    );
    return {
      certificados: linhas.map((c) => {
        const anexo = ultimoAnexo.get(String(c.numero)) as
          | { uid: string; nomeArquivo: string; mime: string; tamanho: number; anexadoEm: number }
          | undefined;
        return {
          numero: String(c.numero),
          // Nulo quando a solicitação foi excluída: o certificado continua no registro.
          certificacaoId: c.certificacaoId === null || c.certificacaoId === undefined ? null : Number(c.certificacaoId),
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
          anexo: anexo
            ? { ...anexo, tamanho: Number(anexo.tamanho), anexadoEm: Number(anexo.anexadoEm) }
            : null,
        };
      }),
    };
  },
};
