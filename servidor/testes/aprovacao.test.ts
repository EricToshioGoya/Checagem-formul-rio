import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import {
  entrarComoAdmin,
  jpegFalso,
  novoMontador,
  novoUid,
  painelPorSlug,
  pdfFalso,
  primeiraEtapa,
  sha256,
  subirServidor,
  type Ambiente,
  type Cliente,
  type PainelDeTeste,
} from './apoio';

/**
 * Fluxo de aprovação das verificações: envio do PDF do projeto com o retrato
 * das respostas, reprovação com etapas marcadas, versões, aprovação e a guarda
 * permanente de tudo — inclusive depois de excluir a conta do montador.
 */

interface Cenario {
  painel: PainelDeTeste;
  formId: string;
  etapa: string;
  projetoUid: string;
  tags: { a: string; b: string };
}

function documento(c: Cenario, midias: Array<{ uid: string; etapaId?: string; tamanho: number }>) {
  const agora = Date.now();
  return {
    projeto: {
      empresa: 'Painéis Ação Ltda',
      nomeProjeto: 'Linha 3',
      operador: 'Carlos',
      painelSlug: c.painel.slug,
      criadoEm: agora,
      atualizadoEm: agora,
    },
    tags: [
      { uid: c.tags.a, nome: 'QGBT-01', ordem: 0, formIds: [c.formId] },
      { uid: c.tags.b, nome: 'CCM-02', ordem: 1, formIds: [c.formId] },
    ],
    preenchimentos: [
      {
        tagUid: c.tags.a,
        formId: c.formId,
        formRevisao: 'rev00',
        cabecalho: { un: '440' },
        respostas: { [c.etapa]: { valor: true, observacao: 'conferido' } },
        atualizadoEm: agora,
      },
    ],
    midias: midias.map((m, i) => ({
      uid: m.uid,
      tagUid: c.tags.a,
      formId: c.formId,
      etapaId: m.etapaId ?? c.etapa,
      mime: 'image/jpeg',
      largura: 10,
      altura: 10,
      tamanho: m.tamanho,
      criadoEm: agora,
      ordem: i,
    })),
  };
}

async function enviarPdf(montador: Cliente, painelSlug: string, conteudo: Buffer, uid = novoUid()) {
  const consulta = new URLSearchParams({
    empresa: 'Painéis Ação Ltda',
    projeto: 'Linha 3',
    titulo: 'Verificação de Montagem',
    painel: painelSlug,
    nomeArquivo: 'PAINEIS-ACAO_LINHA-3_MONTAGEM.pdf',
    emitidoEm: String(Date.now()),
    sha256: sha256(conteudo),
  });
  const r = await montador.enviarArquivo(`/api/pdfs/${uid}?${consulta}`, conteudo, 'application/pdf');
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  return uid;
}

/** Os três passos do envio, com as fotos que o servidor pedir. */
async function enviarParaAprovacao(
  montador: Cliente,
  c: Cenario,
  pdfUid: string,
  fotos: Map<string, Buffer>,
  envioUid = novoUid(),
) {
  const corpo = {
    uid: envioUid,
    pdfUid,
    painelId: c.painel.id,
    projetoUid: c.projetoUid,
    tipo: 'montagem',
    geradoEm: Date.now(),
    documento: documento(
      c,
      [...fotos].map(([uid, bytes]) => ({ uid, tamanho: bytes.length })),
    ),
  };
  const passo1 = await montador.ok('POST', '/api/verificacoes', corpo);
  for (const uid of passo1.faltando as string[]) {
    const bytes = fotos.get(uid)!;
    const r = await montador.enviarArquivo(
      `/api/verificacoes/${envioUid}/midias/${uid}?sha256=${sha256(bytes)}`,
      bytes,
      'image/jpeg',
    );
    assert.equal(r.status, 200, JSON.stringify(r.dados));
  }
  const fim = await montador.ok('POST', `/api/verificacoes/${envioUid}/concluir`, {});
  return { envioUid, passo1, verificacao: fim.verificacao };
}

