import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../core/pagination';

export class LeadRowDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(30)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UploadLeadsDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  /** §14.1: Lead Source / Partner / Campaign fixed at upload time. */
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  leadSource!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  partnerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  campaign?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => LeadRowDto)
  rows!: LeadRowDto[];
}

export class ListLeadsQueryDto extends PaginationQuery {
  @IsOptional()
  @IsIn(['NEW', 'ASSIGNED', 'CLOSED'])
  status?: 'NEW' | 'ASSIGNED' | 'CLOSED';

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  q?: string;
}

export class OrderPayloadDto {
  @IsString()
  orderTypeKey!: string;

  @IsNumber()
  @Min(0.01)
  value!: number;
}

export class LogCallDto {
  @IsString()
  callStatusKey!: string;

  @IsString()
  dispositionKey!: string;

  @IsInt()
  @Min(0)
  durationSeconds!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Required when the disposition requires a reschedule (spec E3). */
  @IsOptional()
  @IsISO8601()
  rescheduledAt?: string;

  /** Required when the disposition creates an order (Order Created). */
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderPayloadDto)
  order?: OrderPayloadDto;
}

export class ListOrdersQueryDto extends PaginationQuery {
  @IsOptional()
  @IsIn(['OPEN', 'COMPLETED', 'CANCELLED'])
  status?: 'OPEN' | 'COMPLETED' | 'CANCELLED';

  @IsOptional()
  @IsString()
  q?: string;
}

export class UpdateOrderStatusDto {
  @IsIn(['COMPLETED', 'CANCELLED'])
  status!: 'COMPLETED' | 'CANCELLED';
}
