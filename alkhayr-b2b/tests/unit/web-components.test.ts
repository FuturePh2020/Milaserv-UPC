import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { loadWebModules } from '../helpers/web.ts';

// Markup-level checks of the shared components and shells (React server rendering).
// Interaction (focus trap, Escape, drawer) is verified in a real browser (docs/PROJECT_STATE.md).
let w: any;
before(async () => {
  w = await loadWebModules([
    'src/web/components/Product.tsx',
    'src/web/components/Badges.tsx',
    'src/web/components/OrderTimeline.tsx',
    'src/web/components/Summary.tsx',
    'src/web/components/DataTable.tsx',
    'src/web/components/Feedback.tsx',
    'src/web/components/Form.tsx',
    'src/web/components/QuantityStepper.tsx',
    'src/web/components/Button.tsx',
    'src/web/layouts/Shells.tsx',
  ]);
});
const html = (el: unknown) => w.renderToStaticMarkup(el) as string;
const h = (...args: unknown[]) => w.createElement(...args);

const product = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'شيكولاتة بالبندق',
  brand: 'براند',
  category: { id: 'chocolate', labelAr: 'شيكولاتة' },
  barcode: '0012345678905',
  imageUrl: null,
  cartonPriceCents: 125_550,
  packSize: 24,
  minimumCartons: 2,
  availability: { status: 'low_stock', labelAr: 'كمية محدودة' },
  isDemo: false,
};