describe('aprovação das verificações', () => {
  let amb: Ambiente;
  let admin: Cliente;
  let montador: Cliente;
  let c: Cenario;
  const foto1 = novoUid();
  const bytesFoto1 = jpegFalso('foto 1 da etapa');
  let pdfV1 = '';
  let idV1 = 0;

  before(async () => {
    amb = await subirServidor();
    admin = await entrarComoAdmin(amb.url);
    montador = await novoMontador(amb.url, admin, 'carlos@parceiro.local', 'Carlos Silva');
    const painel = await painelPorSlug(montador, 'sen-plus');
    const montagem = painel.formularios.find((f) => f.tipo === 'montagem')!;
    c = {
      painel,
      formId: montagem.id,
      etapa: primeiraEtapa(montagem.definicao),
      projetoUid: novoUid(),
      tags: { a: novoUid(), b: novoUid() },
    };
  });

  after(async () => {
    await amb?.encerrar();
  });

  it('recusa o PDF que chega diferente do original', async () => {
    const conteudo = pdfFalso('original');
    const uid = novoUid();
    const consulta = new URLSearchParams({
      titulo: 'Verificação de Montagem',
      nomeArquivo: 'x.pdf',
      emitidoEm: String(Date.now()),
      sha256: sha256(pdfFalso('outro conteúdo')),
    });
    const r = await montador.enviarArquivo(`/api/pdfs/${uid}?${consulta}`, conteudo, 'application/pdf');
    assert.equal(r.status, 422);
    assert.equal(r.dados.codigo, 'hash-divergente');
    assert.equal(existsSync(join(amb.dados, 'midias', uid)), false, 'o arquivo recusado não pode ficar no disco');
  });

  it('recebe o envio em três passos e o põe na fila de aprovação', async () => {
    pdfV1 = await enviarPdf(montador, c.painel.slug, pdfFalso('v1'));
    const envioUid = novoUid();
    const corpo = {
      uid: envioUid,
      pdfUid: pdfV1,
      painelId: c.painel.id,
      projetoUid: c.projetoUid,
      tipo: 'montagem',
      geradoEm: Date.now(),
      documento: documento(c, [{ uid: foto1, tamanho: bytesFoto1.length }]),
    };
    const passo1 = await montador.ok('POST', '/api/verificacoes', corpo);
    assert.deepEqual(passo1.faltando, [foto1]);
    assert.equal(passo1.verificacao.estado, 'recebendo');

    // Sem a foto, não conclui.
    const cedo = await montador.pedir('POST', `/api/verificacoes/${envioUid}/concluir`, {});
    assert.equal(cedo.status, 409);
    assert.equal(cedo.dados.codigo, 'faltam-fotos');

    // Foto adulterada no caminho é recusada.
    const errada = await montador.enviarArquivo(
      `/api/verificacoes/${envioUid}/midias/${foto1}?sha256=${sha256(jpegFalso('outra'))}`,
      bytesFoto1,
      'image/jpeg',
    );
    assert.equal(errada.status, 422);

    const foto = await montador.enviarArquivo(
      `/api/verificacoes/${envioUid}/midias/${foto1}?sha256=${sha256(bytesFoto1)}`,
      bytesFoto1,
      'image/jpeg',
    );
    assert.equal(foto.status, 200);

    const fim = await montador.ok('POST', `/api/verificacoes/${envioUid}/concluir`, {});
    assert.equal(fim.verificacao.estado, 'aguardando');
    assert.equal(fim.verificacao.versao, 1);
    idV1 = fim.verificacao.id;

    // Repetir os passos (resposta perdida na rede) não duplica nada.
    const repetido = await montador.ok('POST', '/api/verificacoes', corpo);
    assert.equal(repetido.verificacao.id, idV1);
    assert.deepEqual(repetido.faltando, []);
    const outraVez = await montador.ok('POST', `/api/verificacoes/${envioUid}/concluir`, {});
    assert.equal(outraVez.verificacao.versao, 1);

    // O mesmo PDF não vira um segundo envio.
    const dobrado = await montador.pedir('POST', '/api/verificacoes', { ...corpo, uid: novoUid() });
    assert.equal(dobrado.status, 409);
  });

  it('mostra o envio na fila do administrador, com retrato, checklist, foto e PDF', async () => {
    const resumo = await admin.ok('GET', '/api/admin/resumo');
    assert.equal(resumo.verificacoesPendentes, 1);

    const fila = await admin.ok('GET', '/api/admin/verificacoes');
    assert.equal(fila.total, 1);
    assert.equal(fila.itens[0].id, idV1);
    assert.equal(fila.itens[0].montador.nome, 'Carlos Silva');
    assert.ok(fila.itens[0].progresso.total > 0);

    const detalhe = await admin.ok('GET', `/api/admin/verificacoes/${idV1}`);
    assert.ok(detalhe.definicoes[c.formId], 'a definição do checklist vem junto');
    assert.equal(detalhe.midias[0].situacao, 'recebida');
    assert.equal(detalhe.pdf.uid, pdfV1);
    assert.equal(detalhe.verificacao.documento.preenchimentos[0].respostas[c.etapa].valor, true);

    const foto = await admin.baixar(`/api/admin/midias/${foto1}`);
    assert.equal(foto.status, 200);
    assert.ok(foto.bytes.equals(bytesFoto1));

    // O montador não entra na administração.
    assert.equal((await montador.pedir('GET', '/api/admin/verificacoes')).status, 403);
  });

  it('reprova marcando as etapas, com validação, e a decisão é definitiva', async () => {
    const url = `/api/admin/verificacoes/${idV1}/decisao`;
    assert.equal((await admin.pedir('POST', url, { decisao: 'reprovada' })).status, 400);
    const tagErrada = await admin.pedir('POST', url, {
      decisao: 'reprovada',
      itens: [{ tagUid: novoUid(), formId: c.formId, etapaId: c.etapa, motivo: 'x' }],
    });
    assert.equal(tagErrada.status, 400);
    const etapaErrada = await admin.pedir('POST', url, {
      decisao: 'reprovada',
      itens: [{ tagUid: c.tags.a, formId: c.formId, etapaId: 'ZZ9.9', motivo: 'x' }],
    });
    assert.equal(etapaErrada.status, 400);
    const semMotivo = await admin.pedir('POST', url, {
      decisao: 'reprovada',
      itens: [{ tagUid: c.tags.a, formId: c.formId, etapaId: c.etapa, motivo: '   ' }],
    });
    assert.equal(semMotivo.status, 400);

    const r = await admin.ok('POST', url, {
      decisao: 'reprovada',
      comentario: 'Refazer as fotos com mais luz.',
      itens: [
        { tagUid: c.tags.a, formId: c.formId, etapaId: c.etapa, motivo: 'A foto não está nítida.' },
        { tagUid: c.tags.b, formId: c.formId, etapaId: '__cabecalho__', motivo: 'Tensão de operação em branco.' },
      ],
    });
    assert.equal(r.verificacao.estado, 'reprovada');
    assert.equal(r.verificacao.itens[0].tagNome, 'QGBT-01');
    assert.ok(r.verificacao.itens[0].etapaCodigo);
    assert.equal(r.verificacao.itens[1].etapaCodigo, 'Dados do painel');

    assert.equal((await admin.pedir('POST', url, { decisao: 'aprovada' })).status, 409);

    // O montador vê a reprovação, com o que tinha enviado em cada etapa.
    const { verificacoes } = await montador.ok('GET', '/api/verificacoes');
    assert.equal(verificacoes.length, 1);
    assert.equal(verificacoes[0].estado, 'reprovada');
    assert.equal(verificacoes[0].comentario, 'Refazer as fotos com mais luz.');
    assert.equal(verificacoes[0].itens[0].motivo, 'A foto não está nítida.');
    assert.equal(verificacoes[0].itens[0].enviado.resposta.valor, true);
    assert.deepEqual(verificacoes[0].itens[0].enviado.midias, [foto1]);
    assert.deepEqual(verificacoes[0].itens[1].enviado.cabecalho, {});
  });

  it('versão nova substitui a que aguardava; aprovar fecha o ciclo', async () => {
    // Uma foto sincronizada pelo projeto entra no envio sem subir de novo.
    const foto2 = novoUid();
    const bytesFoto2 = jpegFalso('foto 2 sincronizada');
    const doc = documento(c, [{ uid: foto2, tamanho: bytesFoto2.length }]);
    const sync = await montador.ok('PUT', `/api/sync/projetos/${c.projetoUid}`, {
      versaoBase: 0,
      painelId: c.painel.id,
      documento: doc,
    });
    assert.deepEqual(sync.faltando, [foto2]);
    const subida = await montador.enviarArquivo(
      `/api/sync/midias/${foto2}?projeto=${c.projetoUid}`,
      bytesFoto2,
      'image/jpeg',
    );
    assert.equal(subida.status, 200);

    const v2 = await enviarParaAprovacao(
      montador,
      c,
      await enviarPdf(montador, c.painel.slug, pdfFalso('v2')),
      new Map([[foto2, bytesFoto2]]),
    );
    assert.deepEqual(v2.passo1.faltando, [], 'a foto sincronizada já estava no servidor');
    assert.equal(v2.verificacao.versao, 2);

    const v3 = await enviarParaAprovacao(
      montador,
      c,
      await enviarPdf(montador, c.painel.slug, pdfFalso('v3')),
      new Map([[foto1, bytesFoto1]]),
    );
    assert.equal(v3.verificacao.versao, 3);

    const detalheV2 = await admin.ok('GET', `/api/admin/verificacoes/${v2.verificacao.id}`);
    assert.equal(detalheV2.verificacao.estado, 'substituida');
    assert.equal(detalheV2.versoes.length, 3);
    assert.equal(
      (await admin.pedir('POST', `/api/admin/verificacoes/${v2.verificacao.id}/decisao`, { decisao: 'aprovada' })).status,
      409,
    );

    // Aprovar não aceita etapas marcadas.
    const contraditoria = await admin.pedir('POST', `/api/admin/verificacoes/${v3.verificacao.id}/decisao`, {
      decisao: 'aprovada',
      itens: [{ tagUid: c.tags.a, formId: c.formId, etapaId: c.etapa, motivo: 'x' }],
    });
    assert.equal(contraditoria.status, 400);
    const aprovada = await admin.ok('POST', `/api/admin/verificacoes/${v3.verificacao.id}/decisao`, {
      decisao: 'aprovada',
    });
    assert.equal(aprovada.verificacao.estado, 'aprovada');

    const { verificacoes } = await montador.ok('GET', '/api/verificacoes');
    assert.equal(verificacoes[0].estado, 'aprovada');
    assert.equal(verificacoes[0].ultimaAprovada.versao, 3);

    // O montador tira a foto 2 do projeto: o registro de sincronização sai,
    // mas o arquivo fica — ele é citado no envio da versão 2.
    const semFoto = documento(c, []);
    await montador.ok('PUT', `/api/sync/projetos/${c.projetoUid}`, {
      versaoBase: sync.versao,
      painelId: c.painel.id,
      documento: semFoto,
    });
    assert.ok(existsSync(join(amb.dados, 'midias', foto2)), 'foto citada num envio não vai para a lixeira');
    const foto = await admin.baixar(`/api/admin/midias/${foto2}`);
    assert.equal(foto.status, 200);
    assert.ok(foto.bytes.equals(bytesFoto2));
  });

  it('busca os documentos por texto, categoria e situação', async () => {
    const todos = await admin.ok('GET', '/api/admin/documentos?busca=paineis%20acao%20qgbt');
    assert.equal(todos.total, 3);
    assert.ok(todos.documentos.every((d: { categoria: string }) => d.categoria === 'verificacao'));
    const aprovados = await admin.ok('GET', '/api/admin/documentos?situacao=aprovada&categoria=verificacao');
    assert.equal(aprovados.total, 1);
    assert.equal(aprovados.documentos[0].versao, 3);
    const nada = await admin.ok('GET', '/api/admin/documentos?busca=inexistente');
    assert.equal(nada.total, 0);
  });

  it('o banco recusa apagar ou alterar documentos e decisões', () => {
    const db = new DatabaseSync(join(amb.dados, 'acesso.db'));
    try {
      assert.throws(() => db.exec('DELETE FROM pdfs_emitidos'), /não pode ser apagado/);
      assert.throws(() => db.exec('DELETE FROM verificacoes'), /não pode ser apagado/);
      assert.throws(() => db.exec('DELETE FROM midias_protegidas'), /não pode ser apagada/);
      assert.throws(() => db.exec("UPDATE pdfs_emitidos SET sha256 = 'x'"), /não pode ser alterado/);
      assert.throws(
        () => db.exec("UPDATE verificacoes SET estado = 'aguardando' WHERE estado = 'aprovada'"),
        /definitiva/,
      );
      assert.throws(() => db.exec("UPDATE verificacoes SET documento = '{}'"), /não pode ser alterada/);
    } finally {
      db.close();
    }
  });

  it('excluir a conta do montador não leva nenhum documento', async () => {
    await admin.ok('DELETE', `/api/admin/contas/${montador.usuario!.id}`);
    const fila = await admin.ok('GET', '/api/admin/verificacoes?estado=todas');
    assert.equal(fila.total, 3);
    assert.equal(fila.itens[0].montador.id, null);
    assert.equal(fila.itens[0].montador.nome, 'Carlos Silva');
    const pdf = await admin.baixar(`/api/admin/pdfs/${pdfV1}/arquivo`);
    assert.equal(pdf.status, 200);
    assert.ok(pdf.bytes.equals(pdfFalso('v1')));
    assert.equal((await admin.baixar(`/api/admin/midias/${foto1}`)).status, 200);
    const busca = await admin.ok('GET', '/api/admin/documentos?busca=carlos');
    assert.equal(busca.total, 3);
  });
});

