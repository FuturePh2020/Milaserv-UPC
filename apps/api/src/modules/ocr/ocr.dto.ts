import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreatePrescriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
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

/** Manual line entry (spec I1 fallback / reviewer addition). */
export class AddLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  rawText: string;
}

/** Human review of one extracted line (spec I4). */
export class DecideLineDto {
  @IsIn(['confirm', 'reject', 'correct'])
  decision: 'confirm' | 'reject' | 'correct';

  /** Required when decision = correct: the drug the reviewer picked. */
  @IsOptional()
  @IsString()
  drugId?: string;
}

/** Confirm links existing records only (spec I6). */
export class ConfirmPrescriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ticketNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  orderNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectPrescriptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note: string;
}
