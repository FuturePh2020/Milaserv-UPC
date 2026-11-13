import { LIMITS } from '../../shared/constants.ts';

/**
 * Strict, bounded CSV parser for administrator imports (stage 13; docs/API_CONTRACT.md §6).
 * Not a general-purpose parser and deliberately not lenient:
 *
 * - Input is raw bytes (≤ LIMITS.importMaxFileBytes). Invalid UTF-8 is REJECTED (never replaced),
 *   NUL bytes are rejected, one leading UTF-8 BOM is removed.
 * - Records end with LF or CRLF outside quotes. A bare CR outside quotes is an error.
 * - A field is quoted when it STARTS with '"'; inside, '""' is a literal quote and CR/LF are kept
 *   as text (multiline fields). After the closing quote only ',' or the end of the record may
 *   follow. A '"' inside an unquoted field is an error. An unterminated quote is an error.
 * - Completely empty physical lines (no characters at all, outside quotes) are ignored anywhere,
 *   including any number of trailing newlines. A line with only commas is a record.
 * - Cells are returned exactly as written: no trimming, no type conversion, no formula evaluation.
 * - Every record carries its starting physical line number (1-based, header = line 1 normally),
 *   so errors in multiline records point to where the record starts.
 */

export const MAX_FIELD_CHARS = 4096;

export interface CsvRecord {
  /** 1-based data record number (header excluded). */
  recordNo: number;
  /** Physical line where the record starts. */
  line: number;
  cells: string[];
}

export interface CsvTable {
  header: string[];
  headerLine: number;
  records: CsvRecord[];
}

export type CsvResult = { ok: true; table: CsvTable } | { ok: false; line: number | null; message: string };

const fail = (message: string, line: number | null = null): CsvResult => ({ ok: false, line, message });

export function parseCsv(bytes: Uint8Array, maxRows: number = LIMITS.importMaxRows, maxBytes: number = LIMITS.importMaxFileBytes): CsvResult {
  if (bytes.length === 0) return fail('الملف فارغ.');
  if (bytes.length > maxBytes) return fail(`حجم الملف أكبر من ${maxBytes} بايت (1 ميجابايت).`);
  if (bytes.includes(0)) return fail('الملف يحتوي على بايت صفري (NUL)؛ ليس ملف CSV نصيًا صالحًا.');
  let text: string;
  try {
    // ignoreBOM: false → one leading BOM is consumed by the decoder; fatal → no silent replacement.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return fail('الملف ليس بترميز UTF-8 صالح. احفظه من برنامج الجداول بصيغة «CSV UTF-8».');
  }
  if (text.startsWith('﻿')) return fail('علامة BOM مكررة في بداية الملف.', 1);

  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let i = 0;
  let quoted = false; // current field started with a quote
  let inQuotes = false; // currently inside an open quoted section
  let fieldStarted = false; // any character (or quote) consumed for the current record
  const n = text.length;

  const endField = (): CsvResult | null => {
    if (field.length > MAX_FIELD_CHARS) return fail(`خلية أطول من ${MAX_FIELD_CHARS} حرف.`, recordLine);
    cells.push(field);
    field = '';
    quoted = false;
    return null;
  };
  const endRecord = (): CsvResult | null => {
    const e = endField();
    if (e) return e;
    // An empty physical line (single empty unquoted cell, nothing consumed) is ignored.
    if (!(cells.length === 1 && cells[0] === '' && !fieldStarted)) {
      records.push({ line: recordLine, cells });
      if (records.length > maxRows + 1) return fail(`عدد الصفوف أكبر من ${maxRows} صف بيانات.`);
    }
    cells = [];
    fieldStarted = false;
    return null;
  };

  while (i < n) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        const next = text[i];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
          return fail('علامة اقتباس (") في غير موضعها: بعد إغلاق الاقتباس يجب أن تأتي فاصلة أو نهاية السطر.', line);
        }
        continue;
      }
      if (c === '\n') line += 1;
      field += c;
      if (field.length > MAX_FIELD_CHARS) return fail(`خلية أطول من ${MAX_FIELD_CHARS} حرف.`, recordLine);
      i += 1;
      continue;
    }
    if (c === ',') {
      fieldStarted = true;
      const e = endField();
      if (e) return e;
      i += 1;
      continue;
    }
    if (c === '\r') {
      if (text[i + 1] !== '\n') return fail('نهاية سطر غير صالحة (CR بدون LF).', line);
      i += 1;
      continue; // handled by the LF branch
    }
    if (c === '\n') {
      const e = endRecord();
      if (e) return e;
      line += 1;
      recordLine = line;
      i += 1;
      continue;
    }
    if (c === '"') {
      if (field.length > 0 || quoted) return fail('علامة اقتباس (") داخل خلية غير محاطة بعلامات اقتباس. ضع الخلية كاملة بين علامتي اقتباس وضاعف الاقتباس الداخلي ("").', line);
      quoted = true;
      inQuotes = true;
      fieldStarted = true;
      i += 1;
      continue;
    }
    if (quoted) return fail('علامة اقتباس (") في غير موضعها.', line);
    field += c;
    fieldStarted = true;
    if (field.length > MAX_FIELD_CHARS) return fail(`خلية أطول من ${MAX_FIELD_CHARS} حرف.`, recordLine);
    i += 1;
  }
  if (inQuotes) return fail('علامة اقتباس مفتوحة لم تُغلق حتى نهاية الملف.', recordLine);
  if (fieldStarted || field.length > 0 || cells.length > 0) {
    const e = endRecord();
    if (e) return e;
  }

  if (records.length === 0) return fail('الملف لا يحتوي على صف العناوين.');
  const [head, ...data] = records;
  if (data.length === 0) return fail('الملف لا يحتوي على أي صف بيانات بعد صف العناوين.');
  if (data.length > maxRows) return fail(`عدد صفوف البيانات ${data.length} أكبر من الحد (${maxRows}).`);
  return {
    ok: true,
    table: {
      header: head!.cells,
      headerLine: head!.line,
      records: data.map((r, k) => ({ recordNo: k + 1, line: r.line, cells: r.cells })),
    },
  };
}

