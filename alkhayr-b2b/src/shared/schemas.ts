import { z } from 'zod';

/**
 * Shared input normalization/validation. Used by the operator CLI now and by
 * registration/profile endpoints in later stages so the rules stay identical.
 * Constraints mirror the database CHECKs in migrations/0001_initial.sql.
 */

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** NFKC, trim, lowercase. Usernames (unlike passwords) may be normalized. */
export function normalizeUsername(input: string): string {
  return input.normalize('NFKC').trim().toLowerCase();
}

export const usernameSchema = z
  .string()
  .max(256)
  .transform(normalizeUsername)
  .pipe(z.string().regex(USERNAME_PATTERN, 'اسم المستخدم من 3 إلى 32 حرفًا إنجليزيًا صغيرًا أو أرقامًا أو . _ - ويبدأ بحرف أو رقم'));

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

/** Converts Arabic-Indic digits to ASCII and removes spaces, dashes and parentheses. */
export function normalizePhone(input: string): string {
  return input
    .normalize('NFKC')
    .replace(ARABIC_INDIC, (d) => String((d.charCodeAt(0) & 0x0f) % 10))
    .replace(/[\s\-()]/g, '');
}

const EGYPT_MOBILE = /^01[0125]\d{8}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

const text = (min: number, max: number, message: string) =>
  z.string().max(max * 4).transform((s) => s.normalize('NFC').trim()).pipe(z.string().min(min, message).max(max, message));

export const merchantProfileSchema = z.strictObject({
  businessName: text(2, 120, 'اسم المنشأة من 2 إلى 120 حرفًا'),
  contactName: text(2, 80, 'اسم المسؤول من 2 إلى 80 حرفًا'),
  email: z
    .string()
    .max(254)
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.union([z.literal(''), z.email('البريد الإلكتروني غير صحيح')]))
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional()
    .transform((s) => s ?? null),
  phone: z
    .string()
    .max(40)
    .transform(normalizePhone)
    .pipe(z.string().refine((p) => EGYPT_MOBILE.test(p) || E164.test(p), 'رقم الهاتف غير صحيح (مثال: 01012345678)')),
  governorate: text(2, 60, 'المحافظة من 2 إلى 60 حرفًا'),
  address: text(5, 300, 'العنوان من 5 إلى 300 حرف'),
});

export type MerchantProfileInput = z.input<typeof merchantProfileSchema>;
export type MerchantProfile = z.output<typeof merchantProfileSchema>;
