import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { codigoDe, type DefinicaoFormulario } from '../../compartilhado/formulario';
import { calcularProgresso, contarMidias, type MapaRespostas } from '../../compartilhado/progresso';
import { infoDoTipo } from '../../compartilhado/tiposChecklist';
import { andamentoDoDocumento } from './andamento';
import { registrar } from './auditoria';
import { avisar } from './avisos';
import { agendarBackupContinuo } from './backup';
import { banco, emTransacao, type Usuario } from './banco';
import { gerarCertificadoDoModelo, novoCodigoCertificado } from './certificadosChecklist';
import { caminhoDocumento, conferirHashRecebido, paraBusca } from './documentos';
import {
  conclusaoVerificacaoSchema,
  decisaoVerificacaoSchema,
  envioVerificacaoSchema,
  ID_CABECALHO,
  primeiroErro,
  tamanhoMaximoDe,
  type DocumentoProjeto,
  type ItemNaoConforme,
} from './esquemas';
import { obterDefinicao, painelDoFormulario } from './formularios';
import { caminhoMidia, gravarMidia, hashDe, hashDoArquivo, uidValido } from './midias';
import { lerPagina } from './paginacao';
import {
  ErroHttp,
  RespostaArquivo,
  emailsDosAdmins,
  exigirAdmin,
  exigirSessao,
  type Contexto,
} from './rotas';
import { obterTipo } from './tiposChecklist';

/**
 * Aprovação das verificações pela administração.
 *
 * Ao gerar o PDF do projeto (um por tipo de verificação), o aparelho envia o
 * PDF para o arquivo e, em seguida, este envio: o retrato das respostas e das
 * fotos daquele tipo no momento da geração. A administração analisa o
 * retrato, marca as etapas não conformes com o motivo e aprova ou reprova; o
 * montador recebe a decisão e corrige.
 *
 * O envio chega em três passos, todos idempotentes — uma queda de conexão no
 * meio não duplica nem perde nada:
 *   1. `POST /api/verificacoes` grava o retrato e diz quais fotos faltam;
 *   2. `PUT /api/verificacoes/:uid/midias/:midia` recebe cada foto que falta;
 *   3. `POST /api/verificacoes/:uid/concluir` põe o envio na fila de aprovação.
 * Uma versão nova do mesmo projeto e tipo substitui a que ainda aguardava.
 */

type Manipulador = (ctx: Contexto) => unknown;

export type EstadoVerificacao = 'recebendo' | 'aguardando' | 'aprovada' | 'reprovada' | 'substituida';

/** `verificacao`: PDF do projeto (aba Aprovações). `certificado`: checklist que contém certificado (aba Certificados). */
export type CategoriaEnvio = 'verificacao' | 'certificado';

interface Linha {
  id: number;
  uid: string;
  usuarioId: number | null;
  montadorNome: string;
  montadorEmail: string;
  painelId: number | null;
  painelNome: string;
  projetoUid: string;
  projetoChave: string;
  empresa: string;
  nomeProjeto: string;
  tipo: string;
  tipoRotulo: string;
  versao: number | null;
  estado: EstadoVerificacao;
  pdfUid: string;
  documento: string;
  tags: string;
  geradoEm: number;
  criadoEm: number;
  enviadoEm: number | null;
  decididoEm: number | null;
  decididoPorNome: string | null;
  comentario: string;
  itens: string;
  categoria: CategoriaEnvio;
  certTagUid: string | null;
  certFormId: string | null;
  certificadoNumero: string | null;
  certificadoUid: string | null;
}

/** Etapa não conforme como fica gravada: legível mesmo sem o checklist. */
export interface ItemGravado {
  tagUid: string | null;
  tagNome: string;
  formId: string;
  formNome: string;
  etapaId: string;
  etapaCodigo: string;
  etapaDescricao: string;
  motivo: string;
}

interface MidiaDoEnvio {
  uid: string;
  mime: string;
  tagUid: string | null;
  formId: string | null;
  etapaId: string;
  ordem: number;
  situacao: 'pendente' | 'recebida' | 'ausente';
}

const ESTADOS_LISTAVEIS = ['aguardando', 'aprovada', 'reprovada', 'substituida'] as const;

function numeroOuNulo(v: number | null): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function resumo(l: Linha) {
  return {
    id: Number(l.id),
    uid: l.uid,
    estado: l.estado,
    versao: numeroOuNulo(l.versao),
    painel: { id: numeroOuNulo(l.painelId), nome: l.painelNome },
    projeto: { uid: l.projetoUid, empresa: l.empresa, nome: l.nomeProjeto },
    tipo: { id: l.tipo, rotulo: l.tipoRotulo },
    montador: { id: numeroOuNulo(l.usuarioId), nome: l.montadorNome, email: l.montadorEmail },
    tags: JSON.parse(l.tags) as string[],
    pdfUid: l.pdfUid,
    geradoEm: Number(l.geradoEm),
    enviadoEm: numeroOuNulo(l.enviadoEm),
    decididoEm: numeroOuNulo(l.decididoEm),
    decididoPor: l.decididoPorNome,
    comentario: l.comentario,
    itens: JSON.parse(l.itens) as ItemGravado[],
    categoria: l.categoria ?? 'verificacao',
    certificado:
      l.categoria === 'certificado'
        ? { tagUid: l.certTagUid, formId: l.certFormId, numero: l.certificadoNumero, uid: l.certificadoUid }
        : null,
  };
}

