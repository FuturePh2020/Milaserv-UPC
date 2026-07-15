import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
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
