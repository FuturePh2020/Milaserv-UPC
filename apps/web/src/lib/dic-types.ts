/** DIC (blueprint §15) API shapes. */

export interface NamedRef {
  key: string;
  nameAr: string;
  nameEn: string;
}

export interface DicCatalogs {
  itemTypes: NamedRef[];
  companies: NamedRef[];
  /** Configured rows-per-call for the chunked master import (spec H2). */
  chunkSize: number;
}

export interface DrugSummary {
  id: string;
  materialNo: string;
  nameEn: string;
  nameAr: string | null;
  brand: string | null;
  priceWithTax: string | null;
  coded: boolean;
  raqeeb: boolean;
  itemType: NamedRef | null;
  coveredBy: string[];
}

export interface RelatedDrug {
  id: string;
  materialNo: string;
  nameEn: string;
  nameAr: string | null;
  priceWithTax: string | null;
}

export interface DrugCard {
  id: string;
  materialNo: string;
  oldMaterialNo: string | null;
  ean: string | null;
  gtin: string | null;
  sfdaCode: string | null;
  coded: boolean;
  nameEn: string;
  nameAr: string | null;
  brand: string | null;
  division: string | null;
  category: string | null;
  subCategory: string | null;
  price: string | null;
  priceWithTax: string | null;
  raqeeb: boolean;
  acuteChronic: string | null;
  activeIngredient: string | null;
  usage: string | null;
  offers: string | null;
  note: string | null;
  availability: Record<string, number> | null;
  itemType: NamedRef | null;
  coverages: { companyKey: string; covered: boolean; company: NamedRef }[];
  alternatives: { materialNo: string; order: number; drug: RelatedDrug | null }[];
  crossSells: { materialNo: string; drug: RelatedDrug | null }[];
}

export interface ChangeRequestRow {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  patch: Record<string, unknown>;
  createdAt: string;
  drug: { id: string; materialNo: string; nameEn: string; nameAr: string | null };
}

export interface ImportChunkResult {
  created: number;
  updated: number;
  invalid: { index: number; materialNo: string | null; reason: string }[];
  quality: { missingArabicName: number; notCoded: number };
}
