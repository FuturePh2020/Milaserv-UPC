import { normalizeArabic } from './arabic';
import { normalizeEnglish, foldDrugNameVariants } from './english';
import { parseStrengthText } from './strength';
import { transliterateArabicToLatin, transliterateLatinToArabic } from './transliteration';
import { normalizeSearchInput } from './index';

describe('normalizeArabic', () => {
  it('folds hamza/madda alef variants to bare alef', () => {
    expect(normalizeArabic('أوجمنتين')).toBe('اوجمنتين');
    expect(normalizeArabic('إسبرين')).toBe('اسبرين');
    expect(normalizeArabic('آمين')).toBe('امين');
  });

  it('folds alef maksura to yeh', () => {
    expect(normalizeArabic('مستشفى')).toBe('مستشفي');
  });

  it('never folds teh marbuta to heh', () => {
    const result = normalizeArabic('صيدلية');
    expect(result.endsWith(String.fromCodePoint(0x629))).toBe(true); // ة preserved
    expect(result.endsWith(String.fromCodePoint(0x647))).toBe(false); // never ه
  });

  it('strips tatweel and diacritics', () => {
    const withTatweel = 'دواء' + String.fromCodePoint(0x0640) + 'ء';
    expect(normalizeArabic(withTatweel)).not.toContain(String.fromCodePoint(0x0640));
    const withDiacritic = 'دَواء'; // fatha over dal
    expect(normalizeArabic(withDiacritic)).toBe(normalizeArabic('دواء'));
  });

  it('never strips Arabic-Indic digits as if they were diacritics', () => {
    // Regression test for a real transcription bug caught during
    // development: a visually-similar regex range silently swallowed
    // U+0660-0669 instead of converting them.
    expect(normalizeArabic('٥٠٠ ملغ')).toBe('500 ملغ');
    expect(normalizeArabic('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('converts Persian digits too', () => {
    expect(normalizeArabic('۵۰۰')).toBe('500');
  });

  it('can leave digits untouched when asked', () => {
    expect(normalizeArabic('٥٠٠', { normalizeDigits: false })).toBe('٥٠٠');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeArabic('  دواء   قوي  ')).toBe('دواء قوي');
  });
});

describe('normalizeEnglish', () => {
  it('lowercases and normalizes quotes/hyphens', () => {
    expect(normalizeEnglish('Panadol ‘Extra’')).toBe("panadol 'extra'");
    expect(normalizeEnglish('Co–Amoxiclav')).toBe('co-amoxiclav');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeEnglish('  Panadol   Extra  ')).toBe('panadol extra');
  });
});

describe('foldDrugNameVariants', () => {
  it("folds the design doc's own worked example to one comparable string", () => {
    const variants = ['Augmentin-1GM', 'AUGMENTIN 1 GM', 'Augmentin 1g', 'Augmentin / 1 g'];
    const normalized = variants.map(foldDrugNameVariants);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('augmentin 1 g');
  });

  it('does not insert a space before a trailing digit (e.g. Vitamin B12)', () => {
    expect(foldDrugNameVariants('Vitamin B12')).toBe('vitamin b12');
  });

  it('does not split a digit embedded mid-word with letters on both sides', () => {
    // Regression test: an earlier version of the digit→letter split
    // regex matched any digit-then-letter transition anywhere in the
    // string, not just at the start of a token, and turned "E2E" into
    // "e2 e".
    expect(foldDrugNameVariants('E2E Test Mfr Co')).toBe('e2e test mfr co');
  });
});

describe('parseStrengthText', () => {
  it('parses a plain single strength', () => {
    expect(parseStrengthText('500 mg')).toEqual([
      {
        numeratorValue: 500,
        numeratorUnitCode: 'mg',
        denominatorValue: null,
        denominatorUnitCode: null,
        originalStrengthText: '500 mg',
      },
    ]);
  });

  it('parses a ratio strength', () => {
    const [component] = parseStrengthText('250 mg / 5 ml');
    expect(component).toMatchObject({
      numeratorValue: 250,
      numeratorUnitCode: 'mg',
      denominatorValue: 5,
      denominatorUnitCode: 'ml',
    });
  });

  it('parses a combination strength into multiple components', () => {
    const components = parseStrengthText('875 mg + 125 mg');
    expect(components).toHaveLength(2);
    expect(components[0]).toMatchObject({ numeratorValue: 875, numeratorUnitCode: 'mg' });
    expect(components[1]).toMatchObject({ numeratorValue: 125, numeratorUnitCode: 'mg' });
  });

  it('parses a percentage', () => {
    const [component] = parseStrengthText('0.1%');
    expect(component).toMatchObject({ numeratorValue: 0.1, numeratorUnitCode: '%' });
  });

  it('tolerates thousands separators', () => {
    const [component] = parseStrengthText('10,000 IU');
    expect(component).toMatchObject({ numeratorValue: 10000, numeratorUnitCode: 'iu' });
  });

  it('preserves the original text even when unparseable', () => {
    const [component] = parseStrengthText('as directed by physician');
    expect(component!.originalStrengthText).toBe('as directed by physician');
    expect(component!.numeratorValue).toBeNull();
  });

  it('returns an empty array for empty input', () => {
    expect(parseStrengthText('')).toEqual([]);
  });
});

describe('transliteration', () => {
  it('produces a non-empty Arabic candidate for a Latin name', () => {
    const result = transliterateLatinToArabic('Augmentin');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('augmentin');
  });

  it('produces a non-empty Latin candidate for an Arabic name', () => {
    const result = transliterateArabicToLatin('باندول');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('normalizeSearchInput', () => {
  it('routes Arabic input to the Arabic normalizer', () => {
    expect(normalizeSearchInput('أوجمنتين')).toBe('اوجمنتين');
  });

  it('routes Latin input to the English/drug-name normalizer', () => {
    expect(normalizeSearchInput('Augmentin-1GM')).toBe('augmentin 1 g');
  });
});
