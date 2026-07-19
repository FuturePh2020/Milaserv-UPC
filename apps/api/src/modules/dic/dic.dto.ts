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
