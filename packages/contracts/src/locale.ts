/** Supported UI locales (blueprint §22 Localization: Arabic + English, RTL/LTR). */
export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const RTL_LOCALES: readonly Locale[] = ['ar'];

/** A user-facing label stored in both languages. */
export interface BilingualText {
  ar: string;
  en: string;
}
