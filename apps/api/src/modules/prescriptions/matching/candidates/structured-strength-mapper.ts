import type { StrengthParser } from '../strength-parser';
import type { ParsedStrength } from '../strength-parser';
import type { CandidateStructuredStrength } from './types';

function emptyParsedStrength(rawStrengthText: string): ParsedStrength {
  return {
    rawStrengthText,
    components: [],
    numerator: null,
    numeratorUnit: null,
    denominator: null,
    denominatorUnit: null,
    ratio: null,
    normalizedStrengthText: null,
    parseConfidence: 0,
  };
}

/**
 * CR-001 Phase 5 — converts a candidate's already-structured
 * DrugStrengthComponent rows into the same ParsedStrength shape
 * StrengthParser produces from raw OCR text, so StrengthParser.classify()
 * can compare the two sides uniformly. Never re-parses free text when
 * structured data already exists — falls back to StrengthParser only
 * for the legacy rows Phase 4 hasn't structured yet.
 */
export function candidateStrengthFromStructured(
  structured: CandidateStructuredStrength[],
  fallbackText: string | null,
  parser: StrengthParser,
): ParsedStrength {
  if (structured.length === 0) {
    return fallbackText ? parser.parse(fallbackText) : emptyParsedStrength(fallbackText ?? '');
  }

  // A single component with a denominator is a true concentration
  // ("250 mg / 5 ml") — never a same-unit sequence.
  if (structured.length === 1 && structured[0]!.denominatorValue !== null) {
    const s = structured[0]!;
    const ratio =
      s.denominatorValue !== null && s.denominatorValue !== 0 && s.numeratorValue !== null
        ? s.numeratorValue / s.denominatorValue
        : null;
    return {
      rawStrengthText: fallbackText ?? '',
      components: [],
      numerator: s.numeratorValue,
      numeratorUnit: s.numeratorUnitCode,
      denominator: s.denominatorValue,
      denominatorUnit: s.denominatorUnitCode,
      ratio,
      normalizedStrengthText: `${s.numeratorValue} ${s.numeratorUnitCode} / ${s.denominatorValue} ${s.denominatorUnitCode}`,
      parseConfidence: 1,
    };
  }

  // One or more numerator-only components, in sequence — a single dose
  // ("500 mg") or a same-unit combination ("875 mg + 125 mg").
  const components = structured
    .filter((s) => s.numeratorValue !== null && s.numeratorUnitCode !== null)
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => ({ value: s.numeratorValue!, unit: s.numeratorUnitCode! }));
  if (components.length === 0) {
    return fallbackText ? parser.parse(fallbackText) : emptyParsedStrength(fallbackText ?? '');
  }
  return {
    rawStrengthText: fallbackText ?? '',
    components,
    numerator: null,
    numeratorUnit: null,
    denominator: null,
    denominatorUnit: null,
    ratio: null,
    normalizedStrengthText: components.map((c) => `${c.value} ${c.unit}`).join(' + '),
    parseConfidence: 1,
  };
}
