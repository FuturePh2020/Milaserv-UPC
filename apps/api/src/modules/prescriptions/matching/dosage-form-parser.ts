/**
 * CR-001 Phase 5 — pure dosage-form recognizer. Canonical codes match
 * the exact DosageForm.code values seeded in Phase 4
 * (prisma/seed/dic-reference.ts) so a parsed OCR dosage form and a
 * DIC DosageForm row are directly comparable without another lookup
 * table (design summary §11).
 */

export type DosageFormMatchClass = 'EXACT' | 'SYNONYM' | 'COMPATIBLE' | 'MISSING' | 'CONFLICT';

/** Forms that are clinically interchangeable enough to be a soft
 *  ("COMPATIBLE") rather than hard conflict when they differ — e.g. an
 *  OCR read of "drops" vs. a DIC record for "suspension" for the same
 *  oral product is plausible OCR noise, not a real conflict. Kept
 *  intentionally small and conservative — most pairs are NOT listed
 *  here and default to CONFLICT (design summary §11: "an injection
 *  candidate must not receive a high-confidence match when the OCR
 *  clearly says tablet"). */
const COMPATIBLE_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['TABLET', 'CAPSULE']),
  new Set(['SYRUP', 'SUSPENSION', 'SOLUTION']),
  new Set(['CREAM', 'OINTMENT', 'GEL']),
  new Set(['INJECTION']), // never compatible with anything else — deliberately singleton
];

/** Every accepted spelling/abbreviation (English/Arabic) -> canonical
 *  DosageForm.code. Lookup keys are lowercased before matching; Arabic
 *  keys are compared as-is (normalizeArabic() should be applied by the
 *  caller before lookup for diacritic/tatweel-insensitive matching). */
const DOSAGE_FORM_ALIASES: Record<string, string> = {
  tablet: 'TABLET',
  tablets: 'TABLET',
  tab: 'TABLET',
  tabs: 'TABLET',
  قرص: 'TABLET',
  أقراص: 'TABLET',
  اقراص: 'TABLET',
  capsule: 'CAPSULE',
  capsules: 'CAPSULE',
  cap: 'CAPSULE',
  caps: 'CAPSULE',
  كبسولة: 'CAPSULE',
  كبسولات: 'CAPSULE',
  syrup: 'SYRUP',
  شراب: 'SYRUP',
  suspension: 'SUSPENSION',
  susp: 'SUSPENSION',
  معلق: 'SUSPENSION',
  solution: 'SOLUTION',
  sol: 'SOLUTION',
  محلول: 'SOLUTION',
  injection: 'INJECTION',
  inj: 'INJECTION',
  ampoule: 'INJECTION',
  amp: 'INJECTION',
  vial: 'INJECTION',
  حقنة: 'INJECTION',
  أمبولة: 'INJECTION',
  امبولة: 'INJECTION',
  cream: 'CREAM',
  كريم: 'CREAM',
  ointment: 'OINTMENT',
  مرهم: 'OINTMENT',
  drops: 'DROPS',
  drop: 'DROPS',
  'eye drops': 'DROPS',
  'ear drops': 'DROPS',
  قطرات: 'DROPS',
  inhaler: 'INHALER',
  بخاخ: 'INHALER',
  'بخاخ استنشاق': 'INHALER',
  sachet: 'SACHET',
  sachets: 'SACHET',
  كيس: 'SACHET',
  gel: 'GEL',
  جل: 'GEL',
  suppository: 'SUPPOSITORY',
  suppositories: 'SUPPOSITORY',
  تحميلة: 'SUPPOSITORY',
};

export interface ParsedDosageForm {
  rawText: string;
  code: string | null;
  confidence: number;
}

export class DosageFormParser {
  /** Best-effort dosage-form extraction from a residual text fragment
   *  (design summary §11) — tries the longest known phrase first so
   *  multi-word forms ("eye drops") don't lose to a shorter substring
   *  ("drops"). Returns code:null (never a guess) when nothing matches. */
  parse(text: string): ParsedDosageForm {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return { rawText: text, code: null, confidence: 0 };

    const phrases = Object.keys(DOSAGE_FORM_ALIASES).sort((a, b) => b.length - a.length);
    for (const phrase of phrases) {
      if (normalized === phrase) {
        return { rawText: text, code: DOSAGE_FORM_ALIASES[phrase] ?? null, confidence: 1 };
      }
    }
    for (const phrase of phrases) {
      const re = new RegExp(`(^|[^a-z؀-ۿ])${escapeRegExp(phrase)}([^a-z؀-ۿ]|$)`, 'i');
      if (re.test(normalized)) {
        return { rawText: text, code: DOSAGE_FORM_ALIASES[phrase] ?? null, confidence: 0.85 };
      }
    }
    return { rawText: text, code: null, confidence: 0 };
  }

  /** Classifies how an extracted dosage form relates to a DIC
   *  candidate's dosage-form code (design summary §11's EXACT/SYNONYM/
   *  COMPATIBLE/MISSING/CONFLICT bands). SYNONYM never arises here since
   *  every alias already collapses to one canonical code at parse time
   *  — kept as a distinct band for callers that resolve synonyms via
   *  DosageForm.synonymsJson before calling this. */
  classify(extractedCode: string | null, candidateCode: string | null): DosageFormMatchClass {
    if (!extractedCode) return 'MISSING';
    if (!candidateCode) return 'MISSING';
    if (extractedCode === candidateCode) return 'EXACT';
    const compatible = COMPATIBLE_GROUPS.some(
      (group) => group.has(extractedCode) && group.has(candidateCode),
    );
    return compatible ? 'COMPATIBLE' : 'CONFLICT';
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
