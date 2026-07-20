import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpsertWeeklyHoursDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsOptional()
  @Matches(HHMM)
  opensAt?: string;

  @IsOptional()
  @Matches(HHMM)
  closesAt?: string;

  @IsOptional()
  @Matches(HHMM)
  secondShiftOpensAt?: string;

  @IsOptional()
  @Matches(HHMM)
  secondShiftClosesAt?: string;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;
}

export class UpsertSpecialHoursDto {
  @IsString()
  date!: string; // ISO date, e.g. "2026-03-15"

  @IsOptional()
  @Matches(HHMM)
  opensAt?: string;

  @IsOptional()
  @Matches(HHMM)
  closesAt?: string;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class CreateServiceAreaDto {
  @IsIn(['CITY', 'DISTRICT', 'RADIUS', 'POLYGON', 'POSTAL_CODE', 'MANUAL_ZONE'])
  serviceAreaType!: 'CITY' | 'DISTRICT' | 'RADIUS' | 'POLYGON' | 'POSTAL_CODE' | 'MANUAL_ZONE';

  @IsOptional()
  @IsString()
  cityId?: string;

  @IsOptional()
  @IsString()
  districtId?: string;

  @IsOptional()
  @IsNumber()
  radiusKm?: number;

  @IsOptional()
  @IsNumber()
  centerLatitude?: number;

  @IsOptional()
  @IsNumber()
  centerLongitude?: number;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  deliveryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  minimumOrderValue?: number;

  @IsOptional()
  @IsNumber()
  maximumDeliveryDistanceKm?: number;

  @IsOptional()
  @IsInt()
  estimatedDeliveryMinutes?: number;
}

export class UpdateServiceAreaDto {
  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  deliveryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  minimumOrderValue?: number;

  @IsOptional()
  @IsNumber()
  maximumDeliveryDistanceKm?: number;

  @IsOptional()
  @IsInt()
  estimatedDeliveryMinutes?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateCapabilityDto {
  @IsString()
  @MaxLength(60)
  code!: string;

  @IsString()
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MaxLength(120)
  nameAr!: string;
}

export class AssignCapabilityDto {
  @IsString()
  capabilityId!: string;
}
