import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADJUSTMENT_ERROR, adjustmentPreview, barcodeValue, bpsInputText, parsePercentToBps, MAX_ON_HAND, MERCHANT_TRANSITIONS, moneyInputText, parseImageUrl, parseMoneyInput, parseWhole } from '../../src/web/admin/logic.ts';
import { OperationCoordinator } from '../../src/web/admin/coordinator.ts';
import { hasUnresolved } from '../../src/web/admin/unresolved.ts';
import { loadWebModules } from '../helpers/web.ts';

describe('administrator money input (exact pounds -> piastres)', () => {
  it('converts exactly, with integer arithmetic', () => {
    assert.deepEqual(parseMoneyInput('125.50'), { ok: true, value: 12550 });
    assert.deepEqual(parseMoneyInput('125.5'), { ok: true, value: 12550 });
    assert.deepEqual(parseMoneyInput('125'), { ok: true, value: 12500 });
    assert.deepEqual(parseMoneyInput('0.01'), { ok: true, value: 1 });
    assert.deepEqual(parseMoneyInput('1,234.05'), { ok: true, value: 123405 });
    // values whose float multiplication would be inexact (0.29 * 100 = 28.999999999999996)
    assert.deepEqual(parseMoneyInput('0.29'), { ok: true, value: 29 });
    assert.deepEqual(parseMoneyInput('1.15'), { ok: true, value: 115 });
    assert.deepEqual(parseMoneyInput('١٢٥٫٥٠'), { ok: true, value: 12550 }, 'Arabic-Indic digits and decimal separator');
  });
  it('rejects extra precision instead of rounding, and every non-amount', () => {
    const extra = parseMoneyInput('125.505');
    assert.equal(extra.ok, false);
    assert.match(!extra.ok ? extra.message : '', /رقمين عشريين/);
    for (const bad of ['', ' ', '-5', '+5', '1e3', '12.', '.5', 'abc', '0', '0.00', 'Infinity', '12.5.0', '0x10']) assert.equal(parseMoneyInput(bad).ok, false, bad);
  });
  it('enforces the maximum carton price', () => {
    assert.equal(parseMoneyInput('1000000').ok, true);
    assert.equal(parseMoneyInput('1000000.01').ok, false);
  });
  it('round-trips through the price field text', () => {
    for (const cents of [1, 10, 99, 100, 12550, 100_000_000]) {
      const r = parseMoneyInput(moneyInputText(cents));
      assert.deepEqual(r, { ok: true, value: cents });
    }
    assert.equal(moneyInputText(12505), '125.05');
  });
});

describe('administrator whole-number input', () => {
  it('accepts whole numbers in range only', () => {
    assert.deepEqual(parseWhole('12', 1, 100, 'x'), { ok: true, value: 12 });
    assert.deepEqual(parseWhole('١٢', 1, 100, 'x'), { ok: true, value: 12 });
    for (const bad of ['0', '101', '1.5', '-3', '', '1e2', ' 1 2']) assert.equal(parseWhole(bad, 1, 100, 'x').ok, false, bad);
    assert.deepEqual(parseWhole('-3', -10, 10, 'x', true), { ok: true, value: -3 });
  });
});

describe('inventory adjustment preview', () => {
  const cur = { onHand: 50, reserved: 20 };
  it('computes before/after/delta and leaves reserved unchanged', () => {
    assert.deepEqual(adjustmentPreview(cur, 'receipt', 10), { before: 50, after: 60, delta: 10, reserved: 20, availableAfter: 40, error: null });
    assert.deepEqual(adjustmentPreview(cur, 'correction_delta', -5), { before: 50, after: 45, delta: -5, reserved: 20, availableAfter: 25, error: null });
    assert.deepEqual(adjustmentPreview(cur, 'set_total', 30), { before: 50, after: 30, delta: -20, reserved: 20, availableAfter: 10, error: null });
  });
  it('flags no-op, negative, below-reserved and above-maximum results', () => {
    assert.equal(adjustmentPreview(cur, 'set_total', 50).error, 'no_change');
    assert.equal(adjustmentPreview(cur, 'correction_delta', 0).error, 'no_change');
    assert.equal(adjustmentPreview({ onHand: 5, reserved: 0 }, 'correction_delta', -6).error, 'negative');
    assert.equal(adjustmentPreview(cur, 'set_total', 19).error, 'below_reserved');
    assert.equal(adjustmentPreview(cur, 'set_total', 20).error, null, 'exactly the reserved quantity is allowed');
    assert.equal(adjustmentPreview(cur, 'receipt', MAX_ON_HAND).error, 'above_max');
    for (const k of Object.keys(ADJUSTMENT_ERROR)) assert.ok(ADJUSTMENT_ERROR[k as keyof typeof ADJUSTMENT_ERROR].length > 0);
  });
});

