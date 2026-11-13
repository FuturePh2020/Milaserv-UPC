import { AppError } from '../http/errors.ts';

/**
 * Report dates (stage 14). Timestamps stay stored as UTC epoch milliseconds (canonical, unchanged).
 * Report filters take CALENDAR DATES in the business time zone, Africa/Cairo (DST-aware, from the
 * runtime's IANA time-zone data):
 *   from = YYYY-MM-DD → the first instant of that Cairo day (inclusive)
 *   to   = YYYY-MM-DD → the first instant of the FOLLOWING Cairo day (exclusive)
 * so `to` includes the whole named day. The first instant is searched, not assumed to be 00:00,
 * because a DST change can skip local midnight (Egypt springs forward at 00:00).
 */
export const REPORT_TIME_ZONE = 'Africa/Cairo';
export const MAX_RANGE_DAYS = 3660;

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: REPORT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Cairo calendar date of an instant, "YYYY-MM-DD". */
export function localDate(ms: number): string {
  return dateFmt.format(new Date(ms));
}

/** "YYYY-MM-DD HH:mm" in Cairo time (exports). */
export function localDateTime(ms: number): string {
  const p = Object.fromEntries(timeFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** First UTC millisecond whose Cairo calendar date is `date` (minute search; offsets are whole minutes). */
export function startOfLocalDay(date: string): number {
  const m = DATE.exec(date)!;
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let lo = (base - 14 * 3_600_000) / 60_000; // in minutes; localDate(lo) < date
  let hi = (base + 14 * 3_600_000) / 60_000; // localDate(hi) >= date
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(mid * 60_000) < date) lo = mid;
    else hi = mid;
  }
  return hi * 60_000;
}

function nextDate(date: string): string {
  const m = DATE.exec(date)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return d.toISOString().slice(0, 10);
}

export interface DateRange {
  from: string;
  to: string;
  /** Inclusive lower bound (UTC ms). */
  startMs: number;
  /** Exclusive upper bound (UTC ms). */
  endMs: number;
}

export function dateRange(from: string, to: string): DateRange {
  if (!isValidDate(from)) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'from', message: 'تاريخ البداية بصيغة YYYY-MM-DD.' }] });
  if (!isValidDate(to)) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'to', message: 'تاريخ النهاية بصيغة YYYY-MM-DD.' }] });
  if (from > to) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'to', message: 'تاريخ النهاية قبل تاريخ البداية.' }] });
  const startMs = startOfLocalDay(from);
  const endMs = startOfLocalDay(nextDate(to));
  if (endMs - startMs > MAX_RANGE_DAYS * 86_400_000) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'to', message: `الفترة أطول من ${MAX_RANGE_DAYS} يومًا.` }] });
  return { from, to, startMs, endMs };
}
