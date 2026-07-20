import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../core/pagination';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class IngestOrderDto {
  @IsString()
  @MaxLength(64)
  externalNumber!: string;

  @IsString()
  orderSourceKey!: string;

  @IsISO8601()
  orderedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  customerPhone?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  externalStatus?: string;
}

export class IngestOrdersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => IngestOrderDto)
  orders!: IngestOrderDto[];
}

export class ListOnlineOrdersQueryDto extends PaginationQuery {
  @IsOptional()
  @Matches(DATE_RE)
  from?: string;

  @IsOptional()
  @Matches(DATE_RE)
  to?: string;

  @IsOptional()
  @IsString()
  sourceKey?: string;

  @IsOptional()
  @IsString()
  q?: string;
}

export class OnlineStatsQueryDto {
  /** Day to report on (defaults to today). */
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;
}
