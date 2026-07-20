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
  /** §21 DBS link approved (integrations spec J3). */
  dbsEnabled: boolean;
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

// ── Phase 4 — DIC Drug Master & Normalization Foundation ──────────────

export interface RefRow {
  id: string;
  nameAr: string;
  nameEn: string;
  active: boolean;
}

export interface DosageForm extends RefRow {
  code: string;
  synonymsJson: string[] | null;
}

export interface MeasurementUnit extends RefRow {
  code: string;
  unitCategory: string;
  normalizationFactor: number | null;
  baseUnitCode: string | null;
}

export interface Country extends RefRow {
  isoCode: string;
}

export interface Manufacturer extends RefRow {
  countryId: string | null;
  country: Country | null;
}

export interface TherapeuticClass extends RefRow {
  code: string | null;
  parentId: string | null;
}

export interface ActiveIngredient {
  id: string;
  scientificNameEn: string;
  scientificNameAr: string | null;
  abbreviation: string | null;
  atcCode: string | null;
  active: boolean;
}

export type MatchSource = 'primary' | 'alias' | 'scientific';

export interface DrugSummaryExt extends DrugSummary {
  matchSource?: MatchSource;
}

export interface DrugAlias {
  id: string;
  drugId: string;
  alias: string;
  language: string;
  aliasType: string;
  source: string;
  approved: boolean;
  active: boolean;
  createdAt: string;
  duplicateOf?: { id: string; materialNo: string; nameEn: string }[];
  drug?: { id: string; materialNo: string; nameEn: string; nameAr: string | null };
}

export interface DrugAlternativeLink {
  id: string;
  sourceDrugId: string;
  alternativeDrugId: string;
  alternativeType: string;
  pharmacistApproved: boolean;
  active: boolean;
  priority: number;
  createdAt: string;
  sourceDrug?: { id: string; materialNo: string; nameEn: string; nameAr: string | null };
  alternativeDrug?: { id: string; materialNo: string; nameEn: string; nameAr: string | null };
}

export interface DrugCardExt extends DrugCard {
  dosageForm: DosageForm | null;
  manufacturer: Manufacturer | null;
  countryOfOrigin: Country | null;
  strengthText: string | null;
  barcode: string | null;
  version: number;
  dataQualityStatus: string;
  mergedIntoDrugId: string | null;
  ingredients: {
    id: string;
    ingredientStrength: string | null;
    activeIngredient: ActiveIngredient;
  }[];
  strengthComponents: {
    id: string;
    originalStrengthText: string | null;
    numericValue: string | null;
  }[];
  packages: { id: string; packageType: string; packagingDescriptionEn: string | null }[];
  aliases: DrugAlias[];
  therapeuticClasses: { therapeuticClass: TherapeuticClass; primary: boolean }[];
  approvedAlternatives: DrugAlternativeLink[];
}

export interface ImportBatch {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  importedRows: number;
  failedRows: number;
  mappingJson: Record<string, string> | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportRow {
  id: string;
  rowNumber: number;
  rawDataJson: Record<string, unknown>;
  normalizedDataJson: Record<string, string> | null;
  validationErrorsJson: { field: string; message: string; severity: 'error' | 'warning' }[] | null;
  duplicateCandidatesJson:
    | { drugId: string; materialNo: string; nameEn: string; score: number; matchedOn: string[] }[]
    | null;
  resolution: string | null;
  status: string;
  linkedDrugId: string | null;
}

export interface QualityDashboard {
  totalActiveDrugs: number;
  byDataQualityStatus: Record<string, number>;
  missingFields: {
    nameAr: number;
    dosageForm: number;
    manufacturer: number;
    strengthText: number;
    barcode: number;
  };
  pendingAliasApprovals: number;
  pendingAlternativeApprovals: number;
  pendingImportBatches: number;
  mergedDrugs: number;
}

export interface QualityIssueDrug {
  id: string;
  materialNo: string;
  nameEn: string;
  nameAr: string | null;
  dataQualityStatus: string;
}