export type ResumoVerificacao = ReturnType<typeof resumo>;

function obter(id: number): Linha | undefined {
  return banco.prepare('SELECT * FROM verificacoes WHERE id = ?').get(id) as Linha | undefined;
}

function uidDaUrl(bruto: string, rotulo = 'envio'): string {
  const uid = bruto.toLowerCase();
  if (!uidValido(uid)) throw new ErroHttp(400, `Identificador de ${rotulo} inválido.`);
  return uid;
}

function doMontador(eu: Usuario, uid: string): Linha {
  const l = banco.prepare('SELECT * FROM verificacoes WHERE uid = ?').get(uid) as Linha | undefined;
  if (!l || l.usuarioId !== eu.id) throw new ErroHttp(404, 'Envio não encontrado no servidor.');
  return l;
}

function midiasDo(id: number): MidiaDoEnvio[] {
  return (
    banco
      .prepare(
        `SELECT uid, mime, tagUid, formId, etapaId, ordem, situacao FROM midias_protegidas
          WHERE origem = 'verificacao' AND origemId = ? ORDER BY tagUid, formId, etapaId, ordem`,
      )
      .all(id) as unknown as MidiaDoEnvio[]
  ).map((m) => ({ ...m, ordem: Number(m.ordem) }));
}

/** O arquivo da foto já está no servidor e é desta conta. */
function fotoDaConta(eu: Usuario, uid: string): boolean {
  if (!existsSync(caminhoMidia(uid))) return false;
  return Boolean(
    banco
      .prepare(
        `SELECT 1 FROM sync_midias WHERE uid = ? AND usuarioId = ?
         UNION ALL
         SELECT 1 FROM midias_protegidas m JOIN verificacoes v ON m.origem = 'verificacao' AND v.id = m.origemId
          WHERE m.uid = ? AND m.situacao = 'recebida' AND v.usuarioId = ?
         LIMIT 1`,
      )
      .get(uid, eu.id, uid, eu.id),
  );
}

/** Marca a foto como recebida, gravando o SHA-256 e o tamanho do arquivo em disco. */
function marcarRecebida(id: number, uid: string): void {
  const caminho = caminhoMidia(uid);
  banco
    .prepare(
      `UPDATE midias_protegidas SET situacao = 'recebida', sha256 = ?, tamanho = ?
        WHERE origem = 'verificacao' AND origemId = ? AND uid = ? AND situacao = 'pendente'`,
    )
    .run(hashDoArquivo(caminho), statSync(caminho).size, id, uid);
}

/** As fotos citadas que ainda não chegaram; as que o servidor já tem são dadas por recebidas. */
function faltandoDo(id: number, eu: Usuario): string[] {
  const faltando: string[] = [];
  for (const m of midiasDo(id)) {
    if (m.situacao !== 'pendente') continue;
    if (fotoDaConta(eu, m.uid)) marcarRecebida(id, m.uid);
    else faltando.push(m.uid);
  }
  return faltando;
}

/** Nome e texto da etapa marcada, a partir do retrato e do checklist. */
function completarItens(
  documento: DocumentoProjeto,
  itens: ItemNaoConforme[],
): ItemGravado[] {
  const tags = new Map(documento.tags.map((t) => [t.uid.toLowerCase(), t]));
  const formIds = new Set([
    ...documento.preenchimentos.map((p) => p.formId),
    ...documento.tags.flatMap((t) => t.formIds ?? []),
  ]);
  const vistos = new Set<string>();
  const definicoes = new Map<string, DefinicaoFormulario | null>();

  return itens.map((item) => {
    const tag = item.tagUid ? tags.get(item.tagUid.toLowerCase()) : undefined;
    if (!tag) throw new ErroHttp(400, 'Item ligado a uma TAG que não faz parte do envio.');
    if (!formIds.has(item.formId)) throw new ErroHttp(400, 'Item ligado a um checklist que não faz parte do envio.');
    const chave = `${tag.uid}|${item.formId}|${item.etapaId}`;
    if (vistos.has(chave)) throw new ErroHttp(400, 'A mesma etapa foi marcada duas vezes.');
    vistos.add(chave);

    if (!definicoes.has(item.formId)) definicoes.set(item.formId, obterDefinicao(item.formId));
    const definicao = definicoes.get(item.formId) ?? null;
    let codigo = 'Dados do painel';
    let descricao = 'Dados do painel (cabeçalho do checklist)';
    if (item.etapaId !== ID_CABECALHO) {
      const etapa = definicao?.secoes.flatMap((s) => s.etapas).find((e) => e.id === item.etapaId);
      if (definicao && !etapa) throw new ErroHttp(400, `A etapa ${item.etapaId} não existe no checklist.`);
      codigo = etapa ? codigoDe(etapa) : item.etapaId;
      descricao = etapa?.descricao ?? '';
    }
    return {
      tagUid: tag.uid.toLowerCase(),
      tagNome: tag.nome,
      formId: item.formId,
      formNome: definicao?.nome ?? item.formId,
      etapaId: item.etapaId,
      etapaCodigo: codigo,
      etapaDescricao: descricao,
      motivo: item.motivo,
    };
  });
}