describe('certificação devolvida por itens e aprovada com o certificado anexado', () => {
  let amb: Ambiente;
  let admin: Cliente;
  let montador: Cliente;
  let outro: Cliente;
  let painel: PainelDeTeste;
  let formId = '';
  let etapa = '';
  const certUid = novoUid();
  const fotoC = novoUid();
  const bytesFotoC = jpegFalso('foto do ensaio');
  let idSolicitacao = 0;
  const certificado = pdfFalso('certificado assinado');

  function corpo(versaoBase: number) {
    return {
      versaoBase,
      painelId: painel.id,
      formId,
      criadoEm: Date.now(),
      dados: { projeto: 'Usina Sol', tagPainel: 'QD-07', clienteFinal: 'Energia SA', empresa: 'Parceiro X', montador: 'Ana' },
      preenchimento: { formRevisao: 'rev00', cabecalho: {}, respostas: { [etapa]: { valor: true } } },
      midias: [
        { uid: fotoC, etapaId: etapa, mime: 'image/jpeg', largura: 10, altura: 10, tamanho: bytesFotoC.length, criadoEm: Date.now(), ordem: 0 },
      ],
    };
  }

  before(async () => {
    amb = await subirServidor();
    admin = await entrarComoAdmin(amb.url);
    montador = await novoMontador(amb.url, admin, 'ana@parceiro.local', 'Ana Souza');
    outro = await novoMontador(amb.url, admin, 'bruno@parceiro.local', 'Bruno');
    painel = await painelPorSlug(montador, 'system-pro-e-power');
    const emite = painel.formularios.find((f) => f.definicao.emiteCertificado)!;
    formId = emite.id;
    etapa = primeiraEtapa(emite.definicao);

    const r = await montador.ok('PUT', `/api/certificacoes/${certUid}`, corpo(0));
    assert.deepEqual(r.faltando, [fotoC]);
    const foto = await montador.enviarArquivo(`/api/sync/midias/${fotoC}?projeto=${certUid}`, bytesFotoC, 'image/jpeg');
    assert.equal(foto.status, 200);
    await montador.ok('POST', `/api/certificacoes/${certUid}/enviar`, {});
    const { itens } = await admin.ok('GET', '/api/admin/certificacoes?estado=enviada');
    idSolicitacao = itens[0].id;
  });

  after(async () => {
    await amb?.encerrar();
  });

  it('mostra a solicitação inteira para a análise', async () => {
    const r = await admin.ok('GET', `/api/admin/certificacoes/${idSolicitacao}`);
    assert.equal(r.definicao.id, formId);
    assert.equal(r.solicitacao.midias[0].recebida, true);
    assert.equal(r.solicitacao.dados.tagPainel, 'QD-07');
    assert.equal(r.solicitacao.montador.nome, 'Ana Souza');
  });

  it('devolve marcando a etapa, e o reenvio limpa os itens', async () => {
    const url = `/api/admin/certificacoes/${idSolicitacao}/devolver`;
    assert.equal((await admin.pedir('POST', url, {})).status, 400);
    await admin.ok('POST', url, {
      apontamentos: 'Confira a medição.',
      itens: [{ formId, etapaId: etapa, motivo: 'Falta a foto do aterramento.' }],
    });
    let { solicitacoes } = await montador.ok('GET', '/api/certificacoes');
    assert.equal(solicitacoes[0].estado, 'devolvida');
    assert.equal(solicitacoes[0].itens[0].motivo, 'Falta a foto do aterramento.');
    assert.equal(solicitacoes[0].itens[0].tagNome, 'QD-07');
    assert.equal(solicitacoes[0].apontamentos, 'Confira a medição.');
    assert.equal(solicitacoes[0].historico.at(-1).itens.length, 1);

    await montador.ok('PUT', `/api/certificacoes/${certUid}`, corpo(1));
    await montador.ok('POST', `/api/certificacoes/${certUid}/enviar`, {});
    ({ solicitacoes } = await montador.ok('GET', '/api/certificacoes'));
    assert.equal(solicitacoes[0].estado, 'enviada');
    assert.deepEqual(solicitacoes[0].itens, []);

    // Decisão tomada sobre uma versão que já mudou é recusada.
    const versaoAtual = solicitacoes[0].versao as number;
    const desatualizada = await admin.pedir('POST', url, {
      versao: versaoAtual - 1,
      apontamentos: 'Analisei a versão antiga.',
    });
    assert.equal(desatualizada.status, 409);
    assert.equal(desatualizada.dados.codigo, 'versao-mudou');
    const aprovacaoVelha = await admin.enviarArquivo(
      `/api/admin/certificacoes/${idSolicitacao}/aprovacao?versao=${versaoAtual - 1}`,
      certificado,
      'application/pdf',
    );
    assert.equal(aprovacaoVelha.status, 409);
  });

  it('aprovar exige o arquivo do certificado, conferido', async () => {
    const url = `/api/admin/certificacoes/${idSolicitacao}/aprovacao`;
    assert.equal((await admin.enviarArquivo(url, Buffer.alloc(0), 'application/pdf')).status, 400);
    assert.equal((await admin.enviarArquivo(url, Buffer.from('texto'), 'text/plain')).status, 400);
    assert.equal((await admin.enviarArquivo(url, Buffer.from('não é pdf'), 'application/pdf')).status, 400);
    const adulterado = await admin.enviarArquivo(`${url}?sha256=${sha256(pdfFalso('outro'))}`, certificado, 'application/pdf');
    assert.equal(adulterado.status, 422);
    // A solicitação continua aguardando depois das tentativas recusadas.
    const { solicitacoes: antes } = await montador.ok('GET', '/api/certificacoes');
    assert.equal(antes[0].estado, 'enviada');

    const ok = await admin.enviarArquivo(
      `${url}?nomeArquivo=${encodeURIComponent('Certificado QD-07.pdf')}&sha256=${sha256(certificado)}`,
      certificado,
      'application/pdf',
    );
    assert.equal(ok.status, 200, JSON.stringify(ok.dados));
    assert.match(ok.dados.numero, /^\d{4}$/);
    assert.equal(ok.dados.anexo.nomeArquivo, 'Certificado QD-07.pdf');

    // Aprovada uma vez, não se aprova de novo.
    assert.equal((await admin.enviarArquivo(url, certificado, 'application/pdf')).status, 409);
  });

  it('o montador baixa o certificado; outra conta não', async () => {
    const { solicitacoes } = await montador.ok('GET', '/api/certificacoes');
    const anexo = solicitacoes[0].anexos[0];
    assert.equal(solicitacoes[0].estado, 'aprovada');
    const baixado = await montador.baixar(`/api/certificacoes/${certUid}/certificados/${anexo.uid}`);
    assert.equal(baixado.status, 200);
    assert.ok(baixado.bytes.equals(certificado));
    assert.equal(baixado.tipo, 'application/pdf');
    assert.equal(
      (await outro.baixar(`/api/certificacoes/${certUid}/certificados/${anexo.uid}`)).status,
      404,
    );

    // Uma via nova anexada depois: as duas ficam guardadas.
    const via2 = pdfFalso('via assinada');
    const r = await admin.enviarArquivo(
      `/api/admin/certificacoes/${idSolicitacao}/certificado?nomeArquivo=via2.pdf&sha256=${sha256(via2)}`,
      via2,
      'application/pdf',
    );
    assert.equal(r.status, 200);
    const depois = await montador.ok('GET', '/api/certificacoes');
    assert.equal(depois.solicitacoes[0].anexos.length, 2);
  });

  it('o uid de um certificado não serve para sobrescrevê-lo como PDF emitido', async () => {
    const { solicitacoes } = await montador.ok('GET', '/api/certificacoes');
    const anexo = solicitacoes[0].anexos.find((a: { nomeArquivo: string }) => a.nomeArquivo === 'Certificado QD-07.pdf');
    const forjado = pdfFalso('certificado forjado');
    const r = await montador.enviarArquivo(
      `/api/pdfs/${anexo.uid}?titulo=x&nomeArquivo=x.pdf&emitidoEm=${Date.now()}`,
      forjado,
      'application/pdf',
    );
    assert.equal(r.status, 409);
    const baixado = await montador.baixar(`/api/certificacoes/${certUid}/certificados/${anexo.uid}`);
    assert.ok(baixado.bytes.equals(certificado));
  });

  it('a busca encontra o certificado pelo número, e nada se perde ao excluir a conta', async () => {
    const { solicitacoes } = await montador.ok('GET', '/api/certificacoes');
    const numero = solicitacoes[0].numero as string;
    const busca = await admin.ok('GET', `/api/admin/documentos?categoria=certificado&busca=${numero}`);
    assert.equal(busca.total, 2);
    assert.equal(busca.documentos[0].numero, numero);

    const db = new DatabaseSync(join(amb.dados, 'acesso.db'));
    try {
      const protegida = db
        .prepare("SELECT situacao FROM midias_protegidas WHERE origem = 'certificacao' AND uid = ?")
        .get(fotoC) as { situacao: string };
      assert.equal(protegida.situacao, 'recebida');
    } finally {
      db.close();
    }

    await admin.ok('DELETE', `/api/admin/contas/${montador.usuario!.id}`);
    const { certificados } = await admin.ok('GET', '/api/admin/certificados');
    assert.equal(certificados[0].numero, numero, 'o registro da emissão continua');
    assert.ok(certificados[0].anexo);
    const arquivo = await admin.baixar(`/api/admin/certificados/${busca.documentos[1].uid}/arquivo`);
    assert.equal(arquivo.status, 200);
    assert.ok(existsSync(join(amb.dados, 'midias', fotoC)), 'a foto da certificação aprovada fica');
  });
});

