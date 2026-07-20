import { StrengthParser } from './strength-parser';

describe('StrengthParser', () => {
  const parser = new StrengthParser();

  describe('parse — single value', () => {
    it('parses "500 mg"', () => {
      const result = parser.parse('500 mg');
      expect(result.components).toEqual([{ value: 500, unit: 'mg' }]);
      expect(result.parseConfidence).toBe(1);
    });

    it('parses "1 g" and normalizes it to the same base unit as "1000 mg"', () => {
      const g = parser.parse('1 g');
      const mg = parser.parse('1000 mg');
      expect(g.components[0]).toEqual({ value: 1, unit: 'g' });
      expect(parser.classify(g, mg)).toBe('EQUIVALENT_UNIT');
    });

    it('parses percent ("0.1%")', () => {
      const result = parser.parse('0.1%');
      expect(result.components).toEqual([{ value: 0.1, unit: '%' }]);
    });

    it('parses IU ("10,000 IU") stripping the thousand separator', () => {
      const result = parser.parse('10,000 IU');
      expect(result.components).toEqual([{ value: 10000, unit: 'IU' }]);
    });

    it('parses mmol ("20 mmol")', () => {
      const result = parser.parse('20 mmol');
      expect(result.components).toEqual([{ value: 20, unit: 'mmol' }]);
    });

    it('parses Arabic-Indic numerals ("٥٠٠ مجم")', () => {
      const result = parser.parse('٥٠٠ مجم');
      expect(result.components).toEqual([{ value: 500, unit: 'mg' }]);
    });

    it('parses a decimal comma ("0,1%") as a decimal point', () => {
      const result = parser.parse('0,1%');
      expect(result.components).toEqual([{ value: 0.1, unit: '%' }]);
    });

    it('returns zero confidence for unparseable text', () => {
      expect(parser.parse('').parseConfidence).toBe(0);
      expect(parser.parse('extra strength').parseConfidence).toBe(0);
    });
  });

  describe('parse — true concentration', () => {
    it('parses "250 mg / 5 ml" as numerator/denominator with different units', () => {
      const result = parser.parse('250 mg / 5 ml');
      expect(result.numerator).toBe(250);
      expect(result.numeratorUnit).toBe('mg');
      expect(result.denominator).toBe(5);
      expect(result.denominatorUnit).toBe('ml');
      expect(result.components).toEqual([]);
    });

    it('parses "100 mg/ml" (implicit denominator of 1)', () => {
      const result = parser.parse('100 mg/ml');
      expect(result.numerator).toBe(100);
      expect(result.denominator).toBe(1);
      expect(result.denominatorUnit).toBe('ml');
    });
  });

  describe('parse — same-unit ratio sequence', () => {
    it('parses "875/125 mg" as two same-unit components, preserving sequence', () => {
      const result = parser.parse('875/125 mg');
      expect(result.components).toEqual([
        { value: 875, unit: 'mg' },
        { value: 125, unit: 'mg' },
      ]);
      expect(result.numerator).toBeNull();
    });

    it('parses "50/1000 mg" preserving sequence (never reordered)', () => {
      const result = parser.parse('50/1000 mg');
      expect(result.components).toEqual([
        { value: 50, unit: 'mg' },
        { value: 1000, unit: 'mg' },
      ]);
    });
  });

  describe('parse — "+" combination', () => {
    it('parses "5 mg + 10 mg"', () => {
      const result = parser.parse('5 mg + 10 mg');
      expect(result.components).toEqual([
        { value: 5, unit: 'mg' },
        { value: 10, unit: 'mg' },
      ]);
      expect(result.parseConfidence).toBeGreaterThan(0.5);
    });
  });

  describe('classify', () => {
    it('EXACT for identical single values', () => {
      const a = parser.parse('500 mg');
      const b = parser.parse('500 mg');
      expect(parser.classify(a, b)).toBe('EXACT');
    });

    it('EQUIVALENT_UNIT for 1 g vs 1000 mg', () => {
      const a = parser.parse('1 g');
      const b = parser.parse('1000 mg');
      expect(parser.classify(a, b)).toBe('EQUIVALENT_UNIT');
    });

    it('CONFLICT for a concentration vs a plain dose — "250 mg/5 ml" must not equal "250 mg" tablet', () => {
      const concentration = parser.parse('250 mg / 5 ml');
      const plainDose = parser.parse('250 mg');
      expect(parser.classify(concentration, plainDose)).toBe('CONFLICT');
    });

    it('COMBINATION_EXACT for identical same-unit sequences preserving order ("875/125")', () => {
      const a = parser.parse('875/125 mg');
      const b = parser.parse('875/125 mg');
      expect(parser.classify(a, b)).toBe('COMBINATION_EXACT');
    });

    it('CONFLICT for a reversed sequence ("125/875" vs "875/125") — order matters', () => {
      const a = parser.parse('125/875 mg');
      const b = parser.parse('875/125 mg');
      expect(parser.classify(a, b)).toBe('CONFLICT');
    });

    it('CONFLICT for "50/1000" vs "1000/50" without ingredient evidence to reorder them', () => {
      const a = parser.parse('50/1000 mg');
      const b = parser.parse('1000/50 mg');
      expect(parser.classify(a, b)).toBe('CONFLICT');
    });

    it('MISSING_FROM_OCR when the OCR side did not parse', () => {
      const empty = parser.parse('');
      const dose = parser.parse('500 mg');
      expect(parser.classify(empty, dose)).toBe('MISSING_FROM_OCR');
    });

    it('MISSING_FROM_DIC when the candidate side did not parse', () => {
      const dose = parser.parse('500 mg');
      const empty = parser.parse('');
      expect(parser.classify(dose, empty)).toBe('MISSING_FROM_DIC');
    });

    it('UNPARSEABLE when neither side parsed', () => {
      expect(parser.classify(parser.parse(''), parser.parse(''))).toBe('UNPARSEABLE');
    });

    it('CONFLICT for different values in the same unit', () => {
      const a = parser.parse('250 mg');
      const b = parser.parse('500 mg');
      expect(parser.classify(a, b)).toBe('CONFLICT');
    });
  });
});