/** Lista das etapas para o texto do aviso por e-mail. */
function itensEmTexto(itens: ItemGravado[]): string {
  return itens.map((i) => `- TAG ${i.tagNome}, ${i.etapaCodigo}: ${i.motivo}`).join('\n');
}

/** O que o montador mandou naquela etapa: para a tela dizer se já foi alterada. */
function enviadoNaEtapa(documento: DocumentoProjeto, item: ItemGravado) {
  const preenchimento = documento.preenchimentos.find(
    (p) => p.tagUid.toLowerCase() === item.tagUid && p.formId === item.formId,
  );
  if (item.etapaId === ID_CABECALHO) return { cabecalho: preenchimento?.cabecalho ?? {} };
  return {
    resposta: preenchimento?.respostas[item.etapaId] ?? null,
    midias: documento.midias
      .filter((m) => m.tagUid.toLowerCase() === item.tagUid && m.formId === item.formId && m.etapaId === item.etapaId)
      .map((m) => m.uid.toLowerCase()),
  };
}

interface Emissao {
  codigo: string;
  uid: string;
  nomeArquivo: string;
  tamanho: number;
  sha256: string;
}

/** Gera e grava o PDF do certificado a partir do modelo do checklist. */
async function emitirCertificado(l: Linha, documento: DocumentoProjeto, eu: Usuario, agora: number): Promise<Emissao> {
  const definicao = l.certFormId ? obterDefinicao(l.certFormId) : null;
  const modelo = definicao?.modeloCertificado?.uid.toLowerCase();
  if (!modelo) {
    throw new ErroHttp(
      409,
      'O checklist não tem mais o modelo do certificado. Envie o modelo ao editar o checklist e aprove de novo.',
      'sem-modelo-certificado',
    );
  }
  const tag = documento.tags[0]?.nome ?? '';
  const codigo = novoCodigoCertificado();
  const pdf = await gerarCertificadoDoModelo(modelo, {
    codigo,
    emitidoEm: agora,
    aprovadoPor: eu.nome,
    empresa: l.empresa,
    projeto: l.nomeProjeto,
    tag,
    painel: l.painelNome,
    checklist: l.tipoRotulo,
    montador: l.montadorNome,
  });
  const uid = randomUUID();
  gravarMidia(uid, pdf);
  const nomeArquivo = `Certificado ${codigo} - TAG ${tag}`.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-').slice(0, 180) + '.pdf';
  return { codigo, uid, nomeArquivo, tamanho: pdf.length, sha256: hashDe(pdf) };
}

