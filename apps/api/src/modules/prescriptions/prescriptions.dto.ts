import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

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

/** multipart/form-data text fields alongside the uploaded file — string
 *  "true"/"false" coerced since multer/multipart never sends real
 *  booleans (CR-001 Sprint OCR-02 Extension). */
export class UploadPageDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  clipboardPasted?: boolean;
}

export class CropBoxDto {
  @IsInt()
  @Min(0)
  x!: number;

  @IsInt()
  @Min(0)
  y!: number;

  @IsInt()
  @Min(1)
  width!: number;

  @IsInt()
  @Min(1)
  height!: number;
}

/** CR-001 Sprint OCR-02 Extension — confirms a crop either by picking
 *  one or more detected candidate regions, or by supplying a manual
 *  override box. Exactly one of the two must be given — enforced in
 *  PrescriptionsService.confirmCrop(), not here (a cross-field "exactly
 *  one of" rule is simpler as a plain check than a decorator). */
export class ConfirmCropDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  selectedRegionIndices?: number[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CropBoxDto)
  manualCropBox?: CropBoxDto;
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
