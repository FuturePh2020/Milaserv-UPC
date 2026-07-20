import { normalizeLocationArabic, normalizeLocationEnglish, normalizeLocationText } from './location-normalizer';

describe('normalizeLocationEnglish', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeLocationEnglish('  Riyadh   City  ')).toBe('riyadh city');
  });
});

describe('normalizeLocationArabic', () => {
  it('strips diacritics and unifies alef variants', () => {
    expect(normalizeLocationArabic('أبها')).toBe(normalizeLocationArabic('ابها'));
  });
});

describe('normalizeLocationText', () => {
  it('detects English text and normalizes only the English side, copying the Arabic side verbatim (trimmed, case preserved)', () => {
    const result = normalizeLocationText('Riyadh');
    expect(result.en).toBe('riyadh');
    expect(result.ar).toBe('Riyadh');
  });

  it('detects Arabic text and normalizes both English and Arabic sides', () => {
    const result = normalizeLocationText('الرياض');
    expect(result.en).toBe('الرياض'.toLowerCase());
    expect(result.ar).toBe(normalizeLocationArabic('الرياض'));
  });

  it('trims surrounding whitespace before script detection', () => {
    const result = normalizeLocationText('  Jeddah  ');
    expect(result.en).toBe('jeddah');
  });
});
