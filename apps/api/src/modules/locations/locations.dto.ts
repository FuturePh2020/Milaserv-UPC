import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRegionDto {
  @IsString()
  @MaxLength(40)
  code!: string;

  @IsString()
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MaxLength(120)
  nameAr!: string;
}

export class UpdateRegionDto {
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

export class CreateCityDto {
  @IsString()
  @MaxLength(40)
  code!: string;

  @IsString()
  regionId!: string;

  @IsString()
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MaxLength(120)
  nameAr!: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;
}

export class UpdateCityDto {
  @IsOptional()
  @IsString()
  regionId?: string;

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
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateDistrictDto {
  @IsString()
  @MaxLength(40)
  code!: string;

  @IsString()
  cityId!: string;

  @IsString()
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MaxLength(120)
  nameAr!: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;
}

export class UpdateDistrictDto {
  @IsOptional()
  @IsString()
  cityId?: string;

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
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateLocationAliasDto {
  @IsIn(['CITY', 'DISTRICT'])
  entityType!: 'CITY' | 'DISTRICT';

  @IsString()
  entityId!: string;

  @IsString()
  @MaxLength(160)
  alias!: string;

  @IsIn(['en', 'ar'])
  language!: 'en' | 'ar';
}

export class ResolveBranchLocationDto {
  @IsString()
  cityId!: string;

  @IsOptional()
  @IsString()
  districtId?: string;
}
