import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, test } from 'node:test';
import type { ApiFailure } from '../../src/web/api/client.ts';
import type { CatalogProduct } from '../../src/web/api/contracts.ts';
import { acceptCurrentTerms, addProduct, cartIsValid, cartMatchesPayload, EMPTY_CART, lineError, MAX_LINES, payloadLines, removeLines, setCartons, subtotalCents } from '../../src/web/cart/model.ts';
import { clearAllDrafts, DRAFT_TTL_MS, draftKey, loadDraft, purgeOtherDrafts, saveDraft } from '../../src/web/cart/storage.ts';
import { classifyFailure, conflictProductIds, conflictTerms, newSubmission } from '../../src/web/checkout/submission.ts';

/** Storage-like object: data as own enumerable properties, methods on the prototype (like window.localStorage). */
class FakeStorage {
  getItem(k: string) {
    return Object.hasOwn(this, k) ? (this as unknown as Record<string, string>)[k]! : null;
  }
  setItem(k: string, v: string) {
    (this as unknown as Record<string, string>)[k] = String(v);
  }
  removeItem(k: string) {
    delete (this as unknown as Record<string, string>)[k];
  }
}
let store: FakeStorage;
beforeEach(() => {
  store = new FakeStorage();
  (globalThis as unknown as { window: unknown }).window = { localStorage: store };
});

const product = (o: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: randomUUID(),
  name: 'شيكولاتة',
  brand: 'براند',
  category: { id: 'chocolate', labelAr: 'شيكولاتة' },
  barcode: null,
  imageUrl: null,
  cartonPriceCents: 12_550,
  packSize: 24,
  minimumCartons: 2,
  availability: { status: 'normal', labelAr: 'متوفر' },
  isDemo: false,
  ...o,
});
const failure = (kind: ApiFailure['kind'], extra: Partial<ApiFailure> = {}): ApiFailure => ({ ok: false, kind, status: 0, code: null, message: 'x', requestId: null, fields: [], current: null, retryAfterSeconds: null, ...extra });
const scope = () => ({ userId: randomUUID(), merchantId: randomUUID() });

describe('cart model', () => {
  test('whole cartons, minimum and maximum quantities, line limit; adding again adds cartons', () => {
    const p = product();
    assert.equal(addProduct(EMPTY_CART, p, 1).error, 'below_minimum');
    assert.equal(addProduct(EMPTY_CART, p, 1.5).error, 'not_integer');
    assert.equal(addProduct(EMPTY_CART, p, 100_001).error, 'above_maximum');
    assert.equal(addProduct(EMPTY_CART, product({ availability: { status: 'out_of_stock', labelAr: '' } }), 5).error, 'unavailable');
    let { cart } = addProduct(EMPTY_CART, p, 2);
    cart = addProduct(cart, p, 3).cart;
    assert.deepEqual(cart.lines.map((l) => l.cartons), [5]);
    let full = EMPTY_CART;
    for (let i = 0; i < MAX_LINES; i++) full = addProduct(full, product({ minimumCartons: 1 }), 1).cart;
    assert.equal(full.lines.length, 100);
    assert.equal(addProduct(full, product({ minimumCartons: 1 }), 1).error, 'too_many_lines');
    assert.equal(lineError({ cartons: 1, minimumCartons: 2 }), 'below_minimum');
    assert.equal(cartIsValid(setCartons(cart, p.id, 1)), false);
  });

  test('exact integer subtotal, including the largest supported values', () => {
    let { cart } = addProduct(EMPTY_CART, product({ cartonPriceCents: 12_345, minimumCartons: 1 }), 3);
    cart = addProduct(cart, product({ cartonPriceCents: 999, minimumCartons: 1 }), 7).cart;
    assert.equal(subtotalCents(cart), 37_035 + 6_993);
    let big = EMPTY_CART;
    for (let i = 0; i < 100; i++) big = addProduct(big, product({ cartonPriceCents: 100_000_000, minimumCartons: 1 }), 100_000).cart;
    assert.equal(subtotalCents(big), 1_000_000_000_000_000);
  });

  test('payload carries the REVIEWED price and pack size; changed terms only after explicit acceptance', () => {
    const p = product({ cartonPriceCents: 10_000, packSize: 24 });
    let { cart } = addProduct(EMPTY_CART, p, 2);
    assert.deepEqual(payloadLines(cart), [{ productId: p.id, cartons: 2, expectedCartonPriceCents: 10_000, expectedPackSize: 24 }]);
    cart = acceptCurrentTerms(cart, [{ productId: p.id, cartonPriceCents: 11_000, packSize: 12 }]);
    assert.deepEqual(payloadLines(cart), [{ productId: p.id, cartons: 2, expectedCartonPriceCents: 11_000, expectedPackSize: 12 }]);
    assert.deepEqual(removeLines(cart, [p.id]).lines, []);
  });
});

