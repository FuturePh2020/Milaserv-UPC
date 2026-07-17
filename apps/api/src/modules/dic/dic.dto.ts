import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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
