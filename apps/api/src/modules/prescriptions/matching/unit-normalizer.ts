/**
 * CR-001 Phase 5 — pure unit-conversion table, mirroring the exact
 * categories/normalizationFactor/baseUnitCode values seeded onto DIC's
 * MeasurementUnit catalog (prisma/seed/dic-reference.ts) so a strength
 * comparison against a real DrugStrengthComponent row and a comparison
 * between two parsed OCR strengths always agree. No DB access here —
 * this is the pure-function layer (design summary §4/§9).
 */

export type UnitCategory = 'MASS' | 'VOLUME' | 'ACTIVITY' | 'PERCENTAGE' | 'MOLAR' | 'UNKNOWN';

export interface UnitDef {
  /** Canonical rendering, e.g. "mg", "IU". */
  canonical: string;
  category: UnitCategory;
  /** Multiply a value in this unit by this factor to reach `base`. */
  toBaseFactor: number;
  base: string;
}

/** Every accepted spelling (English/Arabic/OCR-variant) → canonical unit
 *  code. Lookup keys are lowercased before matching. */
const UNIT_ALIASES: Record<string, string> = {
  mg: 'mg',
  milligram: 'mg',
  milligrams: 'mg',
  ملغ: 'mg',
  مجم: 'mg',
  ملغم: 'mg',
  g: 'g',
  gm: 'g',
  gram: 'g',
  grams: 'g',
  غرام: 'g',
  جم: 'g',
  mcg: 'mcg',
  ug: 'mcg',
  microgram: 'mcg',
  micrograms: 'mcg',
  ميكروغرام: 'mcg',
  مكغ: 'mcg',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  مل: 'ml',
  l: 'l',
  liter: 'l',
  litre: 'l',
  لتر: 'l',
  iu: 'IU',
  'i.u': 'IU',
  'وحدة دولية': 'IU',
  وحدة: 'IU',
  '%': '%',
  percent: '%',
  mmol: 'mmol',
  millimole: 'mmol',
  'ملي مول': 'mmol',
};

const UNIT_TABLE: Record<string, UnitDef> = {
  mg: { canonical: 'mg', category: 'MASS', toBaseFactor: 1, base: 'mg' },
  g: { canonical: 'g', category: 'MASS', toBaseFactor: 1000, base: 'mg' },
  mcg: { canonical: 'mcg', category: 'MASS', toBaseFactor: 0.001, base: 'mg' },
  ml: { canonical: 'ml', category: 'VOLUME', toBaseFactor: 1, base: 'ml' },
  l: { canonical: 'l', category: 'VOLUME', toBaseFactor: 1000, base: 'ml' },
  IU: { canonical: 'IU', category: 'ACTIVITY', toBaseFactor: 1, base: 'IU' },
  '%': { canonical: '%', category: 'PERCENTAGE', toBaseFactor: 1, base: '%' },
  mmol: { canonical: 'mmol', category: 'MOLAR', toBaseFactor: 1, base: 'mmol' },
};

export interface NormalizedValue {
  value: number;
  unit: string;
  base: string;
  category: UnitCategory;
  baseValue: number;
}

export class UnitNormalizer {
  /** Resolves a raw unit spelling to its canonical definition, or null
   *  for an unrecognized unit (never guessed — an unmapped unit is
   *  UNPARSEABLE evidence upstream, not silently dropped). */
  resolveUnit(rawUnit: string): UnitDef | null {
    const key = UNIT_ALIASES[rawUnit.trim().toLowerCase()];
    if (!key) return null;
    return UNIT_TABLE[key] ?? null;
  }

  /** Converts a value+unit to its base-unit equivalent within the same
   *  category (1 g -> 1000 mg). Returns null for an unrecognized unit. */
  toBaseValue(value: number, rawUnit: string): NormalizedValue | null {
    const def = this.resolveUnit(rawUnit);
    if (!def) return null;
    return {
      value,
      unit: def.canonical,
      base: def.base,
      category: def.category,
      baseValue: value * def.toBaseFactor,
    };
  }

  /** Two values are equivalent if they resolve to the same base unit and
   *  base value within a small floating-point tolerance (1 g == 1000 mg;
   *  0.5 g == 500 mg). Different categories (mass vs. volume) or
   *  unrecognized units are never equivalent. */
  areEquivalent(a: { value: number; unit: string }, b: { value: number; unit: string }): boolean {
    const na = this.toBaseValue(a.value, a.unit);
    const nb = this.toBaseValue(b.value, b.unit);
    if (!na || !nb) return false;
    if (na.base !== nb.base) return false;
    return Math.abs(na.baseValue - nb.baseValue) < 1e-6;
  }
}
