import { UnitNormalizer } from './unit-normalizer';

/**
 * CR-001 Phase 5 — pure strength parser (design summary §9/§10). Never
 * fabricates a value it can't confidently parse; the original text is
 * always preserved on `rawStrengthText` regardless of parse outcome.
 */

export interface ParsedStrengthComponent {
  value: number;
  unit: string;
}

export type StrengthMatchClass =
  | 'EXACT'
  | 'EQUIVALENT_UNIT'
  | 'COMBINATION_EXACT'
  | 'PARTIAL'
  | 'MISSING_FROM_OCR'
  | 'MISSING_FROM_DIC'
  | 'CONFLICT'
  | 'UNPARSEABLE';

export interface ParsedStrength {
  rawStrengthText: string;
  /** Multiple same-unit components, in original sequence — a "+"
   *  combination ("5 mg + 10 mg") or a shared-unit ratio written as a
   *  sequence ("875/125 mg", "50/1000 mg"). Never reordered — sequence
   *  is the only signal available to map component -> ingredient
   *  without further evidence (design summary §10). */
  components: ParsedStrengthComponent[];
  /** Set only for a true per-volume/per-unit concentration where the
   *  numerator and denominator carry *different* units ("250 mg / 5
   *  ml", "100 mg/ml") — never for a same-unit combination sequence. */
  numerator: number | null;
  numeratorUnit: string | null;
  denominator: number | null;
  denominatorUnit: string | null;
  ratio: number | null;
  normalizedStrengthText: string | null;
  parseConfidence: number;
}

const ARABIC_INDIC_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

const UNIT_CHARS = 'a-zA-Z%؀-ۿ\\.';

function preClean(raw: string): string {
  let s = raw.trim();
  s = s.replace(/[٠-٩]/g, (d) => ARABIC_INDIC_DIGITS[d] ?? d);
  // Thousand-separator commas between digits ("10,000") -> plain digits;
  // a comma used as a decimal separator ("0,1") is handled separately
  // below, before this collapses it.
  s = s.replace(/(\d),(?=\d{3}(\D|$))/g, '$1');
  // A remaining comma between digits is a decimal separator (Arabic/
  // European convention) -> normalize to a point.
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}

export class StrengthParser {
  constructor(private readonly units = new UnitNormalizer()) {}

  parse(raw: string): ParsedStrength {
    const cleaned = preClean(raw);
    const empty: ParsedStrength = {
      rawStrengthText: raw,
      components: [],
      numerator: null,
      numeratorUnit: null,
      denominator: null,
      denominatorUnit: null,
      ratio: null,
      normalizedStrengthText: null,
      parseConfidence: 0,
    };
    if (!cleaned) return empty;

    // 1. Explicit "+" combination, e.g. "5 mg + 10 mg".
    if (cleaned.includes('+')) {
      const parts = cleaned.split('+').map((p) => p.trim());
      const components = parts
        .map((p) => this.parseSingle(p))
        .filter((c): c is ParsedStrengthComponent => c !== null);
      if (components.length === parts.length && components.length >= 2) {
        return {
          ...empty,
          components,
          normalizedStrengthText: components.map((c) => `${c.value} ${c.unit}`).join(' + '),
          parseConfidence: 0.9,
        };
      }
      return { ...empty, parseConfidence: components.length ? 0.3 : 0 };
    }

    // 2. True concentration: "250 mg / 5 ml", "100 mg/ml" (a unit
    // immediately follows EACH side of the slash — the syntactic
    // marker that distinguishes this from a same-unit ratio-sequence).
    const concentration = cleaned.match(
      new RegExp(`^([\\d.]+)\\s*([${UNIT_CHARS}]+?)\\s*/\\s*([\\d.]*)\\s*([${UNIT_CHARS}]+)$`),
    );
    if (concentration) {
      const [, numVal, numUnit, denVal, denUnit] = concentration;
      const numDef = numUnit ? this.units.resolveUnit(numUnit) : null;
      const denDef = denUnit ? this.units.resolveUnit(denUnit) : null;
      // Different unit categories confirm this is a concentration, not
      // a same-unit sequence that happened to omit the first unit.
      if (numDef && denDef && numDef.category !== denDef.category) {
        const n = Number(numVal);
        const d = denVal ? Number(denVal) : 1;
        return {
          ...empty,
          numerator: n,
          numeratorUnit: numDef.canonical,
          denominator: d,
          denominatorUnit: denDef.canonical,
          ratio: d !== 0 ? n / d : null,
          normalizedStrengthText: `${n} ${numDef.canonical} / ${d} ${denDef.canonical}`,
          parseConfidence: 0.95,
        };
      }
    }

    // 3. Same-unit ratio written as a sequence: "875/125 mg",
    // "50/1000 mg" — one unit, shared, at the end. Never treated as a
    // fraction; each side is its own ingredient-strength component in
    // original order (design summary §10).
    const sequence = cleaned.match(
      new RegExp(`^([\\d.]+)\\s*/\\s*([\\d.]+)\\s*([${UNIT_CHARS}]+)$`),
    );
    if (sequence) {
      const [, a, b, unit] = sequence;
      const def = unit ? this.units.resolveUnit(unit) : null;
      if (def && a && b) {
        const components = [
          { value: Number(a), unit: def.canonical },
          { value: Number(b), unit: def.canonical },
        ];
        return {
          ...empty,
          components,
          normalizedStrengthText: `${a}/${b} ${def.canonical}`,
          parseConfidence: 0.9,
        };
      }
    }

    // 4. Single value + unit — the common case ("500 mg", "1 g",
    // "10,000 IU", "0.1%", "20 mmol").
    const single = this.parseSingle(cleaned);
    if (single) {
      return {
        ...empty,
        components: [single],
        normalizedStrengthText: `${single.value} ${single.unit}`,
        parseConfidence: 1,
      };
    }

    return empty;
  }

