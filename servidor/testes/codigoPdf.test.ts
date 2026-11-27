import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { codigoPdfValido, gerarCodigoPdf, normalizarCodigoPdf, PADRAO_CODIGO_PDF } from '../../compartilhado/codigoPdf';

/** Gerador e validador do número de identificação dos PDFs (código compartilhado). */

describe('número de identificação do PDF', () => {
  it('segue o formato VM-AAAA-XXXX-XXXX-XXXX', () => {
    const codigo = gerarCodigoPdf(new Date(2026, 4, 3));
    assert.match(codigo, PADRAO_CODIGO_PDF);
    assert.match(codigo, /^VM-2026-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    assert.equal(codigoPdfValido(codigo), true);
  });

  it('usa o ano da emissão e cai no ano atual se a data for inválida', () => {
    assert.match(gerarCodigoPdf(new Date(2023, 0, 1)), /^VM-2023-/);
    assert.match(gerarCodigoPdf(new Date(Number.NaN)), new RegExp(`^VM-${new Date().getFullYear()}-`));
  });

  it('não usa caracteres que se confundem (0, O, 1, I)', () => {
    for (let i = 0; i < 500; i++) {
      const sorteio = gerarCodigoPdf().slice('VM-0000-'.length);
      assert.doesNotMatch(sorteio, /[01OI]/);
    }
  });

  it('não repete em 20 mil números gerados', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 20_000; i++) vistos.add(gerarCodigoPdf());
    assert.equal(vistos.size, 20_000);
  });

  it('normaliza maiúsculas e espaços antes de validar', () => {
    assert.equal(normalizarCodigoPdf('  vm-2026-abcd-efgh-jklm \n'), 'VM-2026-ABCD-EFGH-JKLM');
    assert.equal(normalizarCodigoPdf('vm-2026 abcd-efgh-jklm'), 'VM-2026ABCD-EFGH-JKLM');
  });

  it('recusa o que está fora do formato', () => {
    for (const ruim of [
      '',
      'VM-2026-ABCD-EFGH',
      'VM-2026-ABCD-EFGH-JKLM-NPQR',
      'VM-26-ABCD-EFGH-JKLM',
      'XX-2026-ABCD-EFGH-JKLM',
      'VM-2026-abcd-efgh-jklm',
      'VM-2026-ABCD-EFGH-JKL0',
      'VM-2026-ABCD-EFGH-JKLO',
      'VM-2026-ABCD-EFGH-JKL1',
      'VM-2026-ABCD-EFGH-JKLI',
      'VM-2026-ABCD-EFGH-JKLM\n',
    ]) {
      assert.equal(codigoPdfValido(ruim), false, ruim);
    }
  });
});
