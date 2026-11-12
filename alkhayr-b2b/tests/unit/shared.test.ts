import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { categoryLabelAr, isProductCategoryId, PRODUCT_CATEGORIES, PRODUCT_CATEGORY_IDS } from '../../src/shared/categories.ts';
import { BUSINESS_SETTING_DEFAULTS } from '../../src/shared/constants.ts';
import { ERROR_CATALOG } from '../../src/shared/errors.ts';
import { stockStatus } from '../../src/shared/stock-status.ts';

describe('categories (owner decision)', () => {
  test('exactly the four approved ids and Arabic labels, in order', () => {
    assert.deepEqual(
      PRODUCT_CATEGORIES.map((c) => [c.id, c.labelAr]),
      [
        ['chocolate', 'شيكولاتة'],
        ['candy', 'كاندي'],
        ['wafers_biscuits', 'ويفر وبسكويت'],
        ['snacks_nuts', 'سناكس ومكسرات'],
      ],
    );
    assert.equal(new Set(PRODUCT_CATEGORY_IDS).size, 4);
  });

  test('id guard and label lookup', () => {
    assert.equal(isProductCategoryId('candy'), true);
    assert.equal(isProductCategoryId('Candy'), false);
    assert.equal(isProductCategoryId('كاندي'), false);
    assert.equal(isProductCategoryId(undefined), false);
    assert.equal(categoryLabelAr('snacks_nuts'), 'سناكس ومكسرات');
  });
});

describe('business setting defaults (owner decision)', () => {
  test('pilot defaults: 0 tax on goods subtotal, untaxed zero shipping, threshold 10', () => {
    assert.deepEqual(BUSINESS_SETTING_DEFAULTS, {
      taxBps: 0,
      shippingCents: 0,
      shippingTaxable: false,
      minimumOrderCents: 0,
      lowStockThresholdCartons: 10,
    });
  });
});

describe('stock status uses available stock', () => {
  test('0 -> out of stock, 1..10 -> low, >10 -> normal', () => {
    assert.equal(stockStatus(0), 'out_of_stock');
    assert.equal(stockStatus(1), 'low_stock');
    assert.equal(stockStatus(10), 'low_stock');
    assert.equal(stockStatus(11), 'normal');
  });
  test('threshold is configurable', () => {
    assert.equal(stockStatus(11, 20), 'low_stock');
    assert.equal(stockStatus(3, 0), 'normal');
  });
  test('rejects invalid inputs', () => {
    assert.throws(() => stockStatus(-1));
    assert.throws(() => stockStatus(1.5));
    assert.throws(() => stockStatus(5, -1));
  });
});

describe('error catalog', () => {
  test('every code has an Arabic message and an HTTP error status', () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
      assert.match(entry.messageAr, /[؀-ۿ]/, code);
      assert.ok(entry.status >= 400 && entry.status <= 599, code);
    }
  });
});
