/**
 * SYNTHETIC preview fixtures for the development component gallery ONLY.
 * Invented placeholder data to exercise layouts (long text, large amounts, every status).
 * Not real products, prices, merchants or orders; never sent to the server; never persisted;
 * never imported by the production entry (verified by tests via FIXTURE_MARKER).
 */
import type { AdminOrderSummary, ApiFailureLike, CatalogProduct, Order } from './types.ts';

export const FIXTURE_MARKER = 'ALKHAYR-SYNTHETIC-PREVIEW-FIXTURE';

const ids = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// A broken image (invalid data URL): exercises the image-failure placeholder without any network request.
const BROKEN_IMAGE = 'data:image/png;base64,AAAA';

export const PRODUCTS: CatalogProduct[] = [
  {
    id: ids(1),
    name: 'منتج تجريبي — شيكولاتة بالحليب',
    brand: 'ماركة تجريبية',
    category: { id: 'chocolate', labelAr: 'شيكولاتة' },
    barcode: '6220000000017',
    imageUrl: null,
    cartonPriceCents: 125_550,
    packSize: 24,
    minimumCartons: 1,
    availability: { status: 'normal', labelAr: 'متوفر' },
    isDemo: true,
  },
  {
    id: ids(2),
    name: 'منتج تجريبي باسم طويل جدًا لاختبار التفاف النص: كاندي فواكه مشكلة بنكهات متعددة في عبوات صغيرة للمحلات',
    brand: 'ماركة تجريبية ذات اسم طويل أيضًا',
    category: { id: 'candy', labelAr: 'كاندي' },
    barcode: '0012345678905',
    imageUrl: BROKEN_IMAGE,
    cartonPriceCents: 9_000,
    packSize: 48,
    minimumCartons: 5,
    availability: { status: 'low_stock', labelAr: 'كمية محدودة' },
    isDemo: true,
  },
  {
    id: ids(3),
    name: 'منتج تجريبي — ويفر بالكريمة',
    brand: 'ماركة تجريبية',
    category: { id: 'wafers_biscuits', labelAr: 'ويفر وبسكويت' },
    barcode: null,
    imageUrl: null,
    cartonPriceCents: 100_000_000,
    packSize: 7,
    minimumCartons: 2,
    availability: { status: 'out_of_stock', labelAr: 'غير متوفر' },
    isDemo: true,
  },
  {
    id: ids(4),
    name: 'منتج تجريبي — مكسرات محمصة',
    brand: 'ماركة تجريبية',
    category: { id: 'snacks_nuts', labelAr: 'سناكس ومكسرات' },
    barcode: 'ABC-000-TEST',
    imageUrl: null,
    cartonPriceCents: 33_333,
    packSize: 12,
    minimumCartons: 1,
    availability: { status: 'normal', labelAr: 'متوفر' },
    isDemo: true,
  },
];

const T0 = Date.UTC(2026, 10, 12, 8, 30);

export const ORDER: Order = {
  id: ids(10),
  displayNumber: 'AK-261112-TEST00',
  state: 'preparing',
  version: 3,
  isDemo: true,
  note: 'ملاحظة تجريبية: الاتصال قبل التوصيل.',
  requestKey: ids(11),
  buyer: { businessName: 'متجر تجريبي', contactName: 'اسم تجريبي', phone: '01000000000', governorate: 'القاهرة', address: 'عنوان تجريبي' },
  items: [
    { lineNo: 1, productId: ids(1), name: 'منتج تجريبي — شيكولاتة بالحليب', brand: 'ماركة تجريبية', barcode: '6220000000017', packSize: 24, cartonPriceCents: 125_550, cartons: 3, lineTotalCents: 376_650 },
    { lineNo: 2, productId: ids(4), name: 'منتج تجريبي — مكسرات محمصة', brand: 'ماركة تجريبية', barcode: 'ABC-000-TEST', packSize: 12, cartonPriceCents: 33_333, cartons: 10, lineTotalCents: 333_330 },
  ],
  amounts: { subtotalCents: 709_980, shippingCents: 7_500, shippingTaxable: false, taxBps: 1400, taxBaseCents: 709_980, taxCents: 99_397, totalCents: 816_877, minimumOrderCents: 0 },
  events: [
    { fromState: null, toState: 'pending', at: T0 },
    { fromState: 'pending', toState: 'confirmed', at: T0 + 3_600_000 },
    { fromState: 'confirmed', toState: 'preparing', at: T0 + 7_200_000 },
  ],
  createdAt: T0,
  updatedAt: T0 + 7_200_000,
};

/** Largest permitted order total (1e13 piasters) to check wrapping of large amounts. */
export const LARGE_AMOUNTS = { subtotalCents: 9_999_999_999_999, shippingCents: 1, shippingTaxable: true, taxBps: 0, taxBaseCents: 10_000_000_000_000, taxCents: 0, totalCents: 10_000_000_000_000, minimumOrderCents: 0 };

export const ADMIN_ROWS: AdminOrderSummary[] = (['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'] as const).map((state, i) => ({
  id: ids(20 + i),
  displayNumber: `AK-261112-TEST0${i}`,
  merchantId: ids(30 + i),
  buyerBusinessName: i === 1 ? 'شركة تجريبية ذات اسم تجاري طويل جدًا للتأكد من التفاف الأسماء الطويلة داخل الجدول' : `متجر تجريبي ${i + 1}`,
  buyerGovernorate: 'القاهرة',
  state,
  version: i + 1,
  isDemo: true,
  lineCount: i + 1,
  totalCents: i === 2 ? 10_000_000_000_000 : 125_550 * (i + 1),
  createdAt: T0 - i * 86_400_000,
  updatedAt: T0 - i * 86_400_000,
}));

const failure = (kind: ApiFailureLike['kind'], status: number, message: string, extra: Partial<ApiFailureLike> = {}): ApiFailureLike => ({
  ok: false,
  kind,
  status,
  code: null,
  message,
  requestId: '00000000-0000-4000-8000-0000000000ff',
  fields: [],
  current: null,
  retryAfterSeconds: null,
  ...extra,
});

export const FAILURES: ApiFailureLike[] = [
  failure('network', 0, 'تعذّر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.', { requestId: null }),
  failure('forbidden', 403, 'ليست لديك صلاحية لتنفيذ هذا الإجراء.'),
  failure('not_found', 404, 'المورد المطلوب غير موجود.'),
  failure('rate_limited', 429, 'عدد المحاولات كبير. حاول مرة أخرى لاحقًا.', { retryAfterSeconds: 420 }),
  failure('unavailable', 503, 'الخدمة غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.'),
  failure('server', 500, 'حدث خطأ غير متوقع في الخادم. حاول مرة أخرى لاحقًا.'),
];

export const CONFLICT = failure('conflict', 409, 'تم تعديل هذه البيانات بواسطة طلب آخر. راجع البيانات الحالية ثم أعد المحاولة.');

export const ACCOUNT = { businessName: 'متجر تجريبي للمعاينة — اسم تجاري طويل لاختبار الاقتطاع', username: 'preview.user' };
