import type { z } from 'zod';
import { AppError } from './errors.ts';

/**
 * Strict query-string parsing: every parameter must be declared by the schema
 * (strictObject), may appear at most once, and is validated before use. Values
 * are only ever bound as SQL parameters or mapped through allow-lists.
 */
export function parseQuery<T>(query: URLSearchParams, schema: z.ZodType<T>): T {
  const raw: Record<string, string> = {};
  for (const [key, value] of query) {
    if (Object.hasOwn(raw, key)) throw new AppError('VALIDATION_FAILED', { fields: [{ path: key, message: 'المعامل مكرر.' }] });
    raw[key] = value;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      fields: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.map(String).join('.') || '(query)', message: /[؀-ۿ]/.test(i.message) ? i.message : 'معامل غير صالح أو غير مسموح به.' })),
    });
  }
  return parsed.data;
}
