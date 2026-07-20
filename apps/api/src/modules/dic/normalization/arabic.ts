/**
 * Arabic text normalization (Phase 4 design doc §12) — ported from the
 * already-built and tested rules in
 * services/ocr-service/app/ocr/normalization.py (CR-001 Sprint OCR-03).
 * Same behavior, same explicit exclusion: raw values are never mutated
 * by this module, and teh marbuta (U+0629, ة) is never folded to
 * heh (U+0647, ه) — that substitution changes grammatical meaning and
 * would corrupt search results, not just cosmetically normalize them.
 *
 * Every non-ASCII literal below is written as an explicit \u escape,
 * never a pasted glyph — a visually-plausible Arabic character range
 * pasted into source is not reliably verifiable by eye, and an earlier
 * draft of this exact file proved that by silently swallowing the
 * Arabic-Indic digit range into what was meant to be a diacritics-only
 * regex. \u escapes are plain ASCII source text with no such risk, and
 * every range here was verified codepoint-by-codepoint against the
 * Python source before being written this way.
 */

const TATWEEL = 'ـ';
// Arabic combining diacritics (harakat/tanwin/sukun/shadda) U+064B-065F,
// the standalone U+0670 (superscript alef), and the Quranic annotation
// marks U+06D6-06ED — matches services/ocr-service's Python pattern
// codepoint-by-codepoint. Deliberately excludes U+0660-0669 (the
// Arabic-Indic digits, handled separately below).
const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
// Arabic-Indic (U+0660-0669) and Extended Arabic-Indic/Persian
// (U+06F0-06F9) digits, in order, mapped to Western 0-9.
const ARABIC_INDIC_DIGITS = Array.from({ length: 10 }, (_, i) => String.fromCodePoint(0x0660 + i));
const PERSIAN_DIGITS = Array.from({ length: 10 }, (_, i) => String.fromCodePoint(0x06f0 + i));
const DIGIT_MAP = new Map<string, string>();
for (let i = 0; i < 10; i++) {
  DIGIT_MAP.set(ARABIC_INDIC_DIGITS[i]!, String(i));
  DIGIT_MAP.set(PERSIAN_DIGITS[i]!, String(i));
}
// U+0623 (hamza above), U+0625 (hamza below), U+0622 (madda) → bare
// alef U+0627, and U+0649 (alef maksura) → U+064A (yeh) — standard
// Arabic *search* normalization. Deliberately NOT included: U+0629
// (teh marbuta) → U+0647 (heh) — see module doc comment.
const ALEF = String.fromCodePoint(0x0627);
const YEH = String.fromCodePoint(0x064a);
const ALEF_VARIANT_MAP = new Map<string, string>([
  [String.fromCodePoint(0x0623), ALEF],
  [String.fromCodePoint(0x0625), ALEF],
  [String.fromCodePoint(0x0622), ALEF],
  [String.fromCodePoint(0x0649), YEH],
]);

const WHITESPACE_RUN = /\s+/g;

export interface NormalizeArabicOptions {
  normalizeDigits?: boolean;
}

/** Searchable normalization for Arabic text. `text` is assumed to already
 *  be a raw source value — never mutated in place, only read. */
export function normalizeArabic(text: string, options: NormalizeArabicOptions = {}): string {
  const { normalizeDigits = true } = options;
  let result = text.normalize('NFKC');
  result = result.split(TATWEEL).join('');
  result = result.replace(ARABIC_DIACRITICS, '');
  result = Array.from(result)
    .map((ch) => ALEF_VARIANT_MAP.get(ch) ?? ch)
    .join('');
  if (normalizeDigits) {
    result = Array.from(result)
      .map((ch) => DIGIT_MAP.get(ch) ?? ch)
      .join('');
  }
  result = result.replace(WHITESPACE_RUN, ' ').trim();
  return result;
}
