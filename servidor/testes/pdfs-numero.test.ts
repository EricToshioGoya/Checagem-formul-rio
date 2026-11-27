import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { codigoPdfValido, gerarCodigoPdf } from '../../compartilhado/codigoPdf';
import { entrarComoAdmin, novoMontador, novoUid, pdfFalso, sha256, subirServidor, type Ambiente, type Cliente } from './apoio';

/**
 * Número de identificação de cada PDF arquivado: o aparelho o manda no envio, o
 * servidor recusa repetido ou fora do formato, atribui um aos PDFs que chegam
 * sem ele e numera, na subida, os PDFs arquivados antes de o número existir.
 */

const REGISTRO = join('dados', 'acesso.db');

async function enviar(
  montador: Cliente,
  conteudo: Buffer,
  opcoes: { uid?: string; codigo?: string; emitidoEm?: number } = {},
) {
  const uid = opcoes.uid ?? novoUid();
  const consulta = new URLSearchParams({
    empresa: 'Painéis Ação Ltda',
    projeto: 'Linha 3',
    titulo: 'Verificação de Montagem',
    nomeArquivo: 'PAINEIS-ACAO_LINHA-3_MONTAGEM.pdf',
    emitidoEm: String(opcoes.emitidoEm ?? Date.now()),
    sha256: sha256(conteudo),
  });
  if (opcoes.codigo !== undefined) consulta.set('codigo', opcoes.codigo);
  const r = await montador.enviarArquivo(`/api/pdfs/${uid}?${consulta}`, conteudo, 'application/pdf');
  return { uid, ...r };
}