describe('backup externo e integridade dos documentos', () => {
  let amb: Ambiente;
  let admin: Cliente;
  let montador: Cliente;
  const conteudo = pdfFalso('documento de garantia');
  let uid = '';

  before(async () => {
    amb = await subirServidor();
    admin = await entrarComoAdmin(amb.url);
    montador = await novoMontador(amb.url, admin, 'dani@parceiro.local');
    uid = await enviarPdf(montador, 'sen-plus', conteudo);
  });

  after(async () => {
    await amb?.encerrar();
  });

  it('copia o documento para a pasta de backup e para o destino externo', async () => {
    await admin.ok('POST', '/api/admin/sistema/backup', {});
    assert.ok(readFileSync(join(amb.dados, 'backups', 'midias', uid)).equals(conteudo));
    assert.ok(readFileSync(join(amb.destino, 'midias', uid)).equals(conteudo));
    const { armazenamento } = await admin.ok('GET', '/api/admin/sistema');
    const destino = armazenamento.destinos.find((d: { externo: boolean }) => d.externo);
    assert.ok(destino.ultimoSucesso);
  });

  it('a verificação repara o documento corrompido e a cópia estragada', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(amb.dados, 'midias', uid), 'bits trocados');
    writeFileSync(join(amb.destino, 'midias', uid), 'cópia estragada');
    const { verificacao } = await admin.ok('POST', '/api/admin/sistema/verificacao', {});
    assert.equal(verificacao.ok, true);
    assert.ok(verificacao.reparados >= 2, JSON.stringify(verificacao));
    assert.ok(readFileSync(join(amb.dados, 'midias', uid)).equals(conteudo));
    assert.ok(readFileSync(join(amb.destino, 'midias', uid)).equals(conteudo));
  });

  it('um documento que sumiu do disco volta do backup ao ser lido', async () => {
    const { rmSync } = await import('node:fs');
    rmSync(join(amb.dados, 'midias', uid));
    const r = await admin.baixar(`/api/admin/pdfs/${uid}/arquivo`);
    assert.equal(r.status, 200);
    assert.ok(r.bytes.equals(conteudo));
  });

  it('sem cópia íntegra em lugar nenhum, a verificação acusa', async () => {
    const { writeFileSync } = await import('node:fs');
    for (const pasta of [join(amb.dados, 'midias'), join(amb.dados, 'backups', 'midias'), join(amb.destino, 'midias')]) {
      writeFileSync(join(pasta, uid), 'tudo estragado');
    }
    const { verificacao, armazenamento } = await admin.ok('POST', '/api/admin/sistema/verificacao', {});
    assert.equal(verificacao.ok, false);
    assert.equal(verificacao.semReparo, 1);
    assert.ok(armazenamento.alertas.some((a: { nivel: string }) => a.nivel === 'erro'));
    const busca = await admin.ok('GET', '/api/admin/documentos');
    assert.equal(busca.documentos[0].integridade.situacao, 'corrompido');
  });
});