describe('merchant status choices offered to administrators', () => {
  it('matches the documented server table (API_CONTRACT §4a)', () => {
    const flat = Object.entries(MERCHANT_TRANSITIONS).flatMap(([from, list]) => list.map((t) => `${from}>${t.to}:${t.reasonRequired ? 'R' : '-'}${t.endsSessions ? 'S' : '-'}`));
    assert.deepEqual(flat.sort(), ['approved>pending:RS', 'approved>suspended:RS', 'pending>approved:--', 'pending>suspended:RS', 'suspended>approved:R-', 'suspended>pending:R-'].sort());
  });
});

describe('product field values', () => {
  it('keeps a barcode exactly as typed; only an empty field is null', () => {
    assert.equal(barcodeValue(''), null);
    assert.equal(barcodeValue('000123'), '000123');
    assert.equal(barcodeValue('AbC-01'), 'AbC-01');
    assert.notEqual(barcodeValue(''), '');
  });
  it('accepts https image URLs without credentials only', () => {
    assert.deepEqual(parseImageUrl(''), { ok: true, value: null });
    assert.deepEqual(parseImageUrl('https://img.example/a.png'), { ok: true, value: 'https://img.example/a.png' });
    for (const bad of ['http://img.example/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://u:p@img.example/a.png', 'https://u@img.example/a.png', 'not a url']) assert.equal(parseImageUrl(bad).ok, false, bad);
  });
});

describe('unresolved-operation coordinator (survives navigation; never silently replaced)', () => {
  type R = { ok: true; status: number; data: unknown; requestId: null } | { ok: false; kind: string; status: number; code: string | null; message: string; requestId: string | null; fields: []; current: null; retryAfterSeconds: null };
  const lost: R = { ok: false, kind: 'network', status: 0, code: null, message: 'x', requestId: null, fields: [], current: null, retryAfterSeconds: null };
  const okResult = (data: unknown): R => ({ ok: true, status: 201, data, requestId: null });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('keeps key + exact payload after a lost response; a different run in the slot is refused; retry resends the SAME payload', async () => {
    const sent: unknown[] = [];
    const replies: R[] = [lost, okResult({ replayed: true }), okResult({})];
    const send = async (p: unknown) => {
      sent.push(p);
      return replies.shift()! as never;
    };
    const c = new OperationCoordinator();
    const payload = { operationKey: 'k-1', quantity: 5 };
    assert.equal(c.run('inventory:p1', { label: 'استلام 5', href: '/admin/inventory/p1' }, payload, send), true);
    assert.equal(hasUnresolved(), true, 'sending counts as unresolved');
    await tick();
    assert.equal(c.get('inventory:p1')!.status, 'unknown');
    assert.deepEqual(c.unresolved().map((e) => [e.slot, e.label, e.href]), [['inventory:p1', 'استلام 5', '/admin/inventory/p1']]);
    // A navigation away and back reads the same entry (the coordinator outlives the screen component).
    assert.equal(c.run('inventory:p1', { label: 'أخرى', href: '/x' }, { operationKey: 'k-2', quantity: 9 }, send), false, 'no silent replacement');
    assert.equal(c.retry('inventory:p1', send), true);
    await tick();
    assert.deepEqual(sent, [payload, payload], 'retry used the identical payload object (same key)');
    assert.equal(sent[1], payload);
    assert.equal(c.get('inventory:p1')!.status, 'done');
    assert.equal(hasUnresolved(), false);
    // A finished entry can be replaced by a NEW intention.
    assert.equal(c.run('inventory:p1', { label: 'جديد', href: '/x' }, { operationKey: 'k-3' }, send), true);
    await tick();
  });

  it('a discarded operation is not resurrected by a late response; clear() empties everything (identity change)', async () => {
    let release: (r: R) => void = () => undefined;
    const send = () => new Promise<R>((r) => (release = r)) as never;
    const c = new OperationCoordinator();
    c.run('order:o1', { label: 'شحن', href: '/admin/orders/o1' }, { operationKey: 'k' }, send);
    c.discard('order:o1');
    release(okResult({}));
    await tick();
    assert.equal(c.get('order:o1'), undefined);
    c.run('order:o2', { label: 'شحن', href: '/admin/orders/o2' }, { operationKey: 'k2' }, async () => lost as never);
    await tick();
    assert.equal(hasUnresolved(), true);
    c.clear();
    assert.equal(c.unresolved().length, 0);
    assert.equal(hasUnresolved(), false);
  });

  it('definite refusals release the slot and are reported to the identity handler', async () => {
    const seen: unknown[] = [];
    const c = new OperationCoordinator((f) => seen.push(f.code));
    const refusal = { ...lost, kind: 'conflict', status: 409, code: 'VERSION_CONFLICT' } as R;
    c.run('s', { label: 'x', href: '/x' }, { operationKey: 'k' }, async () => refusal as never);
    await tick();
    assert.equal(c.get('s')!.status, 'rejected');
    assert.deepEqual(seen, ['VERSION_CONFLICT']);
    assert.equal(c.run('s', { label: 'x', href: '/x' }, { operationKey: 'k2' }, async () => okResult({}) as never), true);
  });
});

