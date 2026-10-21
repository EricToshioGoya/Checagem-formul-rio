import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  entrarComoAdmin,
  novoMontador,
  novoUid,
  painelPorSlug,
  pdfFalso,
  sha256,
  subirServidor,
  type Ambiente,
  type Cliente,
} from './apoio';

/**
 * Checklist que contém certificado: o modelo em PDF enviado pela
 * administração, o envio do checklist completo (uma TAG), a aba Certificados
 * e a emissão com código único, carimbado no modelo.
 */

const PADRAO_CODIGO = /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

async function modeloPdf(paginas = 2): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) d.addPage([595, 842]);
  d.setTitle('Modelo');
  return Buffer.from(await d.save());
}

/** Definição mínima: uma seção, duas etapas de conferir. */
function definicao(id: string, nome: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    nome,
    linhaProduto: 'SEN Plus',
    tipo: 'montagem',
    revisao: 'rev00',
    dataRevisao: '2026-10-19',
    cabecalho: [],
    secoes: [
      {
        id: 'S1',
        titulo: 'Conferência final',
        etapas: [
          { id: 'S1.1', descricao: 'Barramentos apertados', tipoResposta: 'check', ativa: true, observacao: true },
          { id: 'S1.2', descricao: 'Identificação dos circuitos', tipoResposta: 'check', ativa: true, observacao: true },
        ],
      },
    ],
    ...extra,
  };
}

async function enviarPdf(montador: Cliente, painelSlug: string) {
  const uid = novoUid();
  const conteudo = pdfFalso(`checklist ${uid}`);
  const consulta = new URLSearchParams({
    empresa: 'Painéis Ação Ltda',
    projeto: 'Linha 9',
    titulo: 'Checklist com certificado',
    painel: painelSlug,
    nomeArquivo: 'LINHA-9_QGBT.pdf',
    emitidoEm: String(Date.now()),
    sha256: sha256(conteudo),
  });
  const r = await montador.enviarArquivo(`/api/pdfs/${uid}?${consulta}`, conteudo, 'application/pdf');
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  return uid;
}

