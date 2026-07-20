import { bigramSimilarity } from './string-similarity';

describe('bigramSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(bigramSimilarity('Augmentin', 'Augmentin')).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(bigramSimilarity('AUGMENTIN', 'augmentin')).toBe(1);
  });

  it('returns a high score for near-identical strings', () => {
    const score = bigramSimilarity('Amoxicillin', 'Amoxicilin');
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThan(1);
  });

  it('returns a low score for unrelated strings', () => {
    const score = bigramSimilarity('Augmentin', 'Ventolin');
    expect(score).toBeLessThanOrEqual(0.4);
  });

  it('is symmetric', () => {
    expect(bigramSimilarity('Paracetamol', 'Paracetmol')).toBe(
      bigramSimilarity('Paracetmol', 'Paracetamol'),
    );
  });

  it('returns 0 when either string is empty', () => {
    expect(bigramSimilarity('', 'Augmentin')).toBe(0);
    expect(bigramSimilarity('Augmentin', '')).toBe(0);
  });
});