describe('número de identificação dos PDFs arquivados', () => {
  let amb: Ambiente;
  let admin: Cliente;
  let montador: Cliente;

  before(async () => {
    amb = await subirServidor();
    admin = await entrarComoAdmin(amb.url);
    montador = await novoMontador(amb.url, admin, 'carlos@parceiro.local', 'Carlos Silva');
  });

  after(async () => {
    await amb?.encerrar();
  });

  async function listar(busca = '') {
    const { pdfs } = await admin.ok('GET', `/api/admin/pdfs?busca=${encodeURIComponent(busca)}`);
    return pdfs as Array<{ uid: string; codigo: string | null }>;
  }

  it('guarda o número que o aparelho imprimiu no PDF', async () => {
    const codigo = gerarCodigoPdf();
    const r = await enviar(montador, pdfFalso('com número'), { codigo });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    const guardado = (await listar()).find((p) => p.uid === r.uid);
    assert.equal(guardado?.codigo, codigo);
  });

  it('aceita o número em minúsculas e espaços, guardando-o normalizado', async () => {
    const codigo = gerarCodigoPdf();
    const r = await enviar(montador, pdfFalso('minúsculas'), { codigo: ` ${codigo.toLowerCase()} ` });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal((await listar()).find((p) => p.uid === r.uid)?.codigo, codigo);
  });

  it('recusa número repetido e não deixa o arquivo nem o registro', async () => {
    const codigo = gerarCodigoPdf();
    const primeiro = await enviar(montador, pdfFalso('primeiro'), { codigo });
    assert.equal(primeiro.status, 200);
    const antes = (await listar()).length;
    const segundo = await enviar(montador, pdfFalso('segundo'), { codigo });
    assert.equal(segundo.status, 409);
    assert.match(segundo.dados.erro ?? segundo.dados.mensagem ?? JSON.stringify(segundo.dados), /já usado/);
    assert.equal((await listar()).length, antes);
    assert.equal((await listar()).some((p) => p.uid === segundo.uid), false);
    const arquivo = await admin.baixar(`/api/admin/pdfs/${segundo.uid}/arquivo`);
    assert.equal(arquivo.status, 404);
  });

  it('recusa número fora do formato', async () => {
    for (const ruim of ['VM-2026-ABCD', 'abc', 'VM-2026-ABCD-EFGH-JKL0', 'VM-26-ABCD-EFGH-JKLM']) {
      const r = await enviar(montador, pdfFalso(`ruim ${ruim}`), { codigo: ruim });
      assert.equal(r.status, 400, `${ruim}: ${JSON.stringify(r.dados)}`);
    }
  });

  it('atribui um número ao PDF que chega sem ele, com o ano da emissão', async () => {
    const emitidoEm = new Date(2024, 5, 10).getTime();
    const r = await enviar(montador, pdfFalso('sem número'), { emitidoEm });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    const codigo = (await listar()).find((p) => p.uid === r.uid)?.codigo;
    assert.ok(codigo && codigoPdfValido(codigo), String(codigo));
    assert.match(codigo, /^VM-2024-/);
  });

  it('o reenvio do mesmo PDF depois de uma queda continua valendo e não troca o número', async () => {
    const uid = novoUid();
    const conteudo = pdfFalso('reenvio');
    const codigo = gerarCodigoPdf();
    assert.equal((await enviar(montador, conteudo, { uid, codigo })).status, 200);
    assert.equal((await enviar(montador, conteudo, { uid, codigo })).status, 200);
    const iguais = (await listar()).filter((p) => p.uid === uid);
    assert.equal(iguais.length, 1);
    assert.equal(iguais[0].codigo, codigo);
  });

  it('todos os números arquivados são diferentes', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await enviar(montador, pdfFalso(`lote ${i}`))).status, 200);
    const codigos = (await listar()).map((p) => p.codigo);
    assert.ok(codigos.length >= 5);
    assert.ok(codigos.every((c) => c && codigoPdfValido(c)));
    assert.equal(new Set(codigos).size, codigos.length);
  });

  it('a busca do administrador acha o PDF pelo número', async () => {
    const codigo = gerarCodigoPdf();
    const r = await enviar(montador, pdfFalso('para buscar'), { codigo });
    assert.equal(r.status, 200);
    for (const termo of [codigo, codigo.toLowerCase(), codigo.slice(-9)]) {
      const achados = await listar(termo);
      assert.deepEqual(
        achados.map((p) => p.uid),
        [r.uid],
        termo,
      );
    }
    const nada = await listar('VM-1999-ZZZZ-ZZZZ-ZZZZ');
    assert.equal(nada.length, 0);
  });

  it('a lista de documentos do administrador traz o número', async () => {
    const codigo = gerarCodigoPdf();
    const r = await enviar(montador, pdfFalso('na lista'), { codigo });
    assert.equal(r.status, 200);
    const { documentos } = await admin.ok('GET', `/api/admin/documentos?busca=${codigo}`);
    assert.equal(documentos.length, 1);
    assert.equal(documentos[0].codigo, codigo);
  });

  it('o banco não deixa trocar nem repetir o número', async () => {
    const db = new DatabaseSync(join(amb.dados, 'acesso.db'));
    try {
      const [a, b] = db.prepare('SELECT uid, codigo FROM pdfs_emitidos LIMIT 2').all() as Array<{ uid: string; codigo: string }>;
      assert.throws(() => db.prepare('UPDATE pdfs_emitidos SET codigo = ? WHERE uid = ?').run(gerarCodigoPdf(), a.uid), /não pode ser alterado/);
      assert.throws(() => db.prepare('UPDATE pdfs_emitidos SET codigo = NULL WHERE uid = ?').run(a.uid), /não pode ser alterado/);
      assert.throws(() => db.prepare('UPDATE pdfs_emitidos SET codigo = ? WHERE uid = ?').run(a.codigo, b.uid), /não pode ser alterado/);
    } finally {
      db.close();
    }
  });
});

