import { UnitNormalizer } from './unit-normalizer';

describe('UnitNormalizer', () => {
  const units = new UnitNormalizer();

  describe('resolveUnit', () => {
    it('resolves common English mass/volume spellings', () => {
      expect(units.resolveUnit('mg')?.canonical).toBe('mg');
      expect(units.resolveUnit('gm')?.canonical).toBe('g');
      expect(units.resolveUnit('ml')?.canonical).toBe('ml');
      expect(units.resolveUnit('IU')?.canonical).toBe('IU');
      expect(units.resolveUnit('%')?.canonical).toBe('%');
    });

    it('resolves Arabic spellings to the same canonical unit', () => {
      expect(units.resolveUnit('ملغ')?.canonical).toBe('mg');
      expect(units.resolveUnit('جم')?.canonical).toBe('g');
      expect(units.resolveUnit('مل')?.canonical).toBe('ml');
    });

    it('is case-insensitive', () => {
      expect(units.resolveUnit('MG')?.canonical).toBe('mg');
      expect(units.resolveUnit('Iu')?.canonical).toBe('IU');
    });

    it('returns null for an unrecognized unit rather than guessing', () => {
      expect(units.resolveUnit('xyz')).toBeNull();
      expect(units.resolveUnit('')).toBeNull();
    });
  });

  describe('toBaseValue', () => {
    it('converts 1 g to 1000 mg', () => {
      expect(units.toBaseValue(1, 'g')).toEqual({
        value: 1,
        unit: 'g',
        base: 'mg',
        category: 'MASS',
        baseValue: 1000,
      });
    });

    it('returns null for an unrecognized unit', () => {
      expect(units.toBaseValue(5, 'bananas')).toBeNull();
    });
  });

  describe('areEquivalent', () => {
    it('treats 1 g and 1000 mg as equivalent', () => {
      expect(units.areEquivalent({ value: 1, unit: 'g' }, { value: 1000, unit: 'mg' })).toBe(true);
    });

    it('treats 0.5 g and 500 mg as equivalent', () => {
      expect(units.areEquivalent({ value: 0.5, unit: 'g' }, { value: 500, unit: 'mg' })).toBe(true);
    });

    it('does not treat different values as equivalent', () => {
      expect(units.areEquivalent({ value: 1, unit: 'g' }, { value: 500, unit: 'mg' })).toBe(false);
    });

    it('does not treat different categories (mass vs volume) as equivalent', () => {
      expect(units.areEquivalent({ value: 5, unit: 'mg' }, { value: 5, unit: 'ml' })).toBe(false);
    });

    it('is false when either unit is unrecognized', () => {
      expect(units.areEquivalent({ value: 5, unit: 'mg' }, { value: 5, unit: 'xyz' })).toBe(false);
    });
  });
});
