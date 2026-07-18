import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreatePrescriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  source?: string;
}

export class ListPrescriptionsQueryDto {
  @IsOptional()
  @IsIn(['UPLOADED', 'EXTRACTING', 'REVIEW', 'CONFIRMED', 'REJECTED'])
  status?: 'UPLOADED' | 'EXTRACTING' | 'REVIEW' | 'CONFIRMED' | 'REJECTED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