describe('numeração retroativa dos PDFs já arquivados', () => {
  it('dá número aos PDFs antigos na subida, com o ano da emissão, e não mexe nos que já têm', async () => {
    const amb = await subirServidor();
    let montador: Cliente;
    const uids = { antigoA: novoUid(), antigoB: novoUid(), antigoC: novoUid(), novo: novoUid() };
    const codigoNovo = gerarCodigoPdf();
    try {
      const admin = await entrarComoAdmin(amb.url);
      montador = await novoMontador(amb.url, admin, 'carlos@parceiro.local', 'Carlos Silva');
      const em = (ano: number, mes: number) => new Date(ano, mes, 15).getTime();
      assert.equal((await enviar(montador, pdfFalso('A'), { uid: uids.antigoA, emitidoEm: em(2023, 1) })).status, 200);
      assert.equal((await enviar(montador, pdfFalso('B'), { uid: uids.antigoB, emitidoEm: em(2024, 7) })).status, 200);
      assert.equal((await enviar(montador, pdfFalso('C'), { uid: uids.antigoC, emitidoEm: em(2024, 8) })).status, 200);
      assert.equal((await enviar(montador, pdfFalso('N'), { uid: uids.novo, codigo: codigoNovo })).status, 200);
    } finally {
      await amb.parar();
    }

    // Banco no formato antigo: sem a coluna do número (nem o índice e o gatilho que a protegem).
    const legado = new DatabaseSync(join(amb.pasta, REGISTRO));
    try {
      legado.exec('DROP TRIGGER pdfs_emitidos_codigo_definitivo');
      legado.exec('DROP INDEX idx_pdfs_emitidos_codigo');
      legado.exec('ALTER TABLE pdfs_emitidos DROP COLUMN codigo');
      legado.exec(`UPDATE pdfs_emitidos SET busca = 'x'`);
    } finally {
      legado.close();
    }

    const reiniciado = await subirServidor({ BANCO: join(amb.pasta, REGISTRO) });
    try {
      assert.match(reiniciado.saida(), /4 PDF\(s\) arquivado\(s\) receberam o número de identificação/);
      const db = new DatabaseSync(join(amb.pasta, REGISTRO));
      try {
        const linhas = db.prepare('SELECT uid, codigo, emitidoEm FROM pdfs_emitidos').all() as Array<{
          uid: string;
          codigo: string | null;
          emitidoEm: number;
        }>;
        assert.equal(linhas.length, 4);
        assert.ok(linhas.every((l) => l.codigo && codigoPdfValido(l.codigo)));
        assert.equal(new Set(linhas.map((l) => l.codigo)).size, 4);
        const por = (uid: string) => linhas.find((l) => l.uid === uid)!.codigo!;
        assert.match(por(uids.antigoA), /^VM-2023-/);
        assert.match(por(uids.antigoB), /^VM-2024-/);
        assert.match(por(uids.antigoC), /^VM-2024-/);
      } finally {
        db.close();
      }
    } finally {
      await reiniciado.parar();
    }

    // Segunda subida: nada a numerar, e os números não mudam.
    const antes = new DatabaseSync(join(amb.pasta, REGISTRO));
    const fotografia = JSON.stringify(antes.prepare('SELECT uid, codigo FROM pdfs_emitidos ORDER BY uid').all());
    antes.close();
    const terceiro = await subirServidor({ BANCO: join(amb.pasta, REGISTRO) });
    try {
      assert.doesNotMatch(terceiro.saida(), /receberam o número de identificação/);
      const admin = await entrarComoAdmin(terceiro.url);
      const { pdfs } = await admin.ok('GET', '/api/admin/pdfs');
      assert.equal(pdfs.length, 4);
      const depois = new DatabaseSync(join(amb.pasta, REGISTRO));
      try {
        assert.equal(JSON.stringify(depois.prepare('SELECT uid, codigo FROM pdfs_emitidos ORDER BY uid').all()), fotografia);
      } finally {
        depois.close();
      }
      // Os números antigos entram na busca.
      const um = JSON.parse(fotografia)[0] as { uid: string; codigo: string };
      const achados = await admin.ok('GET', `/api/admin/pdfs?busca=${um.codigo}`);
      assert.deepEqual(
        achados.pdfs.map((p: { uid: string }) => p.uid),
        [um.uid],
      );
    } finally {
      await terceiro.encerrar();
      await amb.encerrar();
    }
  });
});
