import { PrescriptionLineSegmenter, SegmentableBlock } from './prescription-line-segmenter';

function block(
  overrides: Partial<SegmentableBlock> & Pick<SegmentableBlock, 'id' | 'rawText' | 'lineNumber'>,
): SegmentableBlock {
  return {
    normalizedText: null,
    boundingBox: null,
    language: null,
    confidence: null,
    ...overrides,
  };
}

describe('PrescriptionLineSegmenter', () => {
  const segmenter = new PrescriptionLineSegmenter();

  it('groups blocks sharing a lineNumber into one logical line', () => {
    const blocks: SegmentableBlock[] = [
      block({
        id: 'b1',
        rawText: 'Augmentin',
        lineNumber: 0,
        boundingBox: { x: 0, y: 0, width: 50, height: 10 },
      }),
      block({
        id: 'b2',
        rawText: '1 g',
        lineNumber: 0,
        boundingBox: { x: 55, y: 0, width: 20, height: 10 },
      }),
    ];
    const lines = segmenter.segment(blocks);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.sourceBlockIds).toEqual(['b1', 'b2']);
    expect(line.rawText).toBe('Augmentin 1 g');
    expect(line.boundingRegion).toEqual({ x: 0, y: 0, width: 75, height: 10 });
  });

  it('keeps distinct lineNumbers as separate lines, in order', () => {
    const blocks: SegmentableBlock[] = [
      block({ id: 'b2', rawText: 'second', lineNumber: 1 }),
      block({ id: 'b1', rawText: 'first', lineNumber: 0 }),
    ];
    const lines = segmenter.segment(blocks);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.rawText).toBe('first');
    expect(lines[1]!.rawText).toBe('second');
  });

  it('classifies a WhatsApp UI artifact', () => {
    const lines = segmenter.segment([block({ id: 'b1', rawText: '10:32 AM', lineNumber: 0 })]);
    expect(lines[0]!.probableLineType).toBe('WHATSAPP_UI');
  });

  it('classifies a date line', () => {
    const lines = segmenter.segment([
      block({ id: 'b1', rawText: 'Date: 12/05/2026', lineNumber: 0 }),
    ]);
    expect(lines[0]!.probableLineType).toBe('DATE');
  });

  it('classifies patient information (English and Arabic)', () => {
    const en = segmenter.segment([block({ id: 'b1', rawText: 'Name: Ahmed Ali', lineNumber: 0 })]);
    expect(en[0]!.probableLineType).toBe('PATIENT_INFORMATION');
    const ar = segmenter.segment([block({ id: 'b1', rawText: 'الاسم: احمد', lineNumber: 0 })]);
    expect(ar[0]!.probableLineType).toBe('PATIENT_INFORMATION');
  });

  it('classifies doctor information', () => {
    const lines = segmenter.segment([
      block({ id: 'b1', rawText: 'Dr. Mohamed Samir', lineNumber: 0 }),
    ]);
    expect(lines[0]!.probableLineType).toBe('DOCTOR_INFORMATION');
  });

  it('classifies a diagnosis line', () => {
    const lines = segmenter.segment([
      block({ id: 'b1', rawText: 'Dx: Hypertension', lineNumber: 0 }),
    ]);
    expect(lines[0]!.probableLineType).toBe('DIAGNOSIS');
  });

  it('classifies a medication line', () => {
    const lines = segmenter.segment([block({ id: 'b1', rawText: 'Augmentin 1 g', lineNumber: 0 })]);
    expect(lines[0]!.probableLineType).toBe('MEDICATION');
  });

  it('classifies a dosage instruction line', () => {
    const lines = segmenter.segment([
      block({ id: 'b1', rawText: 'Take once daily after meal', lineNumber: 0 }),
    ]);
    expect(lines[0]!.probableLineType).toBe('DOSAGE_INSTRUCTION');
  });

  it('classifies an unrecognized line as UNKNOWN rather than forcing a type', () => {
    // Placed away from the top/bottom of the block set so the weak
    // HEADER/FOOTER positional heuristics don't fire on a lone line.
    const blocks: SegmentableBlock[] = [
      block({ id: 'b0', rawText: 'Clinic Header', lineNumber: 0 }),
      block({ id: 'b1', rawText: 'Name: Ahmed Ali', lineNumber: 1 }),
      block({ id: 'b2', rawText: 'xyz random gibberish text', lineNumber: 2 }),
      block({ id: 'b3', rawText: 'Take once daily', lineNumber: 3 }),
      block({ id: 'b4', rawText: 'Footer note', lineNumber: 4 }),
    ];
    const lines = segmenter.segment(blocks);
    expect(lines[2]!.probableLineType).toBe('UNKNOWN');
  });

  it('does not permanently discard uncertain lines — every block still produces a line', () => {
    const blocks: SegmentableBlock[] = [
      block({ id: 'b1', rawText: '???', lineNumber: 0 }),
      block({ id: 'b2', rawText: 'Augmentin 1 g', lineNumber: 1 }),
    ];
    const lines = segmenter.segment(blocks);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.sourceBlockIds).flat()).toEqual(['b1', 'b2']);
  });

  it('averages confidence across a group and folds in the classifier confidence', () => {
    const blocks: SegmentableBlock[] = [
      block({ id: 'b1', rawText: 'Augmentin', lineNumber: 0, confidence: 0.8 }),
      block({ id: 'b2', rawText: '1 g', lineNumber: 0, confidence: 1.0 }),
    ];
    const lines = segmenter.segment(blocks);
    expect(lines[0]!.lineConfidence).toBeGreaterThan(0);
    expect(lines[0]!.lineConfidence).toBeLessThanOrEqual(0.9);
  });

  it('returns an empty array for no blocks', () => {
    expect(segmenter.segment([])).toEqual([]);
  });
});
