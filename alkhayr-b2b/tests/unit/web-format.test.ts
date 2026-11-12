import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatBasisPoints, formatCartons, formatInteger, formatLines, formatMoney, formatPackSize, formatPieces, piecePriceCents } from '../../src/web/format.ts';

describe('web formatting', () => {
  test('money: integer piasters, exact up to the 1e13 limit, Western digits, Egyptian pound suffix', () => {
    assert.equal(formatMoney(0), '0.00 ج.م');
    assert.equal(formatMoney(5), '0.05 ج.م');
    assert.equal(formatMoney(125_550), '1,255.50 ج.م');
    assert.equal(formatMoney(10_000_000_000_000), '100,000,000,000.00 ج.م');
    assert.equal(formatMoney(9_999_999_999_999), '99,999,999,999.99 ج.م');
    assert.equal(formatMoney(-1_050), '-10.50 ج.م');
    assert.equal(formatMoney(125_550, { currency: false }), '1,255.50');
    assert.throws(() => formatMoney(1.5), RangeError);
    assert.throws(() => formatMoney(Number.MAX_SAFE_INTEGER + 1), RangeError);
  });

  test('informational piece price: carton price / pack size, rounded half-up to whole piasters', () => {
    assert.equal(piecePriceCents(125_550, 24), 5231); // 5231.25
    assert.equal(piecePriceCents(9_000, 48), 188); // 187.5 -> 188
    assert.equal(piecePriceCents(100, 3), 33); // 33.33
    assert.equal(piecePriceCents(100_000_000, 7), 14_285_714); // 14285714.28
    assert.throws(() => piecePriceCents(100, 0), RangeError);
  });

  test('Arabic counted nouns for cartons, pieces and lines', () => {
    assert.equal(formatCartons(1), 'كرتونة واحدة');
    assert.equal(formatCartons(2), 'كرتونتان');
    assert.equal(formatCartons(3), '3 كراتين');
    assert.equal(formatCartons(10), '10 كراتين');
    assert.equal(formatCartons(11), '11 كرتونة');
    assert.equal(formatCartons(100), '100 كرتونة');
    assert.equal(formatCartons(100_000), '100,000 كرتونة');
    assert.equal(formatPieces(24), '24 قطعة');
    assert.equal(formatPackSize(7), '7 قطع في الكرتونة');
    assert.equal(formatLines(1), 'صنف واحد');
    assert.equal(formatInteger(1234567), '1,234,567');
  });

  test('tax basis points', () => {
    assert.equal(formatBasisPoints(0), '0%');
    assert.equal(formatBasisPoints(1400), '14%');
    assert.equal(formatBasisPoints(1250), '12.5%');
    assert.equal(formatBasisPoints(25), '0.25%');
    assert.equal(formatBasisPoints(10000), '100%');
  });
});
