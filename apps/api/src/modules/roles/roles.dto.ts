import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DATA_SCOPES } from '@milaserv/contracts';

export class GrantDto {
  @IsString()
  permissionKey: string;

  @IsIn([...DATA_SCOPES])
  dataScope: (typeof DATA_SCOPES)[number];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopeTeamIds?: string[];
}

export class CreateRoleDto {
  @IsString()
  @Matches(/^[A-Z0-9_]{3,40}$/, { message: 'key must be 3-40 chars: A-Z, 0-9, underscore' })
  key: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameAr: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrantDto)
  grants?: GrantDto[];
}

export class UpdateRoleDto {
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

  /** Full replacement of the role's grants when provided. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrantDto)
  grants?: GrantDto[];
}
