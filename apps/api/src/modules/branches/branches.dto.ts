import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../core/pagination';

export class ListBranchesQueryDto extends PaginationQuery {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  typeKey?: string;
}

export class CreateBranchDto {
  @IsString()
  @Matches(/^[A-Z0-9-]{2,20}$/, { message: 'code must be 2-20 chars: A-Z, 0-9, dash' })
  code: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nameAr: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nameEn: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  supervisorName?: string;

  @IsOptional()
  @IsEmail()
  supervisorEmail?: string;

  @IsOptional()
  @IsString()
  supervisorPhone?: string;

  @IsOptional()
  @IsString()
  areaManagerName?: string;

  @IsOptional()
  @IsEmail()
  areaManagerEmail?: string;
}

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nameEn?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  supervisorName?: string;

  @IsOptional()
  @IsEmail()
  supervisorEmail?: string;

  @IsOptional()
  @IsString()
  supervisorPhone?: string;

  @IsOptional()
  @IsString()
  areaManagerName?: string;

  @IsOptional()
  @IsEmail()
  areaManagerEmail?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class ImportBranchesDto {
  @IsString()
  @MaxLength(255)
  fileName: string;

  /** Raw sheet rows keyed by the United Locations export headers (spec G2). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  rows: Record<string, unknown>[];
}

export class NearestQueryDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}
