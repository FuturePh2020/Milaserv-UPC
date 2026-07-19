/**
 * Structured strength parsing (Phase 4 design doc §7) — best-effort
 * extraction of numerator[/denominator] components from free-text
 * strength like "500 mg", "250 mg / 5 ml", "0.1%", "10,000 IU". The
 * original text is always the caller's to preserve verbatim
 * (DrugStrengthComponent.originalStrengthText) — this module never
 * claims to be authoritative, only a starting point a human confirms.
 *
 * Combination strengths ("875 mg + 125 mg") produce multiple components,
 * one per `+`-separated segment, matching one row per ingredient in
 * DrugIngredient/DrugStrengthComponent.
 */

export interface ParsedStrengthComponent {
  numeratorValue: number | null;
  numeratorUnitCode: string | null;
  denominatorValue: number | null;
  denominatorUnitCode: string | null;
  originalStrengthText: string;
}

// e.g. "500", "0.1", "10,000" — comma thousands separators tolerated.
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
// e.g. "mg", "mg/ml", "IU", "%" — a unit token is letters/percent, never
// digits (keeps it from swallowing the next number in "500mg 5ml").
const UNIT = String.raw`[A-Za-z%]+(?:/[A-Za-z]+)?`;

const SINGLE_STRENGTH = new RegExp(`^(${NUMBER})\\s*(${UNIT})?$`);
const RATIO_STRENGTH = new RegExp(`^(${NUMBER})\\s*(${UNIT})\\s*/\\s*(${NUMBER})\\s*(${UNIT})$`);

function toNumber(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseSegment(segment: string): ParsedStrengthComponent {
  const trimmed = segment.trim();
  const ratio = RATIO_STRENGTH.exec(trimmed);
  if (ratio) {
    return {
      numeratorValue: toNumber(ratio[1]!),
      numeratorUnitCode: ratio[2]!.toLowerCase(),
      denominatorValue: toNumber(ratio[3]!),
      denominatorUnitCode: ratio[4]!.toLowerCase(),
      originalStrengthText: segment,
    };
  }
  const single = SINGLE_STRENGTH.exec(trimmed);
  if (single) {
    return {
      numeratorValue: toNumber(single[1]!),
      numeratorUnitCode: single[2] ? single[2].toLowerCase() : null,
      denominatorValue: null,
      denominatorUnitCode: null,
      originalStrengthText: segment,
    };
  }
  // Unparseable — the original text is still preserved, numerics stay
  // null rather than guessing (design doc §7: never depend on a single
  // free-text field, but never fabricate structure that isn't there).
  return {
    numeratorValue: null,
    numeratorUnitCode: null,
    denominatorValue: null,
    denominatorUnitCode: null,
    originalStrengthText: segment,
  };
}

/** Splits a combination strength like "875 mg + 125 mg" into one
 *  component per `+`-separated segment; a single-ingredient strength
 *  like "500 mg" or "250 mg / 5 ml" returns exactly one component. */
export function parseStrengthText(text: string): ParsedStrengthComponent[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split('+').map((segment) => parseSegment(segment));
}
