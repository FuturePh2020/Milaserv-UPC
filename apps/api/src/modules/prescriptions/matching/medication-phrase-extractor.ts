import { DosageFormParser } from './dosage-form-parser';
import { UnitNormalizer } from './unit-normalizer';

/**
 * CR-001 Phase 5 — pure medication-phrase extraction from one
 * segmented line's text (design summary §5). Never forces every line
 * to be a medication — a line with no drug-relevant span still returns
 * a low-confidence result with `probableDrugName` set to whatever text
 * remains, letting the caller (the segmenter's classifier, or a human
 * reviewer) decide whether it's really a medication line.
 */

export interface ExtractedMedicationPhrase {
  probableDrugName: string | null;
  probableScientificName: string | null;
  probableStrength: string | null;
  probableDosageForm: string | null;
  /** Not populated by this pure text extractor — manufacturer/package
   *  evidence comes from DB-backed context expansion (design summary
   *  §6 level 8), never fabricated from text alone. */
  probableManufacturer: string | null;
  probablePackage: string | null;
  residualInstructionText: string | null;
  confidence: number;
}

const INSTRUCTION_KEYWORDS = [
  'once daily',
  'twice daily',
  'three times',
  'bid',
  'tid',
  'qid',
  'before meal',
  'after meal',
  'مرة',
  'مرتين',
  'ثلاث مرات',
  'يوميا',
  'يومياً',
  'قبل الأكل',
  'بعد الأكل',
  'قبل الطعام',
  'بعد الطعام',
];

/** A number/unit pair only counts as a strength span if the unit text
 *  actually resolves — otherwise "Panadol Extra 24" (a pack count, not
 *  a strength) would be misread. Concentration and same-unit-ratio
 *  shapes are tried before the plain single-value shape so "250 mg / 5
 *  ml" is never partially matched as just "250 mg". */
function findStrengthSpan(
  text: string,
  units: UnitNormalizer,
): { match: string; start: number; end: number } | null {
  const patterns = [
    /\d+(?:\.\d+)?\s*[a-zA-Z%]+\s*\/\s*\d*(?:\.\d+)?\s*[a-zA-Z%]+/g, // concentration
    /\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*[a-zA-Z%]+/g, // ratio + trailing unit
    /\d+(?:\.\d+)?\s*[a-zA-Z%؀-ۿ.]+/g, // single value + unit
    /\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?/g, // bare ratio, no unit
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const candidate = m[0];
      // The single-value+unit pattern needs its unit validated so it
      // doesn't swallow an unrelated trailing word; the other three
      // patterns are structurally strength-shaped enough on their own.
      if (re === patterns[2]) {
        const unitMatch = candidate.match(/[a-zA-Z%؀-ۿ.]+$/);
        if (!unitMatch || !units.resolveUnit(unitMatch[0])) continue;
      }
      return { match: candidate, start: m.index, end: m.index + candidate.length };
    }
  }

  // Trailing bare number with nothing else after it ("كونكور 5") —
  // only when it's the last token, to avoid grabbing a stray digit from
  // the middle of a drug name.
  const trailing = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*$/);
  const trailingValue = trailing?.[1];
  if (trailingValue) {
    const start = text.lastIndexOf(trailingValue);
    return { match: trailingValue, start, end: start + trailingValue.length };
  }
  return null;
}

function findDosageFormSpan(
  text: string,
  parser: DosageFormParser,
): { match: string; start: number; end: number; code: string } | null {
  const words = text.split(/\s+/);
  // Try longest contiguous word-windows first so "eye drops" wins over
  // a bare "drops" inside it. A 2-word window only counts on an EXACT
  // alias match (e.g. "eye drops") — DosageFormParser's substring
  // fallback must not be used here, or an unrelated neighboring word
  // (a unit like "gm" next to "injection") gets swallowed into the
  // span along with the real dosage-form word.
  for (let windowSize = 2; windowSize >= 1; windowSize--) {
    for (let i = 0; i <= words.length - windowSize; i++) {
      const phrase = words.slice(i, i + windowSize).join(' ');
      const parsed = parser.parse(phrase);
      const accepted = windowSize >= 2 ? parsed.confidence === 1 : parsed.code !== null;
      if (accepted && parsed.code) {
        const start = text.indexOf(phrase);
        if (start === -1) continue;
        return { match: phrase, start, end: start + phrase.length, code: parsed.code };
      }
    }
  }
  return null;
}

export class MedicationPhraseExtractor {
  constructor(
    private readonly dosageForms = new DosageFormParser(),
    private readonly units = new UnitNormalizer(),
  ) {}

  extract(text: string): ExtractedMedicationPhrase {
    let work = text.trim();
    if (!work) {
      return {
        probableDrugName: null,
        probableScientificName: null,
        probableStrength: null,
        probableDosageForm: null,
        probableManufacturer: null,
        probablePackage: null,
        residualInstructionText: null,
        confidence: 0,
      };
    }

    let probableStrength: string | null = null;
    let probableDosageForm: string | null = null;

    const dosageSpan = findDosageFormSpan(work, this.dosageForms);
    if (dosageSpan) {
      probableDosageForm = dosageSpan.code;
      work = removeSpan(work, dosageSpan.start, dosageSpan.end);
    }

    const strengthSpan = findStrengthSpan(work, this.units);
    if (strengthSpan) {
      probableStrength = strengthSpan.match.trim();
      work = removeSpan(work, strengthSpan.start, strengthSpan.end);
    }

    let residualInstructionText: string | null = null;
    const lowerWork = work.toLowerCase();
    for (const keyword of INSTRUCTION_KEYWORDS) {
      const idx = lowerWork.indexOf(keyword);
      if (idx !== -1) {
        residualInstructionText = work.slice(idx).trim();
        work = work.slice(0, idx).trim();
        break;
      }
    }

    const probableDrugName = work.replace(/\s+/g, ' ').trim() || null;
    const probableScientificName =
      probableDrugName && /[/+]/.test(probableDrugName) ? probableDrugName : null;

    // With no strength/dosage-form evidence, only a short, name-shaped
    // residual (drug names are typically 1-3 words — "Panadol Extra")
    // earns the 0.6 weak-confidence band; a longer, sentence-shaped
    // residual is far more likely to be prose than a drug name and
    // must not be mistaken for one.
    const wordCount = probableDrugName ? probableDrugName.split(/\s+/).filter(Boolean).length : 0;
    const evidenceCount = [probableStrength, probableDosageForm].filter(Boolean).length;
    const confidence = !probableDrugName
      ? 0
      : evidenceCount > 0
        ? 1
        : probableDrugName.length >= 3 && wordCount <= 3
          ? 0.6
          : 0.3;

    return {
      probableDrugName,
      probableScientificName,
      probableStrength,
      probableDosageForm,
      probableManufacturer: null,
      probablePackage: null,
      residualInstructionText,
      confidence,
    };
  }
}

function removeSpan(text: string, start: number, end: number): string {
  return (text.slice(0, start) + ' ' + text.slice(end)).replace(/\s+/g, ' ').trim();
}
