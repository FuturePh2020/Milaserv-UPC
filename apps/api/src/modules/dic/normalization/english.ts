/**
 * English/Latin text normalization (Phase 4 design doc §13) — the base
 * rules are ported from services/ocr-service/app/ocr/normalization.py
 * (CR-001 Sprint OCR-03); `foldDrugNameVariants` below is new, DIC-
 * specific logic layered on top for the design doc's own worked example:
 * "Augmentin-1GM" / "AUGMENTIN 1 GM" / "Augmentin 1g" / "Augmentin / 1 g"
 * should all become comparable. Original values are never mutated by
 * this module — these functions only ever produce a *separate*
 * normalized/search string.
 */

// Curly/smart quotes and common OCR-misread quote glyphs → straight ASCII.
const QUOTE_MAP = new Map<string, string>([
  [String.fromCodePoint(0x2018), "'"], // ‘
  [String.fromCodePoint(0x2019), "'"], // ’
  [String.fromCodePoint(0x201c), '"'], // “
  [String.fromCodePoint(0x201d), '"'], // ”
  [String.fromCodePoint(0x00b4), "'"], // ´
  [String.fromCodePoint(0x0060), "'"], // `
]);
// En dash, em dash, minus sign, non-breaking hyphen, figure dash → ASCII hyphen.
const HYPHEN_MAP = new Map<string, string>([
  [String.fromCodePoint(0x2010), '-'],
  [String.fromCodePoint(0x2011), '-'],
  [String.fromCodePoint(0x2012), '-'],
  [String.fromCodePoint(0x2013), '-'], // –
  [String.fromCodePoint(0x2014), '-'], // —
  [String.fromCodePoint(0x2212), '-'], // −
]);

const WHITESPACE_RUN = /\s+/g;

/** Searchable normalization for English/Latin text: NFKC, quote/hyphen
 *  normalization, lowercase, whitespace collapse. Mirrors the OCR-03
 *  Python normalizer's own scope exactly — no drug-specific logic here,
 *  see foldDrugNameVariants for that. */
export function normalizeEnglish(text: string): string {
  let result = text.normalize('NFKC');
  result = Array.from(result)
    .map((ch) => QUOTE_MAP.get(ch) ?? ch)
    .join('');
  result = Array.from(result)
    .map((ch) => HYPHEN_MAP.get(ch) ?? ch)
    .join('');
  result = result.toLowerCase();
  result = result.replace(WHITESPACE_RUN, ' ').trim();
  return result;
}

// Common informal unit abbreviations seen in trade names/strength text —
// folded to one canonical spelling so e.g. "1gm" and "1 g" compare equal.
// Deliberately small and conservative: only unambiguous, extremely common
// drug-label abbreviations, never a general English spell-checker.
const UNIT_ABBREVIATION_ALIASES: [RegExp, string][] = [
  [/\bgm\b/g, 'g'],
  [/\bgms\b/g, 'g'],
  [/\bmgs\b/g, 'mg'],
  [/\bmcgs\b/g, 'mcg'],
  [/\bmls\b/g, 'ml'],
  [/\biu\b/g, 'iu'],
];

/** DIC-specific layer on top of normalizeEnglish (design doc §13): folds
 *  the most common trade-name formatting variance a monthly feed and a
 *  human-typed correction disagree on — hyphen/slash-as-separator,
 *  smashed-together letter+digit runs, and a short list of unit-
 *  abbreviation synonyms. This is a *search* aid; it never touches the
 *  drug's own stored name. */
export function foldDrugNameVariants(text: string): string {
  let result = normalizeEnglish(text);
  // Treat hyphen/slash as a word separator, same as a space.
  result = result.replace(/[-/]/g, ' ');
  // "1gm" / "500mg" → "1 gm" / "500 mg" — split a run of digits directly
  // followed by letters, but only when that digit run starts a token
  // (preceded by whitespace or the start of the string). Two things this
  // guards against: trade names routinely end in a digit (e.g. "Vitamin
  // B12", never to be split before the "12"), and an identifier can have
  // a digit stuck mid-word with letters already on both sides (e.g.
  // "E2E") — requiring the digit run to *start* a token means neither
  // gets touched, only a genuine leading "quantity+unit" token like
  // "1gm" does.
  result = result.replace(/(^|\s)(\d+)([a-z]+)/g, '$1$2 $3');
  for (const [pattern, canonical] of UNIT_ABBREVIATION_ALIASES) {
    result = result.replace(pattern, canonical);
  }
  result = result.replace(WHITESPACE_RUN, ' ').trim();
  return result;
}
