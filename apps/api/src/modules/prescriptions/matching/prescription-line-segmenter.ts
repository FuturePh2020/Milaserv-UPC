import type { PrescriptionLineType } from '@prisma/client';
import { MedicationPhraseExtractor } from './medication-phrase-extractor';

/**
 * CR-001 Phase 5 — groups OCRTextBlocks into logical prescription lines
 * and classifies each one (design summary §4). v1 grouping key is the
 * OCR engine's own `lineNumber` (blocks the recognition/reading-order
 * step already placed on the same physical line — including mixed
 * Arabic+English blocks on one visual line); merging several *physical*
 * lines into one logical line (e.g. a dosage instruction wrapping onto
 * a second line) is a deliberately deferred v2 refinement, not attempted
 * here — every physical line still gets its own typed, reviewable
 * segment rather than being silently dropped or force-merged.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SegmentableBlock {
  id: string;
  rawText: string;
  normalizedText: string | null;
  boundingBox: BoundingBox | null;
  language: string | null;
  confidence: number | null;
  lineNumber: number;
}

export interface SegmentedLine {
  lineIndex: number;
  rawText: string;
  normalizedText: string | null;
  sourceBlockIds: string[];
  boundingRegion: BoundingBox | null;
  detectedLanguage: string | null;
  probableLineType: PrescriptionLineType;
  lineConfidence: number;
}

const WHATSAPP_UI_PATTERNS = [
  /^\d{1,2}:\d{2}\s*(am|pm)?$/i,
  /^(delivered|read|online|typing…?|typing\.\.\.)$/i,
  /^[✓✔]{1,2}$/,
];
const DATE_PATTERN = /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/;
const DOCTOR_PATTERN = /\b(dr\.?|prof\.?)\b|د\s*\.|دكتور|طبيب/i;
const PATIENT_PATTERN = /\b(name|age|patient)\s*[:：]/i.source + '|الاسم|العمر|المريض';
const DIAGNOSIS_PATTERN = /\b(dx|diagnosis)\s*[:：]/i.source + '|التشخيص';
const INSTRUCTION_PATTERN =
  /\b(once|twice|bid|tid|qid)\b|مرة|مرتين|ثلاث مرات|يوميا|يومياً|قبل الأكل|بعد الأكل/i;
const HEADER_KEYWORDS = /clinic|hospital|medical center|عيادة|مستشفى|مركز طبي/i;

export class PrescriptionLineSegmenter {
  constructor(private readonly phraseExtractor = new MedicationPhraseExtractor()) {}

  segment(blocks: SegmentableBlock[]): SegmentedLine[] {
    const sorted = [...blocks].sort((a, b) => a.lineNumber - b.lineNumber);
    const groups = new Map<number, SegmentableBlock[]>();
    for (const block of sorted) {
      const group = groups.get(block.lineNumber);
      if (group) group.push(block);
      else groups.set(block.lineNumber, [block]);
    }

    const groupEntries = [...groups.entries()];
    return groupEntries.map(([, group], index) => {
      const rawText = group
        .map((b) => b.rawText)
        .join(' ')
        .trim();
      const normalizedText = group.some((b) => b.normalizedText)
        ? group
            .map((b) => b.normalizedText ?? b.rawText)
            .join(' ')
            .trim()
        : null;
      const boundingRegion = unionBoundingBox(group.map((b) => b.boundingBox));
      const detectedLanguage = group.find((b) => b.language)?.language ?? null;
      const avgConfidence = average(
        group.map((b) => b.confidence).filter((c): c is number => c !== null),
      );

      const { type, confidence } = this.classify(
        normalizedText ?? rawText,
        index,
        groupEntries.length,
      );

      return {
        lineIndex: index,
        rawText,
        normalizedText,
        sourceBlockIds: group.map((b) => b.id),
        boundingRegion,
        detectedLanguage,
        probableLineType: type,
        lineConfidence: avgConfidence !== null ? avgConfidence * confidence : confidence,
      };
    });
  }

  private classify(
    text: string,
    lineIndex: number,
    totalLines: number,
  ): { type: PrescriptionLineType; confidence: number } {
    const trimmed = text.trim();
    if (!trimmed) return { type: 'UNKNOWN', confidence: 0.2 };

    if (WHATSAPP_UI_PATTERNS.some((p) => p.test(trimmed)) || trimmed.length <= 2) {
      return { type: 'WHATSAPP_UI', confidence: 0.9 };
    }
    if (DATE_PATTERN.test(trimmed)) {
      return { type: 'DATE', confidence: 0.9 };
    }
    if (new RegExp(PATIENT_PATTERN, 'i').test(trimmed)) {
      return { type: 'PATIENT_INFORMATION', confidence: 0.85 };
    }
    if (DOCTOR_PATTERN.test(trimmed)) {
      return { type: 'DOCTOR_INFORMATION', confidence: 0.85 };
    }
    if (new RegExp(DIAGNOSIS_PATTERN, 'i').test(trimmed)) {
      return { type: 'DIAGNOSIS', confidence: 0.85 };
    }

    // A phrase with real evidence (a parsed strength or dosage form) is
    // classified MEDICATION immediately, ahead of the instruction check
    // — "Augmentin 1g twice daily" is a medication line even though it
    // also carries instruction text. A phrase with only a leftover
    // name and no evidence is weak signal (design summary §4) and must
    // not outrank an explicit instruction-keyword match — otherwise a
    // pure instruction line like "Take once daily after meal" gets
    // misread as MEDICATION off its residual "Take".
    const phrase = this.phraseExtractor.extract(trimmed);
    if (phrase.confidence >= 1) {
      return { type: 'MEDICATION', confidence: phrase.confidence };
    }
    if (INSTRUCTION_PATTERN.test(trimmed)) {
      return { type: 'DOSAGE_INSTRUCTION', confidence: 0.75 };
    }
    if (phrase.confidence >= 0.6) {
      return { type: 'MEDICATION', confidence: phrase.confidence };
    }

    const isNearTop = lineIndex <= 1;
    const isNearBottom = lineIndex >= totalLines - 2;
    if (isNearTop && (HEADER_KEYWORDS.test(trimmed) || trimmed === trimmed.toUpperCase())) {
      return { type: 'HEADER', confidence: 0.55 };
    }
    if (isNearBottom && trimmed.length < 40) {
      return { type: 'FOOTER', confidence: 0.4 };
    }

    return { type: 'UNKNOWN', confidence: 0.3 };
  }
}

function unionBoundingBox(boxes: (BoundingBox | null)[]): BoundingBox | null {
  const valid = boxes.filter((b): b is BoundingBox => b !== null);
  if (valid.length === 0) return null;
  const minX = Math.min(...valid.map((b) => b.x));
  const minY = Math.min(...valid.map((b) => b.y));
  const maxX = Math.max(...valid.map((b) => b.x + b.width));
  const maxY = Math.max(...valid.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