// ------------------------------------------------------------------ strict cell grammars

export type Cell<T> = { ok: true; value: T } | { ok: false; message: string };

const NON_ASCII_DIGIT = /[٠-٩۰-۹]/;

/**
 * Whole number: ASCII digits only, no sign, no spaces, no separators, no leading zeros
 * (except "0"), no exponent/decimal point. Never parseInt/parseFloat.
 */
export function wholeNumber(raw: string, min: number, max: number, label: string): Cell<number> {
  if (NON_ASCII_DIGIT.test(raw)) return { ok: false, message: `${label}: استخدم الأرقام 0-9 فقط.` };
  if (!/^(0|[1-9][0-9]{0,9})$/.test(raw)) {
    if (/^-?[0-9]+[.,][0-9]+$/.test(raw) || /e/i.test(raw)) return { ok: false, message: `${label}: يجب أن يكون عددًا صحيحًا بدون كسور أو فواصل أو صيغة أُسّية.` };
    return { ok: false, message: `${label}: عدد صحيح غير صالح «${raw.slice(0, 20)}».` };
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) return { ok: false, message: `${label}: يجب أن يكون من ${min} إلى ${max}.` };
  return { ok: true, value };
}

/**
 * Money in decimal Egyptian pounds → integer piastres. Grammar: ^(0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?$
 * Dot as the only decimal separator; at most two decimals (never rounded); no thousands separators,
 * currency symbols, spaces, signs or exponents. Integer string arithmetic only.
 */
export function moneyEgp(raw: string, minCents: number, maxCents: number, label: string): Cell<number> {
  if (NON_ASCII_DIGIT.test(raw)) return { ok: false, message: `${label}: استخدم الأرقام 0-9 والنقطة العشرية فقط.` };
  const m = /^(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,2}))?$/.exec(raw);
  if (!m) {
    if (/^[0-9]+\.[0-9]{3,}$/.test(raw)) return { ok: false, message: `${label}: رقمان عشريان على الأكثر (قروش)؛ لا يتم التقريب.` };
    if (/[,٬٫]/.test(raw)) return { ok: false, message: `${label}: لا تستخدم فواصل الآلاف أو الفاصلة العشرية؛ اكتب مثل 1250.50` };
    return { ok: false, message: `${label}: مبلغ غير صالح «${raw.slice(0, 20)}». اكتب بالجنيه مثل 125.50` };
  }
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  if (cents < minCents || cents > maxCents) return { ok: false, message: `${label}: من ${(minCents / 100).toFixed(2)} إلى ${(maxCents / 100).toFixed(2)} جنيه.` };
  return { ok: true, value: cents };
}