describe('administration markup', () => {
  it('order actions explain stock effects; cancellation of a confirmed order releases only its own reservation', async () => {
    const m = await loadWebModules<{ explainTransition: (from: string, to: string) => string }>(['src/web/pages/admin/AdminOrders.tsx']);
    assert.match(m.explainTransition('pending', 'confirmed'), /كل الأصناف أو لا شيء/);
    assert.match(m.explainTransition('pending', 'cancelled'), /لا يتغير المخزون/);
    assert.match(m.explainTransition('confirmed', 'cancelled'), /لهذا الطلب فقط/);
    assert.match(m.explainTransition('preparing', 'shipped'), /يخصم/);
  });
  it('the landing page shows links only, no figures', async () => {
    const m = await loadWebModules<{ AdminHomePage: () => unknown }>(['src/web/pages/admin/AdminHome.tsx']);
    const html = m.renderToStaticMarkup(m.createElement(m.AdminHomePage));
    assert.match(html, /href="#\/admin\/orders\?state=pending"/);
    assert.match(html, /href="#\/admin\/merchants\?status=pending"/);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/15 دقيقة/, '');
    assert.doesNotMatch(text, /[0-9٠-٩]/, 'no counts or statistics are rendered');
  });
});

describe('settings inputs (stage 14): exact percent -> basis points and zero-allowed money', () => {
  it('converts percentages exactly and refuses extra precision instead of rounding', () => {
    for (const [raw, bps] of [['14', 1400], ['14.5', 1450], ['14.50', 1450], ['0.25', 25], ['0', 0], ['100', 10000], ['١٤٫٥', 1450], ['14%', 1400], [' 7.01 ', 701]] as const) {
      assert.deepEqual(parsePercentToBps(raw), { ok: true, value: bps }, raw);
    }
    for (const bad of ['14.505', '100.01', '101', '-1', '1e2', '', 'abc', '14,5', '.5']) assert.equal(parsePercentToBps(bad).ok, false, bad);
    assert.match((parsePercentToBps('14.505') as { message: string }).message, /لا يتم التقريب/);
  });
  it('round-trips basis points through the field text', () => {
    for (const bps of [0, 1, 25, 1400, 1450, 1405, 9999, 10000]) assert.deepEqual(parsePercentToBps(bpsInputText(bps)), { ok: true, value: bps }, String(bps));
    assert.equal(bpsInputText(1450), '14.5');
    assert.equal(bpsInputText(1400), '14');
  });
  it('shipping and minimum may be zero; prices may not', () => {
    assert.deepEqual(parseMoneyInput('0', 1e8, true), { ok: true, value: 0 });
    assert.deepEqual(parseMoneyInput('0.00', 1e8, true), { ok: true, value: 0 });
    assert.equal(parseMoneyInput('0').ok, false);
    assert.equal(parseMoneyInput('50.005', 1e8, true).ok, false);
  });
});
