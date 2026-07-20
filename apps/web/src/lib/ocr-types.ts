/** OCR Prescription Processing (blueprint §17) API shapes. */

export type PrescriptionStatus = 'UPLOADED' | 'EXTRACTING' | 'REVIEW' | 'CONFIRMED' | 'REJECTED';
export type LineStatus = 'SUGGESTED' | 'CONFIRMED' | 'CORRECTED' | 'REJECTED';

export interface PrescriptionRow {
  id: string;
  number: string;
  status: PrescriptionStatus;
  uploadedById: string;
  relatedOrderNo: string | null;
  note: string | null;
  createdAt: string;
  _count: { lines: number };
}

export interface MatchedDrug {
  id: string;
  materialNo: string;
  nameEn: string;
  nameAr: string | null;
  priceWithTax: string | null;
  coded: boolean;
  availability: Record<string, number> | null;
}

export interface AlternativeRef {
  materialNo: string;
  drug: {
    id: string;
    materialNo: string;
    nameEn: string;
    nameAr: string | null;
    priceWithTax: string | null;
  } | null;
}

export interface PrescriptionLineRow {
  id: string;
  lineNo: number;
  rawText: string;
  engineConfidence: number | null;
  matchScore: number | null;
  matchedDrugId: string | null;
  matchedDrug: MatchedDrug | null;
  status: LineStatus;
  alternatives: AlternativeRef[];
}

export interface PrescriptionDetail {
  id: string;
  number: string;
  status: PrescriptionStatus;
  uploadedById: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  ticketId: string | null;
  relatedOrderNo: string | null;
  note: string | null;
  createdAt: string;
  lines: PrescriptionLineRow[];
}

export interface OcrConfig {
  minConfidence: number;
}