describe('order submission rules', () => {
  test('each intended submission gets a new key; the payload is stored with exactly that key', () => {
    const { cart } = addProduct(EMPTY_CART, product(), 2);
    const a = newSubmission(cart, '  ملاحظة  ');
    const b = newSubmission(cart, '  ملاحظة  ');
    assert.notEqual(a.requestKey, b.requestKey);
    assert.equal(a.payload.requestKey, a.requestKey);
    assert.equal(a.payload.note, 'ملاحظة');
    assert.equal(newSubmission(cart, '   ').payload.note, undefined);
    assert.equal(cartMatchesPayload(cart, a.payload), true);
    assert.equal(cartMatchesPayload(setCartons(cart, cart.lines[0]!.productId, 3), a.payload), false);
  });

  test('outcomes: no answer or server error is UNKNOWN (keep key); definite refusals release it', () => {
    for (const k of ['network', 'server', 'unavailable', 'invalid_response'] as const) assert.equal(classifyFailure(failure(k)), 'unknown', k);
    assert.equal(classifyFailure(failure('rate_limited')), 'not_processed');
    assert.equal(classifyFailure(failure('unauthenticated')), 'session');
    for (const k of ['conflict', 'validation', 'forbidden', 'not_found'] as const) assert.equal(classifyFailure(failure(k)), 'rejected', k);
  });

  test('conflict details are validated before use', () => {
    const f = failure('conflict', { current: { items: [{ productId: 'a', cartonPriceCents: 5, packSize: 2 }, { productId: 'b', cartonPriceCents: '5' }, 'x'] } });
    assert.deepEqual(conflictTerms(f), [{ productId: 'a', cartonPriceCents: 5, packSize: 2 }]);
    assert.deepEqual(conflictProductIds(f), ['a', 'b']);
    assert.deepEqual(conflictTerms(failure('conflict')), []);
  });
});

describe('draft storage (the only browser storage)', () => {
  test('round trip per account; nothing secret is written', () => {
    const s = scope();
    const { cart } = addProduct(EMPTY_CART, product(), 2);
    const pending = newSubmission(cart, 'x');
    saveDraft(s, { cart, pending });
    const raw = store.getItem(draftKey(s))!;
    assert.doesNotMatch(raw, /csrf|token|password|totp|buyer|session/i);
    const loaded = loadDraft(s);
    assert.deepEqual(loaded.cart, cart);
    assert.deepEqual(loaded.pending, pending);
    assert.deepEqual(loadDraft(scope()).cart.lines, [], 'another account never sees it');
  });

  test('untrusted stored data is validated: malformed lines and pending entries are dropped', () => {
    const s = scope();
    const good = addProduct(EMPTY_CART, product(), 2).cart.lines[0]!;
    store.setItem(
      draftKey(s),
      JSON.stringify({
        v: 1,
        savedAt: Date.now(),
        lines: [good, { ...good, cartons: 2.5 }, { ...good, productId: 'x' }, { ...good, cartonPriceCents: -1 }, '<script>', good],
        pending: { requestKey: randomUUID(), createdAt: 1, payload: { requestKey: 'other', items: [] } },
      }),
    );
    const d = loadDraft(s);
    assert.deepEqual(d.cart.lines, [good], 'invalid and duplicate lines dropped');
    assert.equal(d.pending, null);
    store.setItem(draftKey(s), '{not json');
    assert.deepEqual(loadDraft(s).cart.lines, []);
    assert.equal(store.getItem(draftKey(s)), null, 'corrupt entry removed');
  });

  test('expiry, explicit logout and account switching remove drafts', () => {
    const a = scope();
    const b = scope();
    const { cart } = addProduct(EMPTY_CART, product(), 2);
    saveDraft(a, { cart, pending: null }, Date.now() - DRAFT_TTL_MS - 1);
    assert.deepEqual(loadDraft(a).cart.lines, [], 'expired after 7 days');
    saveDraft(a, { cart, pending: null });
    saveDraft(b, { cart, pending: null });
    purgeOtherDrafts(b);
    assert.equal(store.getItem(draftKey(a)), null, "switching to B deletes A's draft");
    assert.notEqual(store.getItem(draftKey(b)), null);
    store.setItem('unrelated', '1');
    clearAllDrafts();
    assert.equal(store.getItem(draftKey(b)), null);
    assert.equal(store.getItem('unrelated'), '1', 'only ALKHAYR drafts are removed');
  });

  test('unavailable storage degrades to memory without errors', () => {
    (globalThis as unknown as { window: unknown }).window = {
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
    };
    const s = scope();
    saveDraft(s, { cart: addProduct(EMPTY_CART, product(), 2).cart, pending: null });
    assert.deepEqual(loadDraft(s).cart.lines, []);
    clearAllDrafts();
  });
});
