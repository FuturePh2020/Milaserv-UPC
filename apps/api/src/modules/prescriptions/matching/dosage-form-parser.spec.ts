import { DosageFormParser } from './dosage-form-parser';

describe('DosageFormParser', () => {
  const parser = new DosageFormParser();

  describe('parse', () => {
    it('recognizes an exact English form', () => {
      expect(parser.parse('tablet')).toEqual({ rawText: 'tablet', code: 'TABLET', confidence: 1 });
    });

    it('recognizes an abbreviation', () => {
      expect(parser.parse('tabs').code).toBe('TABLET');
      expect(parser.parse('inj').code).toBe('INJECTION');
    });

    it('recognizes Arabic forms', () => {
      expect(parser.parse('قرص').code).toBe('TABLET');
      expect(parser.parse('حقنة').code).toBe('INJECTION');
    });

    it('prefers the longer phrase ("eye drops" over bare "drops")', () => {
      const result = parser.parse('eye drops');
      expect(result.code).toBe('DROPS');
    });

    it('finds a dosage form embedded within a larger phrase', () => {
      const result = parser.parse('ventolin inhaler');
      expect(result.code).toBe('INHALER');
      expect(result.confidence).toBeLessThan(1);
    });

    it('returns null code (never a guess) for unrecognized text', () => {
      expect(parser.parse('augmentin').code).toBeNull();
      expect(parser.parse('').code).toBeNull();
    });
  });

  describe('classify', () => {
    it('returns EXACT for identical codes', () => {
      expect(parser.classify('TABLET', 'TABLET')).toBe('EXACT');
    });

    it('returns COMPATIBLE for tablet vs capsule', () => {
      expect(parser.classify('TABLET', 'CAPSULE')).toBe('COMPATIBLE');
    });

    it('returns COMPATIBLE for syrup vs suspension vs solution', () => {
      expect(parser.classify('SYRUP', 'SUSPENSION')).toBe('COMPATIBLE');
      expect(parser.classify('SUSPENSION', 'SOLUTION')).toBe('COMPATIBLE');
    });

    it('never treats injection as compatible with anything else', () => {
      expect(parser.classify('INJECTION', 'TABLET')).toBe('CONFLICT');
      expect(parser.classify('TABLET', 'INJECTION')).toBe('CONFLICT');
      expect(parser.classify('INJECTION', 'SYRUP')).toBe('CONFLICT');
    });

    it('returns CONFLICT for unrelated forms', () => {
      expect(parser.classify('CREAM', 'TABLET')).toBe('CONFLICT');
    });

    it('returns MISSING when either side has no code', () => {
      expect(parser.classify(null, 'TABLET')).toBe('MISSING');
      expect(parser.classify('TABLET', null)).toBe('MISSING');
      expect(parser.classify(null, null)).toBe('MISSING');
    });
  });
});