describe('espelho do backup', () => {
  it('sem a pasta das mídias, nada sai do espelho; foto registrada que sumiu continua lá', async () => {
    const amb = await subirServidor();
    try {
      const { renameSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
      const admin = await entrarComoAdmin(amb.url);
      const montador = await novoMontador(amb.url, admin, 'fabi@parceiro.local');
      const uid = await enviarPdf(montador, 'sen-plus', pdfFalso('guardado'));
      // Arquivo sem registro nenhum, copiado para o espelho.
      const avulso = novoUid();
      writeFileSync(join(amb.dados, 'midias', avulso), 'sem registro');
      await admin.ok('POST', '/api/admin/sistema/backup', {});
      const espelho = join(amb.destino, 'midias');
      assert.ok(existsSync(join(espelho, uid)) && existsSync(join(espelho, avulso)));

      // Disco das mídias fora do ar: o backup não poda nada.
      renameSync(join(amb.dados, 'midias'), join(amb.dados, 'midias-fora'));
      rmSync(join(amb.dados, 'midias-excluidas'), { recursive: true, force: true });
      // O backup manual leva a hora no nome: um por segundo.
      await new Promise((r) => setTimeout(r, 1100));
      await admin.ok('POST', '/api/admin/sistema/backup', {});
      assert.ok(existsSync(join(espelho, avulso)), 'o espelho não perde nada com a pasta fora do ar');
      const { armazenamento } = await admin.ok('GET', '/api/admin/sistema');
      assert.ok(armazenamento.alertas.some((a: { nivel: string }) => a.nivel === 'erro'));

      // De volta, vazia: o que tem registro fica; o avulso, que saiu de vez, sai.
      mkdirSync(join(amb.dados, 'midias'));
      await new Promise((r) => setTimeout(r, 1100));
      await admin.ok('POST', '/api/admin/sistema/backup', {});
      assert.ok(existsSync(join(espelho, uid)), 'documento continua no espelho');
      assert.ok(!existsSync(join(espelho, avulso)));
    } finally {
      await amb.encerrar();
    }
  });
});

describe('encerramento do servidor', () => {
  it('o backup que esperava o atraso roda antes de o servidor sair', async () => {
    // Atraso longo: sem o encerramento, a cópia só sairia daqui a dez minutos.
    const amb = await subirServidor({ BACKUP_ATRASO_MS: '600000' });
    try {
      const admin = await entrarComoAdmin(amb.url);
      const montador = await novoMontador(amb.url, admin, 'eva@parceiro.local');
      const conteudo = pdfFalso('chegou antes de desligar');
      const uid = await enviarPdf(montador, 'sen-plus', conteudo);
      assert.ok(!existsSync(join(amb.destino, 'midias', uid)), 'ainda não copiado');
      await amb.parar();
      assert.ok(readFileSync(join(amb.destino, 'midias', uid)).equals(conteudo));
      assert.ok(readFileSync(join(amb.dados, 'backups', 'midias', uid)).equals(conteudo));
    } finally {
      await amb.encerrar();
    }
  });
});

describe('alertas de backup e migração do registro de certificados', () => {
  it('sem destino externo, a tela Sistema alerta', async () => {
    const amb = await subirServidor({ BACKUP_DESTINOS: '' });
    try {
      const admin = await entrarComoAdmin(amb.url);
      const { armazenamento } = await admin.ok('GET', '/api/admin/sistema');
      assert.ok(
        armazenamento.alertas.some((a: { nivel: string; mensagem: string }) => a.nivel === 'erro' && /fora do disco/.test(a.mensagem)),
      );
    } finally {
      await amb.encerrar();
    }
  });

  it('um banco antigo perde a cascata que apagava o registro do certificado', async () => {
    const { mkdtempSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const pasta = mkdtempSync(join(tmpdir(), 'verificacao-legado-'));
    mkdirSync(join(pasta, 'dados'));
    // Só a tabela do formato antigo: o resto o servidor cria ao subir.
    const antigo = new DatabaseSync(join(pasta, 'dados', 'acesso.db'), { enableForeignKeyConstraints: false });
    antigo.exec(`CREATE TABLE certificados (
      numero TEXT PRIMARY KEY,
      certificacaoId INTEGER NOT NULL REFERENCES certificacoes(id) ON DELETE CASCADE,
      painelSlug TEXT NOT NULL, nomePainel TEXT NOT NULL, projeto TEXT NOT NULL, tagPainel TEXT NOT NULL,
      clienteFinal TEXT NOT NULL, montador TEXT NOT NULL, correnteNominal TEXT NOT NULL,
      correnteCurtoCircuito TEXT NOT NULL, responsavel TEXT NOT NULL, emitidoEm INTEGER NOT NULL)`);
    antigo.exec(`INSERT INTO certificados VALUES ('0001', 7, 'safr', 'SAFR', 'P', 'T', 'C', 'M', '1', '2', 'R', 1)`);
    antigo.close();

    const amb = await subirServidor({ BANCO: join(pasta, 'dados', 'acesso.db') });
    try {
      const db = new DatabaseSync(join(pasta, 'dados', 'acesso.db'));
      const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'certificados'").get() as { sql: string };
      const linha = db.prepare("SELECT numero FROM certificados WHERE numero = '0001'").get();
      db.close();
      assert.doesNotMatch(sql, /CASCADE/);
      assert.ok(linha, 'as linhas antigas foram preservadas');
    } finally {
      await amb.encerrar();
      const { rmSync } = await import('node:fs');
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});
