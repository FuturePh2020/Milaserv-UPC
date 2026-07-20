import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const SEARCH_LOCATION_SOURCE_TYPES = [
  'MANUAL_CITY',
  'MANUAL_DISTRICT',
  'FREE_TEXT_ADDRESS',
  'MAP_PIN',
  'DEVICE_GEOLOCATION',
  'SAVED_ADDRESS',
  'PARTNER_API',
  'IMPORTED',
  'UNKNOWN',
] as const;

const FULFILLMENT_MODES = ['DELIVERY', 'PICKUP', 'EITHER', 'INTERNAL_TRANSFER', 'UNKNOWN'] as const;

export class CreateSearchLocationDto {
  @IsOptional()
  @IsString()
  cityId?: string;

  @IsOptional()
  @IsString()
  districtId?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsIn(SEARCH_LOCATION_SOURCE_TYPES)
  sourceType!: (typeof SEARCH_LOCATION_SOURCE_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  userConfirmed?: boolean;
}

export class CreateFulfillmentRequestDto {
  @IsString()
  prescriptionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  medicationLineIds!: string[];

  @IsOptional()
  @IsString()
  searchLocationId?: string;

  @IsOptional()
  @IsIn(FULFILLMENT_MODES)
  requestedFulfillmentMode?: (typeof FULFILLMENT_MODES)[number];
}
