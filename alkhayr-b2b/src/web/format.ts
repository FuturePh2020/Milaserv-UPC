/**
 * Display formatting (stage 10). Pure functions, no DOM access.
 *
 * - Money arrives from the API as integer piasters (`…Cents`). It is formatted with integer
 *   arithmetic only (no floating division), so amounts up to the 1e13 limit stay exact.
 * - Digits: Western digits (0-9) are used for all amounts, quantities, dates and identifiers
 *   (D-106), so they read the same as barcodes, order numbers and typed input.
 * - Currency suffix: "ج.م" after the amount (Egyptian pound).
 */

const GROUPING = /\B(?=(\d{3})+(?!\d))/g;

function group(digits: string): string {
  return digits.replace(GROUPING, ',');
}

/** 1234567 -> "12,345.67 ج.م". Negative values keep a leading minus inside an LTR run. */
export function formatMoney(cents: number, options: { currency?: boolean } = {}): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('amount must be a safe integer number of piasters');
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const pounds = Math.floor(abs / 100);
  const piasters = abs % 100;
  const text = `${negative ? '-' : ''}${group(String(pounds))}.${String(piasters).padStart(2, '0')}`;
  return options.currency === false ? text : `${text} ج.م`;
}

/**
 * Informational per-piece price: carton price / pieces per carton, rounded half-up to whole
 * piasters. Display only — orders are always priced per carton by the server.
 */
export function piecePriceCents(cartonPriceCents: number, packSize: number): number {
  if (!Number.isSafeInteger(cartonPriceCents) || cartonPriceCents < 0) throw new RangeError('invalid carton price');
  if (!Number.isSafeInteger(packSize) || packSize < 1) throw new RangeError('invalid pack size');
  return Math.floor((cartonPriceCents * 2 + packSize) / (packSize * 2));
}

export function formatInteger(n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError('expected a safe integer');
  return (n < 0 ? '-' : '') + group(String(Math.abs(n)));
}

type PluralForms = { zero?: string; one: string; two: string; few: string; many: string; other: string };

const pluralRules = new Intl.PluralRules('ar');

/** Arabic counted noun with the number, e.g. 1 كرتونة، 2 كرتونتان، 3 كراتين، 11 كرتونة. */
export function countWithNoun(n: number, forms: PluralForms): string {
  const category = pluralRules.select(n) as keyof PluralForms;
  if (category === 'one') return forms.one;
  if (category === 'two') return forms.two;
  if (category === 'zero' && forms.zero) return forms.zero;
  const noun = forms[category] ?? forms.other;
  return `${formatInteger(n)} ${noun}`;
}

const CARTON: PluralForms = { zero: '0 كرتونة', one: 'كرتونة واحدة', two: 'كرتونتان', few: 'كراتين', many: 'كرتونة', other: 'كرتونة' };
const PIECE: PluralForms = { zero: '0 قطعة', one: 'قطعة واحدة', two: 'قطعتان', few: 'قطع', many: 'قطعة', other: 'قطعة' };
const LINE: PluralForms = { zero: 'لا أصناف', one: 'صنف واحد', two: 'صنفان', few: 'أصناف', many: 'صنفًا', other: 'صنف' };

export const formatCartons = (n: number): string => countWithNoun(n, CARTON);
export const formatPieces = (n: number): string => countWithNoun(n, PIECE);
export const formatLines = (n: number): string => countWithNoun(n, LINE);

/** "24 قطعة في الكرتونة" */
export function formatPackSize(packSize: number): string {
  return `${formatPieces(packSize)} في الكرتونة`;
}

/** Tax rate from basis points: 1400 -> "14%", 1250 -> "12.5%". */
export function formatBasisPoints(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0) throw new RangeError('invalid basis points');
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''}%`;
}

const dateTime = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' });
const dateOnly = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeZone: 'Africa/Cairo' });

/** Epoch milliseconds -> Cairo local date and time. */
export function formatDateTime(epochMs: number): string {
  return dateTime.format(new Date(epochMs));
}
export function formatDate(epochMs: number): string {
  return dateOnly.format(new Date(epochMs));
}