describe('web components (markup)', () => {
  test('product card: carton price vs informational piece price, units, LTR barcode, status text only', () => {
    const out = html(h(w.ProductCard, { product }));
    assert.match(out, /1,255\.50/);
    assert.match(out, /سعر الكرتونة/);
    assert.match(out, /للعلم فقط: حوالي <bdi dir="ltr" class="ltr">52\.31<\/bdi> ج\.م للقطعة/);
    assert.match(out, /24 قطعة في الكرتونة/);
    assert.match(out, /كرتونتان/); // minimum 2 cartons
    assert.match(out, /<bdi dir="ltr" class="ltr mono">0012345678905<\/bdi>/);
    assert.match(out, /كمية محدودة/);
    assert.match(out, /لا توجد صورة/);
    assert.doesNotMatch(out, /onHand|reserved|available|متاح:\s*\d/);
  });

  test('status badges always carry text (not colour alone)', () => {
    for (const state of ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled']) {
      const out = html(h(w.OrderStatusBadge, { state }));
      assert.match(out, /class="c-badge [^"]+"[^>]*><svg[^>]+aria-hidden="true"/);
      assert.ok(out.replace(/<[^>]+>/g, '').trim().length > 2, state);
    }
    assert.match(html(h(w.AvailabilityBadge, { status: 'out_of_stock' })), /غير متوفر/);
  });

  test('timeline: trader events show no actor or reason; administrator events show them when present', () => {
    const events = [
      { fromState: null, toState: 'pending', at: Date.UTC(2026, 10, 12, 8) },
      { fromState: 'pending', toState: 'cancelled', at: Date.UTC(2026, 10, 12, 9) },
    ];
    const trader = html(h(w.OrderTimeline, { state: 'cancelled', events }));
    assert.match(trader, /ملغي/);
    assert.doesNotMatch(trader, /بواسطة|السبب/);
    const admin = html(h(w.OrderTimeline, { state: 'cancelled', events: [events[0], { ...events[1], actor: 'admin.one', reason: 'طلب التاجر' }] }));
    assert.match(admin, /بواسطة admin\.one/);
    assert.match(admin, /السبب: طلب التاجر/);
    const progressing = html(h(w.OrderTimeline, { state: 'confirmed', events: [events[0], { fromState: 'pending', toState: 'confirmed', at: 1 }] }));
    assert.match(progressing, /aria-current="step"/);
    assert.match(progressing, /لم تتم بعد/);
  });

  test('totals render the stored snapshot amounts', () => {
    const out = html(h(w.OrderTotals, { amounts: { subtotalCents: 709_980, shippingCents: 0, shippingTaxable: false, taxBps: 1400, taxBaseCents: 709_980, taxCents: 99_397, totalCents: 809_377, minimumOrderCents: 0 } }));
    assert.match(out, /7,099\.80/);
    assert.match(out, /بدون رسوم/);
    assert.match(out, /الضريبة \(14%\)/);
    assert.match(out, /8,093\.77/);
  });

  test('data table: caption, scoped headers, keyboard-scrollable region', () => {
    const out = html(
      h(w.DataTable, {
        caption: 'الطلبات',
        rows: [{ id: 'a', n: 'AK-1' }],
        rowKey: (r: { id: string }) => r.id,
        columns: [{ key: 'n', header: 'رقم', rowHeader: true, cell: (r: { n: string }) => r.n }, { key: 't', header: 'الإجمالي', numeric: true, cell: () => '1' }],
      }),
    );
    assert.match(out, /role="region" aria-label="الطلبات" tabindex="0"/);
    assert.match(out, /<caption>الطلبات<\/caption>/);
    assert.match(out, /<th scope="col"/);
    assert.match(out, /<th scope="row"/);
  });

  test('error states: request id kept, retry offered only where meaningful, announced', () => {
    const failure = { ok: false, kind: 'server', status: 500, code: 'INTERNAL', message: 'خطأ', requestId: 'req-9', fields: [], current: null, retryAfterSeconds: null };
    const out = html(h(w.ErrorState, { failure, onRetry: () => undefined }));
    assert.match(out, /role="alert"/);
    assert.match(out, /req-9/);
    assert.match(out, /إعادة المحاولة/);
    const forbidden = html(h(w.ErrorState, { failure: { ...failure, kind: 'forbidden', status: 403 }, onRetry: () => undefined }));
    assert.doesNotMatch(forbidden, /إعادة المحاولة/);
    const conflict = html(h(w.ConflictNotice, { failure: { ...failure, kind: 'conflict', status: 409 } }));
    assert.match(conflict, /ما أدخلته ما زال محفوظًا/);
  });

  test('form fields: label association, hint/error described-by, invalid state; busy buttons', () => {
    const out = html(h(w.Field, { label: 'الهاتف', hint: 'رقم مصري', error: 'غير صحيح', children: (p: object) => h(w.TextInput, p) }));
    const id = /<label class="c-field__label" for="([^"]+)"/.exec(out)?.[1];
    assert.ok(id);
    assert.match(out, new RegExp(`<input id="${id}" aria-describedby="${id}-hint ${id}-error" aria-invalid="true"`));
    const busy = html(h(w.Button, { busy: true, busyLabel: 'جارٍ الإرسال…', children: 'إرسال' }));
    assert.match(busy, /disabled=""/);
    assert.match(busy, /aria-busy="true"/);
    const icon = html(h(w.IconButton, { icon: 'close', label: 'إغلاق' }));
    assert.match(icon, /aria-label="إغلاق"/);
  });

  test('quantity control: whole cartons with minimum hint and labelled +/- buttons', () => {
    const out = html(h(w.QuantityStepper, { value: 2, text: '2', min: 2, onChange: () => undefined }));
    assert.match(out, /inputMode="numeric"|inputmode="numeric"/);
    assert.match(out, /aria-label="إنقاص كرتونة"[^>]*disabled=""|disabled=""[^>]*aria-label="إنقاص كرتونة"/);
    assert.match(out, /أقل كمية: كرتونتان/);
  });

  test('shells: traders never get administrator navigation; pending merchants get no catalog/orders; logout always present', () => {
    const account = { businessName: 'متجر', username: 'u' };
    const merchant = html(h(w.MerchantLayout, { kind: 'merchant', account, path: '/catalog', onLogout: () => undefined, children: 'x' }));
    assert.doesNotMatch(merchant, /href="#\/admin/);
    assert.match(merchant, /href="#\/catalog" aria-current="page"/);
    assert.match(merchant, /aria-label="تسجيل الخروج"/);
    const pending = html(h(w.MerchantLayout, { kind: 'pending', account, path: '/account', onLogout: () => undefined, children: 'x' }));
    assert.doesNotMatch(pending, /href="#\/(catalog|orders|admin)/);
    assert.match(pending, /aria-label="تسجيل الخروج"/);
    const admin = html(h(w.AdminLayout, { account, path: '/admin/orders', onLogout: () => undefined, children: 'x' }));
    assert.match(admin, /href="#\/admin\/inventory"/);
    assert.match(admin, /aria-label="فتح قائمة الإدارة"/);
    assert.match(admin, /تخطَّ إلى المحتوى/);
  });
});
