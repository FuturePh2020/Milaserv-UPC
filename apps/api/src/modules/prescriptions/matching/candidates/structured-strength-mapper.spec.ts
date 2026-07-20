import { StrengthParser } from '../strength-parser';
import { candidateStrengthFromStructured } from './structured-strength-mapper';

describe('candidateStrengthFromStructured', () => {
  const parser = new StrengthParser();

  it('maps a single numerator-only component to a plain dose', () => {
    const result = candidateStrengthFromStructured(
      [
        {
          numeratorValue: 500,
          numeratorUnitCode: 'mg',
          denominatorValue: null,
          denominatorUnitCode: null,
          sequence: 0,
        },
      ],
      '500 mg',
      parser,
    );
    expect(result.components).toEqual([{ value: 500, unit: 'mg' }]);
    expect(result.numerator).toBeNull();
    expect(result.parseConfidence).toBe(1);
  });

  it('maps a single component with a denominator to a concentration', () => {
    const result = candidateStrengthFromStructured(
      [
        {
          numeratorValue: 250,
          numeratorUnitCode: 'mg',
          denominatorValue: 5,
          denominatorUnitCode: 'ml',
          sequence: 0,
        },
      ],
      '250 mg / 5 ml',
      parser,
    );
    expect(result.numerator).toBe(250);
    expect(result.numeratorUnit).toBe('mg');
    expect(result.denominator).toBe(5);
    expect(result.denominatorUnit).toBe('ml');
    expect(result.components).toEqual([]);
  });

  it('maps multiple numerator-only components to a same-unit sequence, preserving order', () => {
    const result = candidateStrengthFromStructured(
      [
        {
          numeratorValue: 125,
          numeratorUnitCode: 'mg',
          denominatorValue: null,
          denominatorUnitCode: null,
          sequence: 1,
        },
        {
          numeratorValue: 875,
          numeratorUnitCode: 'mg',
          denominatorValue: null,
          denominatorUnitCode: null,
          sequence: 0,
        },
      ],
      '875/125 mg',
      parser,
    );
    expect(result.components).toEqual([
      { value: 875, unit: 'mg' },
      { value: 125, unit: 'mg' },
    ]);
  });

  it('falls back to parsing the free-text field when no structured rows exist', () => {
    const result = candidateStrengthFromStructured([], '1 g', parser);
    expect(result.components).toEqual([{ value: 1, unit: 'g' }]);
  });

  it('returns an empty, zero-confidence result when nothing is available', () => {
    const result = candidateStrengthFromStructured([], null, parser);
    expect(result.parseConfidence).toBe(0);
  });
});
