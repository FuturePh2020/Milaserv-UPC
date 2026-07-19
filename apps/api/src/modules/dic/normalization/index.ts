export { normalizeArabic } from './arabic';
export type { NormalizeArabicOptions } from './arabic';
export { normalizeEnglish, foldDrugNameVariants } from './english';
export { parseStrengthText } from './strength';
export type { ParsedStrengthComponent } from './strength';
export { transliterateLatinToArabic, transliterateArabicToLatin } from './transliteration';

import { normalizeArabic } from './arabic';
import { foldDrugNameVariants } from './english';

/** Dispatches on a rough script guess (any Arabic-block codepoint present
 *  → Arabic normalizer) — used for free-form search-box input, where the
 *  caller doesn't already know the field's language the way a Drug row
 *  does (Drug always normalizes nameEn via foldDrugNameVariants and
 *  nameAr via normalizeArabic explicitly, never through this guesser). */
// U+0600-06FF (the Arabic Unicode block) — written as an explicit \u
// range, not a pasted glyph pair, per this module's own documented
// lesson (see arabic.ts's doc comment) about visual Arabic ranges.
const ARABIC_BLOCK = /[؀-ۿ]/;

export function normalizeSearchInput(text: string): string {
  return ARABIC_BLOCK.test(text) ? normalizeArabic(text) : foldDrugNameVariants(text);
}
