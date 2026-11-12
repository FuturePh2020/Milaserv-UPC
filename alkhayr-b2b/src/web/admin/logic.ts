import type { MerchantStatus } from '../api/contracts.ts';

/**
 * Pure helpers for administrator forms. Presentation/usability only: the server re-validates
 * everything (strict schemas, CHECKs, ledger rules, transitions).
 */

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toAsciiDigits = (s: string) => s.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0x0f) % 10));

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Exact decimal pounds -> integer piastres. Accepts "12", "12.5", "12.50", "1,234.50" and
 * Arabic-Indic digits. Rejects more than two decimals (never rounds), signs, exponents and
 * anything else. Integer string arithmetic only (no floating point).
 */
export function parseMoneyInput(raw: string, max = 100_000_000): Parsed<number> {
  const s = toAsciiDigits(raw.trim()).replace(/[,٬]/g, '').replace('٫', '.');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) {
    if (/^\d+\.\d{3,}$/.test(s)) return { ok: false, message: 'السعر يقبل رقمين عشريين فقط (قروش)؛ لا يتم التقريب تلقائيًا.' };
    return { ok: false, message: 'أدخل السعر بالجنيه، مثل 125.50' };
  }
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  if (cents < 1) return { ok: false, message: 'السعر يجب أن يكون أكبر من صفر.' };
  if (cents > max) return { ok: false, message: `أقصى سعر للكرتونة ${(max / 100).toLocaleString('en-US')} ج.م` };
  return { ok: true, value: cents };
}

/** Piastres -> the text shown in a price field ("125.50"). */
export function moneyInputText(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function parseWhole(raw: string, min: number, max: number, label: string, allowNegative = false): Parsed<number> {
  const s = toAsciiDigits(raw.trim());
  if (!(allowNegative ? /^-?\d{1,10}$/ : /^\d{1,10}$/).test(s)) return { ok: false, message: `${label}: أدخل عددًا صحيحًا.` };
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < min || n > max) return { ok: false, message: `${label}: من ${min.toLocaleString('en-US')} إلى ${max.toLocaleString('en-US')}.` };
  return { ok: true, value: n };
}

export const MAX_ON_HAND = 1_000_000_000; // products.on_hand CHECK / inventory service limit

export type AdjustmentType = 'receipt' | 'correction_delta' | 'set_total';

export interface AdjustmentPreview {
  before: number;
  after: number;
  delta: number;
  reserved: number;
  availableAfter: number;
  error: null | 'no_change' | 'negative' | 'below_reserved' | 'above_max';
}

/** Informational preview of an adjustment on the displayed record (the server recomputes it). */
export function adjustmentPreview(current: { onHand: number; reserved: number }, type: AdjustmentType, amount: number): AdjustmentPreview {
  const delta = type === 'receipt' ? amount : type === 'correction_delta' ? amount : amount - current.onHand;
  const after = current.onHand + delta;
  const error = delta === 0 ? 'no_change' : after < 0 ? 'negative' : after < current.reserved ? 'below_reserved' : after > MAX_ON_HAND ? 'above_max' : null;
  return { before: current.onHand, after, delta, reserved: current.reserved, availableAfter: after - current.reserved, error };
}

export const ADJUSTMENT_ERROR: Record<NonNullable<AdjustmentPreview['error']>, string> = {
  no_change: 'العملية لا تغيّر الرصيد.',
  negative: 'لا يمكن أن يصبح الرصيد الإجمالي أقل من صفر.',
  below_reserved: 'لا يمكن أن يقل الرصيد الإجمالي عن الكمية المحجوزة لطلبات مؤكدة.',
  above_max: 'الرصيد الناتج أكبر من الحد المسموح.',
};

/**
 * Merchant status transitions as documented in API_CONTRACT §4a (the server enforces them; this
 * table only decides which choices to OFFER and what to explain before confirmation).
 */
export const MERCHANT_TRANSITIONS: Readonly<Record<MerchantStatus, ReadonlyArray<{ to: MerchantStatus; reasonRequired: boolean; endsSessions: boolean }>>> = {
  pending: [
    { to: 'approved', reasonRequired: false, endsSessions: false },
    { to: 'suspended', reasonRequired: true, endsSessions: true },
  ],
  approved: [
    { to: 'pending', reasonRequired: true, endsSessions: true },
    { to: 'suspended', reasonRequired: true, endsSessions: true },
  ],
  suspended: [
    { to: 'pending', reasonRequired: true, endsSessions: false },
    { to: 'approved', reasonRequired: true, endsSessions: false },
  ],
};

/** https URL without credentials (server canonicalizes and re-checks). Empty -> null. */
export function parseImageUrl(raw: string): Parsed<string | null> {
  const s = raw.trim();
  if (s === '') return { ok: true, value: null };
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password || s.includes('@')) return { ok: false, message: 'رابط الصورة يجب أن يبدأ بـ https:// ودون بيانات دخول.' };
    return { ok: true, value: s };
  } catch {
    return { ok: false, message: 'رابط الصورة غير صالح.' };
  }
}

/** Barcode kept EXACTLY as typed (case, leading zeros); only an empty field means "no barcode" (null). */
export function barcodeValue(raw: string): string | null {
  return raw === '' ? null : raw;
}
