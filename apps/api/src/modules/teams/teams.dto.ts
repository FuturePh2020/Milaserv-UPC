import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameAr: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn: string;

  @IsString()
  departmentId: string;
}

export class UpdateTeamDto {
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
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class AddMemberDto {
  @IsString()
  userId: string;

  @IsIn(['MEMBER', 'LEADER', 'MANAGER'])
  role: 'MEMBER' | 'LEADER' | 'MANAGER';
}
