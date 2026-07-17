import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../core/pagination';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class IngestRowDto {
  @Matches(DATE_RE, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @IsString()
  metricKey!: string;

  /** Agent rows: platform user email (spec D7). */
  @IsOptional()
  @IsString()
  userEmail?: string;

  /** Queue/team rows. Exactly one of userEmail/teamId is required. */
  @IsOptional()
  @IsString()
  teamId?: string;

  @IsNumber()
  @Min(0)
  value!: number;
}

export class IngestMetricsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => IngestRowDto)
  rows!: IngestRowDto[];
}

export class ListMetricsQueryDto extends PaginationQuery {
  @IsOptional()
  @Matches(DATE_RE)
  from?: string;

  @IsOptional()
  @Matches(DATE_RE)
  to?: string;

  @IsOptional()
  @IsString()
  metricKey?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  teamId?: string;
}

export class DashboardQueryDto {
  @IsIn(['DAILY', 'MONTHLY', 'YEARLY'])
  period!: 'DAILY' | 'MONTHLY' | 'YEARLY';

  /** Anchor day inside the period; defaults to today. */
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsString()
  metricKey?: string;
}

export class UpsertTargetDto {
  @IsIn(['USER', 'TEAM'])
  scopeType!: 'USER' | 'TEAM';

  @IsString()
  scopeId!: string;

  @IsString()
  metricKey!: string;

  @IsIn(['DAILY', 'MONTHLY', 'YEARLY'])
  period!: 'DAILY' | 'MONTHLY' | 'YEARLY';

  @IsNumber()
  @Min(0.01)
  targetValue!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