  private parseSingle(text: string): ParsedStrengthComponent | null {
    const m = text.trim().match(new RegExp(`^([\\d.]+)\\s*([${UNIT_CHARS}]+)$`));
    if (!m) return null;
    const [, valueText, unitText] = m;
    if (!unitText) return null;
    const def = this.units.resolveUnit(unitText);
    if (!def) return null;
    const value = Number(valueText);
    if (!Number.isFinite(value)) return null;
    return { value, unit: def.canonical };
  }

  /** Classifies how a parsed OCR strength relates to a DIC candidate's
   *  parsed strength (design summary §10's EXACT/EQUIVALENT_UNIT/
   *  COMBINATION_EXACT/PARTIAL/CONFLICT/... bands). */
  classify(extracted: ParsedStrength, candidate: ParsedStrength): StrengthMatchClass {
    const extractedEmpty = extracted.parseConfidence === 0;
    const candidateEmpty = candidate.parseConfidence === 0;
    if (extractedEmpty && candidateEmpty) return 'UNPARSEABLE';
    if (extractedEmpty) return 'MISSING_FROM_OCR';
    if (candidateEmpty) return 'MISSING_FROM_DIC';

    // Concentration vs. concentration.
    if (extracted.numerator !== null && candidate.numerator !== null) {
      const numMatch = this.units.areEquivalent(
        { value: extracted.numerator, unit: extracted.numeratorUnit! },
        { value: candidate.numerator, unit: candidate.numeratorUnit! },
      );
      const denMatch = this.units.areEquivalent(
        { value: extracted.denominator!, unit: extracted.denominatorUnit! },
        { value: candidate.denominator!, unit: candidate.denominatorUnit! },
      );
      if (numMatch && denMatch) return 'EXACT';
      return 'CONFLICT';
    }
    // One side is a concentration, the other is a plain dose — never
    // equal ("250 mg/5 ml must not equal 250 mg tablet").
    if ((extracted.numerator !== null) !== (candidate.numerator !== null)) {
      return 'CONFLICT';
    }

    // Combination / sequence comparison (2+ components on both sides).
    if (extracted.components.length >= 2 || candidate.components.length >= 2) {
      if (extracted.components.length !== candidate.components.length) return 'CONFLICT';
      let allExact = true;
      let anyMatch = false;
      for (let i = 0; i < extracted.components.length; i++) {
        const extractedComponent = extracted.components[i];
        const candidateComponent = candidate.components[i];
        const eq =
          !!extractedComponent && !!candidateComponent
            ? this.units.areEquivalent(extractedComponent, candidateComponent)
            : false;
        if (eq) anyMatch = true;
        else allExact = false;
      }
      if (allExact) return 'COMBINATION_EXACT';
      return anyMatch ? 'PARTIAL' : 'CONFLICT';
    }

    // Single-component comparison.
    const e = extracted.components[0];
    const c = candidate.components[0];
    if (!e || !c) return 'UNPARSEABLE';
    if (e.unit === c.unit && e.value === c.value) return 'EXACT';
    if (this.units.areEquivalent(e, c)) return 'EQUIVALENT_UNIT';
    return 'CONFLICT';
  }
}
