/**
 * Transliteration foundation (Phase 4 design doc §14) — rule-based,
 * best-effort candidate generation between Arabic-script and Latin-
 * script spellings of a drug name (e.g. "Augmentin" ↔ an Arabic
 * rendering). This is explicitly NOT a phonetic/ML transliteration
 * engine — it produces one plausible candidate per direction, always
 * meant to be stored as an unapproved DrugAlias
 * (aliasType: ARABIC_TRANSLITERATION / ENGLISH_TRANSLITERATION,
 * source: SYSTEM_GENERATED, approved: false) and reviewed by a human,
 * never used directly for matching (design doc: "Do not rely on one
 * transliteration string only... Do not auto-approve").
 */

// Latin → Arabic: longest-match-first digraph/letter table. Deliberately
// simple (one output per input), not a full phonetic model.
const LATIN_TO_ARABIC: [string, string][] = [
  ['kh', String.fromCodePoint(0x062e)],
  ['gh', String.fromCodePoint(0x063a)],
  ['th', String.fromCodePoint(0x062b)],
  ['sh', String.fromCodePoint(0x0634)],
  ['ch', String.fromCodePoint(0x062a, 0x0634)],
  ['ph', String.fromCodePoint(0x0641)],
  ['a', String.fromCodePoint(0x0627)],
  ['b', String.fromCodePoint(0x0628)],
  ['c', String.fromCodePoint(0x0643)],
  ['d', String.fromCodePoint(0x062f)],
  ['e', String.fromCodePoint(0x0627)],
  ['f', String.fromCodePoint(0x0641)],
  ['g', String.fromCodePoint(0x062c)],
  ['h', String.fromCodePoint(0x0647)],
  ['i', String.fromCodePoint(0x064a)],
  ['j', String.fromCodePoint(0x062c)],
  ['k', String.fromCodePoint(0x0643)],
  ['l', String.fromCodePoint(0x0644)],
  ['m', String.fromCodePoint(0x0645)],
  ['n', String.fromCodePoint(0x0646)],
  ['o', String.fromCodePoint(0x0648)],
  ['p', String.fromCodePoint(0x0628)],
  ['q', String.fromCodePoint(0x0642)],
  ['r', String.fromCodePoint(0x0631)],
  ['s', String.fromCodePoint(0x0633)],
  ['t', String.fromCodePoint(0x062a)],
  ['u', String.fromCodePoint(0x0648)],
  ['v', String.fromCodePoint(0x0641)],
  ['w', String.fromCodePoint(0x0648)],
  ['x', String.fromCodePoint(0x0643, 0x0633)],
  ['y', String.fromCodePoint(0x064a)],
  ['z', String.fromCodePoint(0x0632)],
];

/** One best-effort Arabic rendering of a Latin drug name. Always meant
 *  to be stored as an unapproved alias, never used directly. */
export function transliterateLatinToArabic(text: string): string {
  const lower = text.toLowerCase();
  let result = '';
  let i = 0;
  outer: while (i < lower.length) {
    for (const [latin, arabic] of LATIN_TO_ARABIC) {
      if (lower.startsWith(latin, i)) {
        result += arabic;
        i += latin.length;
        continue outer;
      }
    }
    // Unmapped character (digit, space, punctuation) — pass through.
    result += lower[i];
    i += 1;
  }
  return result;
}

// Arabic → Latin: the inverse single-letter mapping (digraphs collapse
// on the way back, so this is intentionally coarser than the forward
// direction — another reason this is a candidate, not an answer).
const ARABIC_TO_LATIN = new Map<string, string>([
  [String.fromCodePoint(0x0627), 'a'],
  [String.fromCodePoint(0x0628), 'b'],
  [String.fromCodePoint(0x062a), 't'],
  [String.fromCodePoint(0x062b), 'th'],
  [String.fromCodePoint(0x062c), 'j'],
  [String.fromCodePoint(0x062d), 'h'],
  [String.fromCodePoint(0x062e), 'kh'],
  [String.fromCodePoint(0x062f), 'd'],
  [String.fromCodePoint(0x0630), 'th'],
  [String.fromCodePoint(0x0631), 'r'],
  [String.fromCodePoint(0x0632), 'z'],
  [String.fromCodePoint(0x0633), 's'],
  [String.fromCodePoint(0x0634), 'sh'],
  [String.fromCodePoint(0x0635), 's'],
  [String.fromCodePoint(0x0636), 'd'],
  [String.fromCodePoint(0x0637), 't'],
  [String.fromCodePoint(0x0638), 'z'],
  [String.fromCodePoint(0x0639), 'a'],
  [String.fromCodePoint(0x063a), 'gh'],
  [String.fromCodePoint(0x0641), 'f'],
  [String.fromCodePoint(0x0642), 'q'],
  [String.fromCodePoint(0x0643), 'k'],
  [String.fromCodePoint(0x0644), 'l'],
  [String.fromCodePoint(0x0645), 'm'],
  [String.fromCodePoint(0x0646), 'n'],
  [String.fromCodePoint(0x0647), 'h'],
  [String.fromCodePoint(0x0648), 'w'],
  [String.fromCodePoint(0x064a), 'y'],
  [String.fromCodePoint(0x0629), 'a'], // teh marbuta — fine for a Latin *candidate*, unlike search normalization
]);

/** One best-effort Latin rendering of an Arabic drug name. Always meant
 *  to be stored as an unapproved alias, never used directly. */
export function transliterateArabicToLatin(text: string): string {
  return Array.from(text)
    .map((ch) => ARABIC_TO_LATIN.get(ch) ?? ch)
    .join('');
}
