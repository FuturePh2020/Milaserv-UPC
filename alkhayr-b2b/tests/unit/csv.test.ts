import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_FIELD_CHARS, moneyEgp, parseCsv, wholeNumber } from '../../src/server/import/csv.ts';

const enc = (s: string) => new TextEncoder().encode(s);
function table(s: string | Uint8Array) {
  const r = parseCsv(typeof s === 'string' ? enc(s) : s);
  if (!r.ok) throw new Error(`unexpected failure: ${r.message} @${r.line}`);
  return r.table;
}
function failure(s: string | Uint8Array, maxRows?: number) {
  const r = parseCsv(typeof s === 'string' ? enc(s) : s, maxRows);
  assert.equal(r.ok, false, 'expected a parse failure');
  return r as { ok: false; line: number | null; message: string };
}

describe('CSV parser: valid input', () => {
  it('Arabic UTF-8 with BOM and CRLF; cells kept exactly (no trimming)', () => {
    const t = table('﻿name,brand\r\nشيكولاتة بالبندق , نور\r\n');
    assert.deepEqual(t.header, ['name', 'brand']);
    assert.deepEqual(t.records, [{ recordNo: 1, line: 2, cells: ['شيكولاتة بالبندق ', ' نور'] }]);
  });
  it('without BOM, LF only, no trailing newline', () => {
    assert.deepEqual(table('a,b\n1,2').records[0]!.cells, ['1', '2']);
  });
  it('quoted commas, escaped quotes and multiline fields; record line numbers point to the record start', () => {
    const t = table('a,b\n"x, y","he said ""hi"""\n"line1\nline2\r\nline3",z\nlast,row\n');
    assert.deepEqual(t.records.map((r) => [r.recordNo, r.line, r.cells]), [
      [1, 2, ['x, y', 'he said "hi"']],
      [2, 3, ['line1\nline2\r\nline3', 'z']],
      [3, 6, ['last', 'row']],
    ]);
  });
  it('empty lines are ignored anywhere (including trailing); a comma-only line is a record', () => {
    const t = table('a,b\n\n1,2\n\r\n,\n\n\n');
    assert.deepEqual(t.records.map((r) => r.cells), [['1', '2'], ['', '']]);
    assert.deepEqual(t.records.map((r) => r.line), [3, 5]);
  });
  it('quoted empty cell and leading zeros / letter case preserved as text', () => {
    assert.deepEqual(table('a,b\n"",000123\n').records[0]!.cells, ['', '000123']);
    assert.deepEqual(table('a\nAbC-09\n').records[0]!.cells, ['AbC-09']);
  });
  it('formula-like and HTML-like text is just text', () => {
    assert.deepEqual(table('a,b\n=1+2,<script>x</script>\n').records[0]!.cells, ['=1+2', '<script>x</script>']);
  });
});

describe('CSV parser: rejections', () => {
  it('invalid UTF-8 is rejected, not replaced', () => {
    const bytes = new Uint8Array([...enc('a\n'), 0xc3, 0x28, 0x0a]);
    assert.match(failure(bytes).message, /UTF-8/);
    assert.match(failure(new Uint8Array([...enc('a\n'), 0xff, 0x0a])).message, /UTF-8/);
  });
  it('NUL bytes, empty file, header only, duplicate BOM', () => {
    assert.match(failure(new Uint8Array([...enc('a\nx'), 0, 0x0a])).message, /NUL/);
    assert.match(failure('').message, /فارغ/);
    assert.match(failure('a,b\n').message, /صف بيانات/);
    assert.match(failure('﻿﻿a\n1\n').message, /BOM/);
  });
  it('malformed quoting: quote inside unquoted cell, text after closing quote, unterminated quote', () => {
    assert.equal(failure('a\nab"c\n').line, 2);
    assert.match(failure('a\nab"c"\n').message, /غير محاطة/, 'a balanced quote in the middle of a cell is still refused');
    assert.equal(failure('a,b\n"x"y,1\n').line, 2);
    const u = failure('a\n1\n"open\nmore\n');
    assert.equal(u.line, 3);
    assert.match(u.message, /لم تُغلق/);
  });
  it('bare CR is refused', () => {
    assert.match(failure('a\r1\n').message, /CR/);
  });
  it('row and size limits', () => {
    const rows = (n: number) => `a\n${'1\n'.repeat(n)}`;
    assert.equal(table(rows(1000)).records.length, 1000);
    assert.match(failure(rows(1001)).message, /1000/);
    assert.match(failure(rows(5), 4).message, /4/);
    const big = new Uint8Array(1024 * 1024 + 1).fill(0x61);
    assert.match(failure(big).message, /حجم/);
  });
  it('field length limit (also inside quotes)', () => {
    const long = 'x'.repeat(MAX_FIELD_CHARS + 1);
    assert.match(failure(`a\n${long}\n`).message, /أطول/);
    assert.match(failure(`a\n"${long}"\n`).message, /أطول/);
    assert.equal(table(`a\n${'x'.repeat(MAX_FIELD_CHARS)}\n`).records.length, 1);
  });
});

describe('strict cell grammars', () => {
  it('whole numbers: ASCII digits only, no sign/space/separator/exponent/fraction/leading zero', () => {
    assert.deepEqual(wholeNumber('0', 0, 10, 'x'), { ok: true, value: 0 });
    assert.deepEqual(wholeNumber('24', 1, 100, 'x'), { ok: true, value: 24 });
    for (const bad of ['', ' 24', '24 ', '+24', '-1', '1.0', '1.5', '1e3', '1E3', '0x10', '010', '1,000', '١٢', 'Infinity', 'NaN', '99999999999']) {
      assert.equal(wholeNumber(bad, 0, 1e9, 'x').ok, false, bad);
    }
    assert.equal(wholeNumber('101', 1, 100, 'x').ok, false);
  });
  it('money: decimal pounds to exact piastres, at most two decimals, never rounded', () => {
    assert.deepEqual(moneyEgp('125.50', 1, 1e8, 'x'), { ok: true, value: 12550 });
    assert.deepEqual(moneyEgp('125.5', 1, 1e8, 'x'), { ok: true, value: 12550 });
    assert.deepEqual(moneyEgp('0.29', 1, 1e8, 'x'), { ok: true, value: 29 });
    assert.deepEqual(moneyEgp('1000000', 1, 1e8, 'x'), { ok: true, value: 100_000_000 });
    for (const bad of ['125.505', '1,250.50', '1250,50', '١٢٥', '1e3', '-5', '+5', ' 5', '5 ', '.5', '5.', 'EGP 5', '05', 'Infinity', 'NaN', '0', '0.00', '1000000.01']) {
      assert.equal(moneyEgp(bad, 1, 1e8, 'x').ok, false, bad);
    }
    assert.match((moneyEgp('125.505', 1, 1e8, 'x') as { message: string }).message, /لا يتم التقريب/);
  });
});
