import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @Matches(/^[A-Z0-9-]{2,20}$/, { message: 'code must be 2-20 chars: A-Z, 0-9, dash' })
  code: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameAr: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
