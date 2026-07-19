import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ImportDrugsDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  /** Raw sheet rows keyed by the Mapping export headers (spec H1/H2). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  rows!: Record<string, unknown>[];
}

export class CoverageRowDto {
  @IsString()
  material!: string;

  @IsBoolean()
  covered!: boolean;
}

export class ImportCoverageDto {
  @IsString()
  companyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => CoverageRowDto)
  rows!: CoverageRowDto[];
}

export const SEARCH_FIELDS = [
  'all',
  'brand',
  'ingredient',
  'material',
  'nameAr',
  'nameEn',
  // Phase 4 — DIC Drug Master & Normalization Foundation
  'barcode',
  'scientific',
  'alias',
] as const;
export type SearchField = (typeof SEARCH_FIELDS)[number];

export class SearchQueryDto {
  @IsString()
  @MaxLength(120)
  q!: string;

  @IsOptional()
  @IsIn(SEARCH_FIELDS as unknown as string[])
  field?: SearchField;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class CreateChangeRequestDto {
  /** Proposed patch over the H5 editable fields / coverage (spec H8). */
  @IsObject()
  patch!: Record<string, unknown>;
}

export class DecideChangeRequestDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// ── Phase 4 — DIC Drug Master & Normalization Foundation ──────────────
// docs/change-requests/CR-002-dic-drug-master-foundation.md

export class CreateDosageFormDto {
  @IsString()
  @MaxLength(40)
  code!: string;

  @IsString()
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MaxLength(120)
  nameAr!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  synonyms?: string[];
}

export class UpdateDosageFormDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameAr?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  synonyms?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateMeasurementUnitDto {
  @IsString()
  @MaxLength(20)
  code!: string;

  @IsString()
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MaxLength(120)
  nameAr!: string;

  @IsString()
  @MaxLength(40)
  unitCategory!: string;

  @IsOptional()
  @IsNumber()
  normalizationFactor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  baseUnitCode?: string;
}

export class UpdateMeasurementUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameAr?: string;

  @IsOptional()
  @IsNumber()
  normalizationFactor?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateCountryDto {
  @IsString()
  @MaxLength(2)
  isoCode!: string;

  @IsString()
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MaxLength(120)
  nameAr!: string;
}

export class UpdateCountryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameAr?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateManufacturerDto {
  @IsString()
  @MaxLength(200)
  nameEn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string;

  @IsOptional()
  @IsString()
  countryId?: string;
}

export class UpdateManufacturerDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string;

  @IsOptional()
  @IsString()
  countryId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateTherapeuticClassDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsString()
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MaxLength(120)
  nameAr!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

export class UpdateTherapeuticClassDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameAr?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateActiveIngredientDto {
  @IsString()
  @MaxLength(200)
  scientificNameEn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  scientificNameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  abbreviation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  atcCode?: string;
}

export class UpdateActiveIngredientDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  scientificNameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  scientificNameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  abbreviation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  atcCode?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

// ── Phase 4 Step 4 — alias & alternative-link approval workflows ──────

export const ALIAS_TYPES = [
  'TRADE_NAME',
  'SCIENTIFIC_NAME',
  'ABBREVIATION',
  'COMMON_MISSPELLING',
  'OCR_VARIANT',
  'LEGACY_NAME',
  'ARABIC_TRANSLITERATION',
  'ENGLISH_TRANSLITERATION',
  'MANUFACTURER_VARIANT',
  'PACKAGING_VARIANT',
  'USER_CORRECTION',
  'IMPORTED_ALIAS',
] as const;

export const ALIAS_SOURCES = [
  'MANUAL',
  'IMPORT',
  'OCR_CORRECTION',
  'LEGACY_DATABASE',
  'SYSTEM_GENERATED',
  'PHARMACIST_APPROVED',
] as const;

export const DRUG_ALTERNATIVE_TYPES = [
  'SAME_ACTIVE_INGREDIENT',
  'SAME_ACTIVE_AND_STRENGTH',
  'SAME_ACTIVE_DIFFERENT_STRENGTH',
  'SAME_DOSAGE_FORM',
  'GENERIC_ALTERNATIVE',
  'BRAND_ALTERNATIVE',
  'THERAPEUTIC_ALTERNATIVE',
] as const;

export class CreateAliasDto {
  @IsString()
  @MaxLength(255)
  alias!: string;

  @IsString()
  @MaxLength(10)
  language!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  script?: string;

  @IsIn(ALIAS_TYPES as unknown as string[])
  aliasType!: (typeof ALIAS_TYPES)[number];

  @IsOptional()
  @IsIn(ALIAS_SOURCES as unknown as string[])
  source?: (typeof ALIAS_SOURCES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class UpdateAliasDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  alias?: string;

  @IsOptional()
  @IsIn(ALIAS_TYPES as unknown as string[])
  aliasType?: (typeof ALIAS_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class DecideAliasDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CreateAlternativeLinkDto {
  @IsString()
  alternativeDrugId!: string;

  @IsIn(DRUG_ALTERNATIVE_TYPES as unknown as string[])
  alternativeType!: (typeof DRUG_ALTERNATIVE_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  equivalenceLevel?: string;

  @IsOptional()
  @IsBoolean()
  sameActiveIngredient?: boolean;

  @IsOptional()
  @IsBoolean()
  sameStrength?: boolean;

  @IsOptional()
  @IsBoolean()
  sameDosageForm?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateAlternativeLinkDto {
  @IsOptional()
  @IsIn(DRUG_ALTERNATIVE_TYPES as unknown as string[])
  alternativeType?: (typeof DRUG_ALTERNATIVE_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  equivalenceLevel?: string;

  @IsOptional()
  @IsBoolean()
  sameActiveIngredient?: boolean;

  @IsOptional()
  @IsBoolean()
  sameStrength?: boolean;

  @IsOptional()
  @IsBoolean()
  sameDosageForm?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class DecideAlternativeLinkDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