describe('checklist que contém certificado', () => {
  let amb: Ambiente;
  let admin: Cliente;
  let montador: Cliente;
  let outro: Cliente;
  let painel: { id: number; slug: string };
  let formId = '';
  let semModelo = '';
  let modeloUid = '';
  const modeloBytes: { pdf: Buffer } = { pdf: Buffer.alloc(0) };
  const projetoUid = novoUid();
  const tagUid = novoUid();
  let envioV2 = '';
  let idV2 = 0;
  let codigo = '';

  before(async () => {
    amb = await subirServidor();
    admin = await entrarComoAdmin(amb.url);
    montador = await novoMontador(amb.url, admin, 'gil@parceiro.local', 'Gil Souza');
    outro = await novoMontador(amb.url, admin, 'hugo@parceiro.local', 'Hugo');
    painel = await painelPorSlug(montador, 'sen-plus');
    const criado = await admin.ok('POST', `/api/admin/paineis/${painel.id}/formularios`, {
      tipo: 'montagem',
      nome: 'Inspeção final com certificado',
    });
    formId = criado.formulario.id;
    const criado2 = await admin.ok('POST', `/api/admin/paineis/${painel.id}/formularios`, {
      tipo: 'montagem',
      nome: 'Sem modelo ainda',
    });
    semModelo = criado2.formulario.id;
    modeloBytes.pdf = await modeloPdf(2);
  });

  after(async () => {
    await amb?.encerrar();
  });

  /** Retrato de uma TAG com o checklist, completo ou não. */
  function corpo(envioUid: string, pdfUid: string, completo: boolean, form = formId, tag = tagUid) {
    const agora = Date.now();
    return {
      uid: envioUid,
      pdfUid,
      painelId: painel.id,
      projetoUid,
      tipo: 'montagem',
      geradoEm: agora,
      certificado: { tagUid: tag, formId: form },
      documento: {
        projeto: { empresa: 'Painéis Ação Ltda', nomeProjeto: 'Linha 9', operador: 'Gil', criadoEm: agora, atualizadoEm: agora },
        tags: [{ uid: tag, nome: 'QGBT-09', ordem: 0, formIds: [form] }],
        preenchimentos: [
          {
            tagUid: tag,
            formId: form,
            formRevisao: 'rev00',
            cabecalho: { clienteFinal: 'Cliente Z' },
            respostas: completo
              ? { 'S1.1': { valor: true }, 'S1.2': { valor: true, observacao: 'ok' } }
              : { 'S1.1': { valor: true } },
            atualizadoEm: agora,
          },
        ],
        midias: [],
      },
    };
  }

  it('o modelo do certificado tem de ser um PDF que abre', async () => {
    const url = (uid: string, b: Buffer) => `/api/admin/modelos-certificado/${uid}?nomeArquivo=Modelo%20ABB.pdf&sha256=${sha256(b)}`;
    assert.equal((await admin.enviarArquivo(url(novoUid(), Buffer.from('x')), Buffer.from('x'), 'text/plain')).status, 400);
    const falso = pdfFalso('não abre');
    assert.equal((await admin.enviarArquivo(url(novoUid(), falso), falso, 'application/pdf')).status, 400);
    assert.equal(
      (await montador.enviarArquivo(url(novoUid(), modeloBytes.pdf), modeloBytes.pdf, 'application/pdf')).status,
      403,
    );

    modeloUid = novoUid();
    const r = await admin.enviarArquivo(url(modeloUid, modeloBytes.pdf), modeloBytes.pdf, 'application/pdf');
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.modelo.paginas, 2);
    assert.equal(r.dados.modelo.nomeArquivo, 'Modelo ABB.pdf');
    const baixado = await admin.baixar(`/api/admin/modelos-certificado/${modeloUid}`);
    assert.ok(baixado.bytes.equals(modeloBytes.pdf));
  });

  it('o checklist só cita um modelo enviado', async () => {
    const r = await admin.pedir('PUT', `/api/admin/formularios/${formId}`, {
      nome: 'Inspeção final com certificado',
      ativo: true,
      definicao: definicao(formId, 'Inspeção final com certificado', {
        emiteCertificado: true,
        modeloCertificado: { uid: novoUid(), nomeArquivo: 'x.pdf' },
      }),
    });
    assert.equal(r.status, 400);
    await admin.ok('PUT', `/api/admin/formularios/${formId}`, {
      nome: 'Inspeção final com certificado',
      ativo: true,
      definicao: definicao(formId, 'Inspeção final com certificado', {
        emiteCertificado: true,
        modeloCertificado: { uid: modeloUid, nomeArquivo: 'Modelo ABB.pdf', paginas: 2 },
      }),
    });
    // "Contém certificado" sem modelo ainda: grava (o editor salva a cada pausa).
    await admin.ok('PUT', `/api/admin/formularios/${semModelo}`, {
      nome: 'Sem modelo ainda',
      ativo: true,
      definicao: definicao(semModelo, 'Sem modelo ainda', { emiteCertificado: true }),
    });
    const { formularios } = await montador.ok('GET', `/api/paineis/${painel.id}/formularios`);
    const meu = (formularios as Array<{ id: string; emiteCertificado: boolean; temModeloCertificado: boolean }>).find(
      (f) => f.id === formId,
    );
    assert.equal(meu?.emiteCertificado, true);
    assert.equal(meu?.temModeloCertificado, true);
  });

  it('só o checklist completo e com modelo vai para a aba Certificados', async () => {
    const incompleto = await montador.pedir('POST', '/api/verificacoes', corpo(novoUid(), await enviarPdf(montador, painel.slug), false));
    assert.equal(incompleto.status, 409);
    assert.equal(incompleto.dados.codigo, 'checklist-incompleto');

    const sem = await montador.pedir(
      'POST',
      '/api/verificacoes',
      corpo(novoUid(), await enviarPdf(montador, painel.slug), true, semModelo),
    );
    assert.equal(sem.status, 409);
    assert.equal(sem.dados.codigo, 'sem-modelo-certificado');

    const envio = novoUid();
    await montador.ok('POST', '/api/verificacoes', corpo(envio, await enviarPdf(montador, painel.slug), true));
    const fim = await montador.ok('POST', `/api/verificacoes/${envio}/concluir`, {});
    assert.equal(fim.verificacao.estado, 'aguardando');
    assert.equal(fim.verificacao.categoria, 'certificado');

    const certs = await admin.ok('GET', '/api/admin/verificacoes?categoria=certificado');
    assert.equal(certs.itens.length, 1);
    assert.equal(certs.itens[0].tipo.rotulo, 'Inspeção final com certificado');
    const verifs = await admin.ok('GET', '/api/admin/verificacoes');
    assert.equal(verifs.itens.length, 0, 'a aba Aprovações não mostra o checklist com certificado');
    const resumo = await admin.ok('GET', '/api/admin/resumo');
    assert.equal(resumo.certificadosPendentes, 1);
    assert.equal(resumo.verificacoesPendentes, 0);

    // Reprova marcando uma etapa; o montador vê a correção.
    await admin.ok('POST', `/api/admin/verificacoes/${certs.itens[0].id}/decisao`, {
      decisao: 'reprovada',
      itens: [{ tagUid, formId, etapaId: 'S1.2', motivo: 'Identificação ilegível.' }],
    });
    const { verificacoes } = await montador.ok('GET', '/api/verificacoes');
    assert.equal(verificacoes[0].estado, 'reprovada');
    assert.equal(verificacoes[0].categoria, 'certificado');
    assert.equal(verificacoes[0].certificado.tagUid, tagUid);
    assert.equal(verificacoes[0].itens[0].motivo, 'Identificação ilegível.');
  });

  it('aprovar emite o certificado do modelo, com código único', async () => {
    envioV2 = novoUid();
    await montador.ok('POST', '/api/verificacoes', corpo(envioV2, await enviarPdf(montador, painel.slug), true));
    const fim = await montador.ok('POST', `/api/verificacoes/${envioV2}/concluir`, {});
    assert.equal(fim.verificacao.versao, 2);
    idV2 = fim.verificacao.id;

    const r = await admin.ok('POST', `/api/admin/verificacoes/${idV2}/decisao`, { decisao: 'aprovada' });
    codigo = r.certificado.numero;
    assert.match(codigo, PADRAO_CODIGO);
    assert.equal(r.verificacao.certificado.numero, codigo);

    // Decisão definitiva: não se aprova de novo nem se troca o certificado.
    assert.equal((await admin.pedir('POST', `/api/admin/verificacoes/${idV2}/decisao`, { decisao: 'aprovada' })).status, 409);

    const detalhe = await admin.ok('GET', `/api/admin/verificacoes/${idV2}`);
    assert.equal(detalhe.certificadoEmitido.numero, codigo);

    const baixado = await montador.baixar(`/api/verificacoes/${envioV2}/certificado`);
    assert.equal(baixado.status, 200);
    assert.equal(baixado.tipo, 'application/pdf');
    const pdf = await PDFDocument.load(baixado.bytes);
    assert.equal(pdf.getPageCount(), 2, 'o certificado tem as páginas do modelo');
    assert.equal(pdf.getTitle(), `Certificado ${codigo}`);
    assert.ok(!baixado.bytes.equals(modeloBytes.pdf), 'o modelo recebeu o carimbo');

    assert.equal((await outro.baixar(`/api/verificacoes/${envioV2}/certificado`)).status, 404);
    const admBaixa = await admin.baixar(`/api/admin/certificados/${detalhe.certificadoEmitido.uid}/arquivo`);
    assert.ok(admBaixa.bytes.equals(baixado.bytes));

    const { verificacoes } = await montador.ok('GET', '/api/verificacoes');
    assert.equal(verificacoes[0].estado, 'aprovada');
    assert.equal(verificacoes[0].certificado.numero, codigo);
  });

  it('o certificado entra no registro e na busca de documentos pelo código', async () => {
    const { certificados } = await admin.ok('GET', '/api/admin/certificados');
    const registro = (certificados as Array<{ numero: string; tagPainel: string; anexo: unknown }>).find(
      (c) => c.numero === codigo,
    );
    assert.ok(registro);
    assert.equal(registro.tagPainel, 'QGBT-09');
    assert.ok(registro.anexo);
    // A busca vai ao registro inteiro, com ou sem o hífen do código.
    const achados = await admin.ok('GET', `/api/admin/certificados?busca=${codigo.replace('-', '').toLowerCase()}`);
    assert.deepEqual(
      (achados.certificados as Array<{ numero: string }>).map((c) => c.numero),
      [codigo],
    );
    assert.equal((await admin.ok('GET', '/api/admin/certificados?busca=nada-com-isso')).certificados.length, 0);

    const busca = await admin.ok('GET', `/api/admin/documentos?busca=${encodeURIComponent(codigo.toLowerCase())}`);
    assert.equal(busca.documentos.length, 1);
    assert.equal(busca.documentos[0].categoria, 'certificado');
    assert.equal(busca.documentos[0].envioCategoria, 'certificado');
    assert.equal(busca.documentos[0].verificacaoId, idV2);

    // O banco recusa apagar o modelo ou trocar o certificado do envio decidido.
    const { DatabaseSync } = await import('node:sqlite');
    const { join } = await import('node:path');
    const bd = new DatabaseSync(join(amb.dados, 'acesso.db'));
    try {
      assert.throws(() => bd.prepare('DELETE FROM modelos_certificado WHERE uid = ?').run(modeloUid));
      assert.throws(() => bd.prepare("UPDATE modelos_certificado SET nomeArquivo = 'x.pdf' WHERE uid = ?").run(modeloUid));
      assert.throws(() => bd.prepare("UPDATE verificacoes SET certificadoNumero = 'XXXX-XXXX' WHERE id = ?").run(idV2));
      // A exclusão da conta de quem enviou o modelo anula só o enviadoPor (LGPD).
      bd.prepare('UPDATE modelos_certificado SET enviadoPor = NULL WHERE uid = ?').run(modeloUid);
    } finally {
      bd.close();
    }
  });

  it('gerar o PDF de novo depois da aprovação não emite outro certificado', async () => {
    const envio = novoUid();
    const r = await montador.pedir('POST', '/api/verificacoes', corpo(envio, await enviarPdf(montador, painel.slug), true));
    assert.equal(r.status, 409);
    assert.equal(r.dados.codigo, 'certificado-ja-emitido');
    assert.ok(r.dados.erro.includes(codigo));

    const { verificacoes } = await montador.ok('GET', '/api/verificacoes');
    const doChecklist = (verificacoes as Array<{ certificado: { tagUid: string } | null; estado: string }>).filter(
      (v) => v.certificado?.tagUid === tagUid,
    );
    assert.equal(doChecklist.length, 1);
    assert.equal(doChecklist[0].estado, 'aprovada', 'o certificado continua à vista do montador');
  });

  it('o pedido aguardando ainda é aprovado se o checklist for excluído', async () => {
    const criado = await admin.ok('POST', `/api/admin/paineis/${painel.id}/formularios`, {
      tipo: 'montagem',
      nome: 'Checklist que será excluído',
    });
    const id = criado.formulario.id as string;
    await admin.ok('PUT', `/api/admin/formularios/${id}`, {
      nome: 'Checklist que será excluído',
      ativo: true,
      definicao: definicao(id, 'Checklist que será excluído', {
        emiteCertificado: true,
        modeloCertificado: { uid: modeloUid, nomeArquivo: 'Modelo ABB.pdf', paginas: 2 },
      }),
    });
    const envio = novoUid();
    await montador.ok('POST', '/api/verificacoes', corpo(envio, await enviarPdf(montador, painel.slug), true, id, novoUid()));
    const fim = await montador.ok('POST', `/api/verificacoes/${envio}/concluir`, {});
    await admin.ok('DELETE', `/api/admin/formularios/${id}`);

    const r = await admin.ok('POST', `/api/admin/verificacoes/${fim.verificacao.id}/decisao`, { decisao: 'aprovada' });
    assert.match(r.certificado.numero, PADRAO_CODIGO);
    assert.notEqual(r.certificado.numero, codigo, 'cada certificado tem o seu código');
  });

  it('o carimbo aceita TZ no formato POSIX e página girada', async () => {
    const { carimbarCertificado } = await import('../src/carimboCertificado');
    const { degrees } = await import('pdf-lib');
    const d = await PDFDocument.create();
    d.addPage([595, 842]).setRotation(degrees(90));
    const antes = process.env.TZ;
    process.env.TZ = ':/etc/localtime';
    try {
      const pdf = await carimbarCertificado(await d.save(), {
        codigo: 'ABCD-EFGH',
        emitidoEm: Date.now(),
        aprovadoPor: 'Ana',
        empresa: 'Ação',
        projeto: 'Linha 9',
        tag: 'QGBT-09',
        painel: 'SEN Plus',
        checklist: 'Inspeção',
        montador: 'Gil',
      });
      const lido = await PDFDocument.load(pdf);
      assert.equal(lido.getTitle(), 'Certificado ABCD-EFGH');
      assert.equal(lido.getPage(0).getRotation().angle, 90, 'o modelo continua girado');
    } finally {
      if (antes === undefined) delete process.env.TZ;
      else process.env.TZ = antes;
    }
  });

  it('editar o painel não exige o certificado das solicitações antigas', async () => {
    await admin.ok('PUT', `/api/admin/paineis/${painel.id}`, {
      nome: 'SEN Plus',
      responsaveis: [admin.usuario!.email],
    });
  });
});
