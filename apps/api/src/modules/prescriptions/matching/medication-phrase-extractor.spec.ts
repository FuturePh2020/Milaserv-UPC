import { MedicationPhraseExtractor } from './medication-phrase-extractor';

describe('MedicationPhraseExtractor', () => {
  const extractor = new MedicationPhraseExtractor();

  it('extracts "Augmentin 1 g" as drug name + strength', () => {
    const result = extractor.extract('Augmentin 1 g');
    expect(result.probableDrugName).toBe('Augmentin');
    expect(result.probableStrength).toBe('1 g');
    expect(result.confidence).toBe(1);
  });

  it('extracts the Arabic transliteration "أوجمنتين 1 جم"', () => {
    const result = extractor.extract('أوجمنتين 1 جم');
    expect(result.probableDrugName).toBe('أوجمنتين');
    expect(result.probableStrength).toBe('1 جم');
  });

  it('extracts a combination "Amoxicillin / Clavulanate 875/125" preserving the ratio and flagging it scientific', () => {
    const result = extractor.extract('Amoxicillin / Clavulanate 875/125');
    expect(result.probableDrugName).toContain('Amoxicillin');
    expect(result.probableDrugName).toContain('Clavulanate');
    expect(result.probableStrength).toBe('875/125');
    expect(result.probableScientificName).toBe(result.probableDrugName);
  });

  it('extracts "Panadol Extra" with no strength (medium confidence, name only)', () => {
    const result = extractor.extract('Panadol Extra');
    expect(result.probableDrugName).toBe('Panadol Extra');
    expect(result.probableStrength).toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(1);
  });

  it('extracts "Cataflam 50 mg"', () => {
    const result = extractor.extract('Cataflam 50 mg');
    expect(result.probableDrugName).toBe('Cataflam');
    expect(result.probableStrength).toBe('50 mg');
  });

  it('extracts a trailing bare number "كونكور 5" as the strength', () => {
    const result = extractor.extract('كونكور 5');
    expect(result.probableDrugName).toBe('كونكور');
    expect(result.probableStrength).toBe('5');
  });

  it('extracts "Janumet 50/1000" preserving the ratio sequence', () => {
    const result = extractor.extract('Janumet 50/1000');
    expect(result.probableDrugName).toBe('Janumet');
    expect(result.probableStrength).toBe('50/1000');
  });

  it('extracts "Ventolin inhaler" as drug name + dosage form, no strength', () => {
    const result = extractor.extract('Ventolin inhaler');
    expect(result.probableDrugName).toBe('Ventolin');
    expect(result.probableDosageForm).toBe('INHALER');
    expect(result.probableStrength).toBeNull();
  });

  it('extracts "Ceftriaxone 1 gm injection" without letting the dosage-form word swallow the strength unit', () => {
    const result = extractor.extract('Ceftriaxone 1 gm injection');
    expect(result.probableDrugName).toBe('Ceftriaxone');
    expect(result.probableStrength).toBe('1 gm');
    expect(result.probableDosageForm).toBe('INJECTION');
  });

  it('never fabricates manufacturer or package from text alone', () => {
    const result = extractor.extract('Augmentin 1 g');
    expect(result.probableManufacturer).toBeNull();
    expect(result.probablePackage).toBeNull();
  });

  it('returns zero confidence and all-null fields for empty text', () => {
    const result = extractor.extract('   ');
    expect(result.confidence).toBe(0);
    expect(result.probableDrugName).toBeNull();
  });
});