/** Registro do certificado emitido (dentro da transação da decisão). */
function registrarCertificado(l: Linha, documento: DocumentoProjeto, eu: Usuario, agora: number, e: Emissao): void {
  const tag = documento.tags[0]?.nome ?? '';
  const cabecalho = documento.preenchimentos[0]?.cabecalho ?? {};
  const painelSlug =
    l.painelId === null
      ? ''
      : ((banco.prepare('SELECT slug FROM paineis WHERE id = ?').get(l.painelId) as { slug: string } | undefined)?.slug ?? '');
  banco
    .prepare(
      `INSERT INTO certificados
         (numero, certificacaoId, painelSlug, nomePainel, projeto, tagPainel, clienteFinal, montador,
          correnteNominal, correnteCurtoCircuito, responsavel, emitidoEm, retrato)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?)`,
    )
    .run(
      e.codigo,
      painelSlug,
      l.painelNome,
      l.nomeProjeto,
      tag,
      cabecalho.clienteFinal ?? '',
      l.montadorNome,
      eu.nome,
      agora,
      // O retrato do que foi aprovado: sobrevive à exclusão do projeto e da conta.
      JSON.stringify({ verificacaoUid: l.uid, formId: l.certFormId, documento }),
    );
  banco
    .prepare(
      `INSERT INTO certificados_anexos
         (uid, certificacaoId, certificacaoUid, numero, painelId, painelNome, projeto, tagPainel, clienteFinal,
          empresa, montadorId, montadorNome, nomeArquivo, mime, tamanho, sha256, anexadoPor, anexadoPorNome,
          anexadoEm, busca, verificacaoId)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.uid,
      l.uid,
      e.codigo,
      l.painelId,
      l.painelNome,
      l.nomeProjeto,
      tag,
      cabecalho.clienteFinal ?? '',
      l.empresa,
      l.usuarioId,
      l.montadorNome,
      e.nomeArquivo,
      e.tamanho,
      e.sha256,
      eu.id,
      eu.nome,
      agora,
      paraBusca(
        [e.codigo, e.codigo.replace('-', ''), l.empresa, l.nomeProjeto, tag, l.painelNome, l.montadorNome, l.tipoRotulo].join(' '),
      ),
      l.id,
    );
}

export const rotasVerificacoes: Record<string, Manipulador> = {
  // ------------------------------------------------------------ montador

  /** Passo 1: grava o retrato do envio e devolve as fotos que faltam. */
  'POST /api/verificacoes': (ctx) => {
    const eu = exigirSessao(ctx);
    const r = envioVerificacaoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const e = r.data;
    const uid = e.uid.toLowerCase();

    const existente = banco.prepare('SELECT * FROM verificacoes WHERE uid = ?').get(uid) as Linha | undefined;
    if (existente) {
      // Reenvio depois de uma queda de conexão: segue de onde parou.
      if (existente.usuarioId !== eu.id) throw new ErroHttp(409, 'Identificador de envio já usado.');
      return { verificacao: resumo(existente), faltando: faltandoDo(existente.id, eu) };
    }

    const pdfUid = e.pdfUid.toLowerCase();
    const pdf = banco.prepare('SELECT usuarioId FROM pdfs_emitidos WHERE uid = ?').get(pdfUid) as
      | { usuarioId: number | null }
      | undefined;
    if (!pdf) throw new ErroHttp(409, 'O PDF ainda não chegou ao servidor.', 'pdf-ausente');
    if (pdf.usuarioId !== eu.id) throw new ErroHttp(409, 'O PDF pertence a outra conta.');
    if (banco.prepare('SELECT 1 FROM verificacoes WHERE pdfUid = ?').get(pdfUid)) {
      throw new ErroHttp(409, 'Este PDF já foi enviado para aprovação.');
    }
    const painel = banco.prepare('SELECT id, nome FROM paineis WHERE id = ?').get(e.painelId) as
      | { id: number; nome: string }
      | undefined;
    if (!painel) throw new ErroHttp(404, 'Painel não encontrado.');
    if (!e.documento.tags.length) throw new ErroHttp(400, 'O envio não tem nenhuma TAG.');
    const citadas = e.documento.midias.map((m) => m.uid.toLowerCase());
    if (new Set(citadas).size !== citadas.length) throw new ErroHttp(400, 'Foto repetida no envio.');

    let categoria: CategoriaEnvio = 'verificacao';
    let tipoChave = e.tipo;
    let tipoRotulo = obterTipo(e.tipo)?.rotulo ?? infoDoTipo(e.tipo).rotulo;
    let certTagUid: string | null = null;
    let certFormId: string | null = null;
    if (e.certificado) {
      // Checklist que contém certificado: uma TAG, um checklist, completo, e
      // com o modelo do certificado já enviado pela administração.
      const tagUid = e.certificado.tagUid.toLowerCase();
      const formId = e.certificado.formId;
      const definicao = obterDefinicao(formId);
      if (!definicao?.emiteCertificado) throw new ErroHttp(400, 'Este checklist não contém certificado.');
      if (painelDoFormulario(formId) !== painel.id) throw new ErroHttp(400, 'O checklist não é deste painel.');
      const modelo = definicao.modeloCertificado?.uid.toLowerCase();
      if (!modelo || !banco.prepare('SELECT 1 FROM modelos_certificado WHERE uid = ?').get(modelo)) {
        throw new ErroHttp(
          409,
          'O checklist ainda não tem o modelo do certificado. Avise a administração.',
          'sem-modelo-certificado',
        );
      }
      if (e.documento.tags.length !== 1 || e.documento.tags[0].uid.toLowerCase() !== tagUid) {
        throw new ErroHttp(400, 'O envio do certificado vale para uma TAG só.');
      }
      const preenchimento = e.documento.preenchimentos.find(
        (p) => p.tagUid.toLowerCase() === tagUid && p.formId === formId,
      );
      const progresso = calcularProgresso(
        definicao,
        (preenchimento?.respostas ?? {}) as MapaRespostas,
        contarMidias(e.documento.midias.filter((m) => m.tagUid.toLowerCase() === tagUid && m.formId === formId)),
      );
      if (progresso.total === 0 || progresso.pendentes > 0) {
        throw new ErroHttp(
          409,
          `O checklist tem ${progresso.pendentes} etapa(s) pendente(s): complete todas para pedir o certificado.`,
          'checklist-incompleto',
        );
      }
      categoria = 'certificado';
      tipoChave = `certificado:${tagUid}:${formId}`;
      tipoRotulo = definicao.nome;
      certTagUid = tagUid;
      certFormId = formId;
    }
    const projetoUid = e.projetoUid.toLowerCase();
    const nomesTags = [...e.documento.tags].sort((a, b) => a.ordem - b.ordem).map((t) => t.nome);
    const agora = Date.now();

    const id = emTransacao(() => {
      const info = banco
        .prepare(
          `INSERT INTO verificacoes
             (uid, usuarioId, montadorNome, montadorEmail, painelId, painelNome, projetoUid, projetoChave,
              empresa, nomeProjeto, tipo, tipoRotulo, estado, pdfUid, documento, tags, geradoEm, criadoEm, busca,
              categoria, certTagUid, certFormId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recebendo', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          uid,
          eu.id,
          eu.nome,
          eu.email,
          painel.id,
          painel.nome,
          projetoUid,
          // O id da conta pode ser reaproveitado depois de uma exclusão (e o
          // projeto legado tem o mesmo uid em toda conta): a criação da conta
          // separa as versões de quem saiu das de quem chegou.
          `${eu.id}.${eu.criadoEm}:${projetoUid}`,
          e.documento.projeto.empresa || '—',
          e.documento.projeto.nomeProjeto || '—',
          tipoChave,
          tipoRotulo,
          pdfUid,
          JSON.stringify(e.documento),
          JSON.stringify(nomesTags),
          e.geradoEm,
          agora,
          paraBusca(
            [e.documento.projeto.empresa, e.documento.projeto.nomeProjeto, painel.nome, tipoRotulo, eu.nome, eu.email, ...nomesTags].join(' '),
          ),
          categoria,
          certTagUid,
          certFormId,
        );
      const novo = Number(info.lastInsertRowid);
      const inserir = banco.prepare(
        `INSERT INTO midias_protegidas (origem, origemId, uid, mime, tagUid, formId, etapaId, ordem)
         VALUES ('verificacao', ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const m of e.documento.midias) {
        inserir.run(novo, m.uid.toLowerCase(), m.mime, m.tagUid.toLowerCase(), m.formId, m.etapaId, m.ordem);
      }
      return novo;
    });

    const linha = obter(id)!;
    return { verificacao: resumo(linha), faltando: faltandoDo(id, eu) };
  },

  /** Passo 2: uma foto citada no envio que o servidor ainda não tinha. */
  'PUT /api/verificacoes/:uid/midias/:midia': (ctx) => {
    const eu = exigirSessao(ctx);
    const l = doMontador(eu, uidDaUrl(ctx.params.uid));
    const midiaUid = uidDaUrl(ctx.params.midia, 'foto');
    // Envio já completo: nada mais a receber (reenvio atrasado de uma foto).
    if (l.estado !== 'recebendo') return { ok: true };

    const midia = banco
      .prepare(
        `SELECT mime, situacao FROM midias_protegidas
          WHERE origem = 'verificacao' AND origemId = ? AND uid = ?`,
      )
      .get(l.id, midiaUid) as { mime: string; situacao: string } | undefined;
    if (!midia) throw new ErroHttp(404, 'Esta foto não faz parte do envio.');
    if (midia.situacao !== 'pendente') return { ok: true };

    const dados = ctx.corpoBruto;
    if (!dados?.length) throw new ErroHttp(400, 'Arquivo vazio.');
    const tipo = (ctx.tipoConteudo ?? '').split(';')[0].trim().toLowerCase();
    if (tipo !== midia.mime) throw new ErroHttp(400, 'O tipo do arquivo não é o registrado no envio.');
    if (dados.length > tamanhoMaximoDe(midia.mime)) throw new ErroHttp(413, 'Arquivo grande demais.');
    conferirHashRecebido(ctx.consulta.get('sha256'), dados);

    // O nome do arquivo é o `uid`: o de outra conta, de uma imagem de apoio ou
    // de um documento não pode ser sobrescrito.
    const dono = banco.prepare('SELECT usuarioId FROM sync_midias WHERE uid = ?').get(midiaUid) as
      | { usuarioId: number }
      | undefined;
    if (dono && Number(dono.usuarioId) !== eu.id) throw new ErroHttp(409, 'Identificador de foto já usado.');
    if (
      banco.prepare('SELECT 1 FROM apoio_midias WHERE uid = ?').get(midiaUid) ??
      banco.prepare('SELECT 1 FROM pdfs_emitidos WHERE uid = ?').get(midiaUid) ??
      banco.prepare('SELECT 1 FROM certificados_anexos WHERE uid = ?').get(midiaUid) ??
      banco.prepare('SELECT 1 FROM modelos_certificado WHERE uid = ?').get(midiaUid)
    ) {
      throw new ErroHttp(409, 'Identificador de foto já usado.');
    }

    if (!existsSync(caminhoMidia(midiaUid))) gravarMidia(midiaUid, dados);
    marcarRecebida(l.id, midiaUid);
    agendarBackupContinuo();
    return { ok: true };
  },

  /**
   * Passo 3: põe o envio na fila de aprovação. Fotos que não existem mais no
   * aparelho (apagadas depois de gerar o PDF) vão em `ausentes` e ficam
   * registradas assim — o PDF continua sendo o documento.
   */
  'POST /api/verificacoes/:uid/concluir': (ctx) => {
    const eu = exigirSessao(ctx);
    const r = conclusaoVerificacaoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const l = doMontador(eu, uidDaUrl(ctx.params.uid));
    if (l.estado !== 'recebendo') return { verificacao: resumo(l) };

    const pendentes = faltandoDo(l.id, eu);
    const ausentes = new Set(r.data.ausentes.map((u) => u.toLowerCase()));
    const faltando = pendentes.filter((u) => !ausentes.has(u));
    if (faltando.length) {
      throw new ErroHttp(409, `Ainda faltam ${faltando.length} foto(s) do envio.`, 'faltam-fotos');
    }

    const agora = Date.now();
    const versao = emTransacao(() => {
      const marcarAusente = banco.prepare(
        `UPDATE midias_protegidas SET situacao = 'ausente'
          WHERE origem = 'verificacao' AND origemId = ? AND uid = ? AND situacao = 'pendente'`,
      );
      for (const uid of pendentes) marcarAusente.run(l.id, uid);

      const { proxima } = banco
        .prepare(
          `SELECT COALESCE(MAX(versao), 0) + 1 AS proxima FROM verificacoes WHERE projetoChave = ? AND tipo = ?`,
        )
        .get(l.projetoChave, l.tipo) as { proxima: number };
      // A versão anterior que ainda aguardava fica guardada, como substituída.
      banco
        .prepare(
          `UPDATE verificacoes SET estado = 'substituida'
            WHERE projetoChave = ? AND tipo = ? AND estado = 'aguardando'`,
        )
        .run(l.projetoChave, l.tipo);
      banco
        .prepare(
          `UPDATE verificacoes SET estado = 'aguardando', versao = ?, enviadoEm = ?
            WHERE id = ? AND estado = 'recebendo'`,
        )
        .run(Number(proxima), agora, l.id);
      return Number(proxima);
    });

    const ehCertificado = l.categoria === 'certificado';
    const tagDoEnvio = (JSON.parse(l.tags) as string[])[0] ?? '';
    avisar({
      assunto: ehCertificado
        ? `Certificado para aprovar: ${l.painelNome} — ${l.nomeProjeto} (TAG ${tagDoEnvio})`
        : `Verificação para aprovar: ${l.painelNome} — ${l.nomeProjeto}`,
      texto:
        (ehCertificado
          ? `${eu.nome} (${eu.email}) terminou o checklist ${l.tipoRotulo} da TAG ${tagDoEnvio}, projeto ` +
            `${l.nomeProjeto} (${l.empresa}), versão ${versao}, e pediu o certificado.`
          : `${eu.nome} (${eu.email}) enviou o PDF de ${l.tipoRotulo} do projeto ${l.nomeProjeto}` +
            ` (${l.empresa}), versão ${versao}, para aprovação.`) +
        (pendentes.length ? `\n\n${pendentes.length} foto(s) não chegaram ao servidor.` : '') +
        (ehCertificado ? '\n\nAnalise em Administração → Certificados.' : '\n\nAnalise em Administração → Aprovações.'),
      emails: emailsDosAdmins(),
      rota: ehCertificado ? '#/admin?aba=certificados' : '#/admin?aba=aprovacoes&secao=verificacoes',
    });
    agendarBackupContinuo();
    return { verificacao: resumo(obter(l.id)!) };
  },

  /**
   * A situação de cada projeto e tipo da conta: a versão mais recente, com os
   * itens a corrigir quando reprovada, e o que foi enviado em cada item.
   */
  'GET /api/verificacoes': (ctx) => {
    const eu = exigirSessao(ctx);
    const linhas = banco
      .prepare(
        `SELECT * FROM verificacoes v
          WHERE v.usuarioId = ? AND v.estado <> 'recebendo'
            AND v.versao = (SELECT MAX(x.versao) FROM verificacoes x
                             WHERE x.projetoChave = v.projetoChave AND x.tipo = v.tipo)
          ORDER BY v.enviadoEm DESC`,
      )
      .all(eu.id) as unknown as Linha[];
    const aprovada = banco.prepare(
      `SELECT versao, decididoEm FROM verificacoes
        WHERE projetoChave = ? AND tipo = ? AND estado = 'aprovada' ORDER BY versao DESC LIMIT 1`,
    );
    return {
      verificacoes: linhas.map((l) => {
        const base = resumo(l);
        const documento = JSON.parse(l.documento) as DocumentoProjeto;
        const ultima = aprovada.get(l.projetoChave, l.tipo) as { versao: number; decididoEm: number } | undefined;
        return {
          ...base,
          itens: base.itens.map((item) => ({ ...item, enviado: enviadoNaEtapa(documento, item) })),
          ultimaAprovada: ultima ? { versao: Number(ultima.versao), decididoEm: Number(ultima.decididoEm) } : null,
        };
      }),
    };
  },

  // ------------------------------------------------------- administração

  /** Fila de aprovação (padrão: aguardando, das mais antigas para as novas). */
  'GET /api/admin/verificacoes': (ctx) => {
    exigirAdmin(ctx);
    const estado = ctx.consulta.get('estado') ?? 'aguardando';
    if (estado !== 'todas' && !ESTADOS_LISTAVEIS.includes(estado as (typeof ESTADOS_LISTAVEIS)[number])) {
      throw new ErroHttp(400, 'Situação inválida.');
    }
    const { pagina, porPagina, deslocamento } = lerPagina(ctx.consulta, 25);
    const categoria: CategoriaEnvio = ctx.consulta.get('categoria') === 'certificado' ? 'certificado' : 'verificacao';
    const onde = `categoria = ? AND ${estado === 'todas' ? "estado <> 'recebendo'" : 'estado = ?'}`;
    const valores = estado === 'todas' ? [categoria] : [categoria, estado];
    const ordem = estado === 'aguardando' ? 'enviadoEm ASC, id ASC' : 'COALESCE(decididoEm, enviadoEm) DESC, id DESC';
    const total = Number(
      (banco.prepare(`SELECT COUNT(*) AS n FROM verificacoes WHERE ${onde}`).get(...valores) as { n: number }).n,
    );
    const linhas = banco
      .prepare(`SELECT * FROM verificacoes WHERE ${onde} ORDER BY ${ordem} LIMIT ? OFFSET ?`)
      .all(...valores, porPagina, deslocamento) as unknown as Linha[];
    return {
      pagina,
      porPagina,
      total,
      itens: linhas.map((l) => {
        let progresso: { total: number; respondidas: number } | null = null;
        if (l.painelId !== null) {
          try {
            progresso = andamentoDoDocumento(Number(l.painelId), JSON.parse(l.documento) as DocumentoProjeto);
          } catch {
            progresso = null;
          }
        }
        return { ...resumo(l), progresso };
      }),
    };
  },

  /** O envio inteiro para a tela de análise: retrato, checklists, fotos e versões. */
  'GET /api/admin/verificacoes/:id': (ctx) => {
    exigirAdmin(ctx);
    const l = obter(Number(ctx.params.id));
    if (!l || l.estado === 'recebendo') throw new ErroHttp(404, 'Envio não encontrado.');
    const documento = JSON.parse(l.documento) as DocumentoProjeto;
    const formIds = new Set([
      ...documento.preenchimentos.map((p) => p.formId),
      ...documento.tags.flatMap((t) => t.formIds ?? []),
    ]);
    const versoes = banco
      .prepare(
        `SELECT * FROM verificacoes WHERE projetoChave = ? AND tipo = ? AND estado <> 'recebendo'
          ORDER BY versao DESC`,
      )
      .all(l.projetoChave, l.tipo) as unknown as Linha[];
    const pdf = banco
      .prepare('SELECT nomeArquivo, tamanho, sha256, emitidoEm FROM pdfs_emitidos WHERE uid = ?')
      .get(l.pdfUid) as { nomeArquivo: string; tamanho: number; sha256: string; emitidoEm: number } | undefined;
    const emitido = l.certificadoUid
      ? (banco
          .prepare('SELECT uid, numero, nomeArquivo, tamanho, anexadoEm FROM certificados_anexos WHERE uid = ?')
          .get(l.certificadoUid) as
          | { uid: string; numero: string; nomeArquivo: string; tamanho: number; anexadoEm: number }
          | undefined)
      : undefined;
    return {
      verificacao: { ...resumo(l), documento },
      certificadoEmitido: emitido
        ? { ...emitido, tamanho: Number(emitido.tamanho), anexadoEm: Number(emitido.anexadoEm) }
        : null,
      definicoes: Object.fromEntries([...formIds].map((id) => [id, obterDefinicao(id)])),
      midias: midiasDo(l.id),
      versoes: versoes.map(resumo),
      pdf: pdf
        ? { uid: l.pdfUid, nomeArquivo: pdf.nomeArquivo, tamanho: Number(pdf.tamanho), sha256: pdf.sha256, emitidoEm: Number(pdf.emitidoEm) }
        : null,
    };
  },

  /** Aprova ou reprova. Só um envio aguardando pode ser decidido, e a decisão é definitiva. */
  'POST /api/admin/verificacoes/:id/decisao': async (ctx) => {
    const eu = exigirAdmin(ctx);
    const r = decisaoVerificacaoSchema.safeParse(ctx.corpo);
    if (!r.success) throw new ErroHttp(400, primeiroErro(r.error));
    const id = Number(ctx.params.id);
    const l = obter(id);
    if (!l || l.estado === 'recebendo') throw new ErroHttp(404, 'Envio não encontrado.');
    if (l.estado === 'substituida') {
      throw new ErroHttp(409, 'Este envio foi substituído por uma versão mais nova. Analise a versão atual.');
    }
    if (l.estado !== 'aguardando') throw new ErroHttp(409, 'Este envio já foi decidido.');

    const documento = JSON.parse(l.documento) as DocumentoProjeto;
    const itens = completarItens(documento, r.data.itens);
    const agora = Date.now();

    // Checklist que contém certificado, aprovado: o certificado sai do modelo
    // antes da transação (gerar o PDF é assíncrono); o arquivo é gravado com
    // fsync e só então registrado. Se a decisão não valer (outro
    // administrador decidiu antes), o arquivo fica sem registro e a faxina o recolhe.
    const emissao =
      l.categoria === 'certificado' && r.data.decisao === 'aprovada' ? await emitirCertificado(l, documento, eu, agora) : null;

    emTransacao(() => {
      const mudou = banco
        .prepare(
          `UPDATE verificacoes SET estado = ?, decididoEm = ?, decididoPor = ?, decididoPorNome = ?,
                  comentario = ?, itens = ?, certificadoNumero = ?, certificadoUid = ?
            WHERE id = ? AND estado = 'aguardando'`,
        )
        .run(
          r.data.decisao,
          agora,
          eu.id,
          eu.nome,
          r.data.comentario,
          JSON.stringify(itens),
          emissao?.codigo ?? null,
          emissao?.uid ?? null,
          id,
        );
      // Dois administradores decidindo ao mesmo tempo: só o primeiro vale.
      if (Number(mudou.changes) === 0) throw new ErroHttp(409, 'Este envio já foi decidido.');
      if (emissao) registrarCertificado(l, documento, eu, agora, emissao);
      registrar({
        autor: eu,
        acao: emissao
          ? `aprovou e emitiu o certificado ${emissao.codigo}`
          : r.data.decisao === 'aprovada'
            ? 'aprovou a verificação'
            : 'reprovou a verificação',
        alvoTipo: emissao ? 'certificado' : 'verificacao',
        alvoId: id,
        alvo: `${l.nomeProjeto} — ${l.tipoRotulo} v${l.versao}`,
        detalhe:
          r.data.decisao === 'reprovada'
            ? `${l.painelNome}; ${itens.length} etapa(s) não conforme(s)`
            : l.painelNome,
      });
    });

    if (l.usuarioId !== null && emissao) {
      const tag = documento.tags[0]?.nome ?? '';
      avisar({
        assunto: `Certificado ${emissao.codigo} emitido: ${l.nomeProjeto} (TAG ${tag})`,
        texto:
          `O checklist ${l.tipoRotulo} da TAG ${tag}, projeto ${l.nomeProjeto} (${l.painelNome}), foi aprovado ` +
          `por ${eu.nome}. Certificado nº ${emissao.codigo}.` +
          (r.data.comentario ? `\n\nComentário: ${r.data.comentario}` : '') +
          '\n\nBaixe o certificado na tela inicial do aplicativo.',
        emails: [l.montadorEmail],
        rota: '#/paineis',
      });
    } else if (l.usuarioId !== null) {
      avisar(
        r.data.decisao === 'aprovada'
          ? {
              assunto: `Verificação aprovada: ${l.nomeProjeto} (${l.tipoRotulo})`,
              texto:
                `A verificação de ${l.tipoRotulo} do projeto ${l.nomeProjeto} (${l.painelNome}), ` +
                `versão ${l.versao}, foi aprovada por ${eu.nome}.` +
                (r.data.comentario ? `\n\nComentário: ${r.data.comentario}` : ''),
              emails: [l.montadorEmail],
              rota: '#/paineis',
            }
          : {
              assunto: `Correção solicitada: ${l.nomeProjeto} (${l.tipoRotulo})`,
              texto:
                `A verificação de ${l.tipoRotulo} do projeto ${l.nomeProjeto} (${l.painelNome}), ` +
                `versão ${l.versao}, voltou para correção.` +
                (itens.length ? `\n\nEtapas a corrigir:\n${itensEmTexto(itens)}` : '') +
                (r.data.comentario ? `\n\nComentário: ${r.data.comentario}` : '') +
                '\n\nCorrija no aplicativo e gere o PDF de novo para reenviar.',
              emails: [l.montadorEmail],
              rota: '#/paineis',
            },
      );
    }
    agendarBackupContinuo();
    return { verificacao: resumo(obter(id)!), certificado: emissao ? { numero: emissao.codigo, uid: emissao.uid } : null };
  },

  /**
   * Foto de uma etapa, para a tela de análise: a citada num documento (mesmo
   * que o montador já a tenha apagado) ou a sincronizada.
   */
  'GET /api/admin/midias/:uid': (ctx) => {
    exigirAdmin(ctx);
    const uid = uidDaUrl(ctx.params.uid, 'foto');
    const protegida = banco
      .prepare(
        `SELECT mime, sha256, tamanho FROM midias_protegidas
          WHERE uid = ? AND situacao = 'recebida' AND sha256 IS NOT NULL LIMIT 1`,
      )
      .get(uid) as { mime: string; sha256: string; tamanho: number } | undefined;
    if (protegida) {
      return new RespostaArquivo(caminhoDocumento(uid, protegida.sha256, Number(protegida.tamanho)), protegida.mime);
    }
    const sincronizada = banco.prepare('SELECT mime FROM sync_midias WHERE uid = ?').get(uid) as
      | { mime: string }
      | undefined;
    if (sincronizada && existsSync(caminhoMidia(uid))) return new RespostaArquivo(caminhoMidia(uid), sincronizada.mime);
    throw new ErroHttp(404, 'Foto não encontrada.');
  },
};

/** Contagem para o selo da aba Aprovações. */
export function verificacoesAguardando(): number {
  return Number(
    (banco.prepare("SELECT COUNT(*) AS n FROM verificacoes WHERE estado = 'aguardando'").get() as { n: number }).n,
  );
}
