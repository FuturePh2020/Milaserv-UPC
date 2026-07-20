import { normalizeArabic } from '../dic/normalization/arabic';
import { normalizeEnglish } from '../dic/normalization/english';

/** Phase 6 §2/§5 — reuses DIC's general-purpose text normalizers
 *  (Arabic diacritic/alef/yeh folding; English NFKC/quote/hyphen/
 *  lowercase folding). Neither is drug-specific — both are safe to
 *  reuse for city/district names, avoiding a second normalization
 *  implementation for the same underlying problem. */
export function normalizeLocationEnglish(text: string): string {
  return normalizeEnglish(text);
}

export function normalizeLocationArabic(text: string): string {
  return normalizeArabic(text);
}

/** Cheap script sniff so free-text Branch.city/district (which may be
 *  Arabic or English depending on the import source) is normalized
 *  with the right pipeline before being compared to both
 *  normalizedNameEn and normalizedNameAr. Written as an explicit \u
 *  escape range (U+0600-U+06FF, the Arabic Unicode block), never a
 *  pasted glyph — see arabic.ts's own doc comment for why. */
const ARABIC_SCRIPT = /[؀-ۿ]/;

export function normalizeLocationText(text: string): { en: string; ar: string } {
  const trimmed = text.trim();
  return ARABIC_SCRIPT.test(trimmed)
    ? { en: normalizeLocationEnglish(trimmed), ar: normalizeLocationArabic(trimmed) }
    : { en: normalizeLocationEnglish(trimmed), ar: trimmed };
}
