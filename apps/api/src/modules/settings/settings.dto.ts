import { Allow, IsDefined, IsIn, IsOptional, IsString } from 'class-validator';

export class ListSettingsQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(['SYSTEM', 'DEPARTMENT', 'TEAM'])
  scopeLevel?: 'SYSTEM' | 'DEPARTMENT' | 'TEAM';

  @IsOptional()
  @IsString()
  scopeId?: string;
}

export class PutSettingDto {
  /** JSON value — type-checked against the catalog's valueType in the service. */
  @IsDefined()
  @Allow()
  value: unknown;

  @IsOptional()
  @IsIn(['SYSTEM', 'DEPARTMENT', 'TEAM'])
  scopeLevel?: 'SYSTEM' | 'DEPARTMENT' | 'TEAM';

  @IsOptional()
  @IsString()
  scopeId?: string;
}

export class DeleteSettingOverrideQueryDto {
  @IsIn(['DEPARTMENT', 'TEAM'])
  scopeLevel: 'DEPARTMENT' | 'TEAM';

  @IsString()
  scopeId: string;
}
