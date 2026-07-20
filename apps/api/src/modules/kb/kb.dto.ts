import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../core/pagination';

export const KB_KINDS = [
  'SOP',
  'ADDED_SOP',
  'DAILY_NOTE',
  'VIDEO',
  'PDF',
  'WORD',
  'FLOW_CHART',
] as const;

export class ListContentsQueryDto extends PaginationQuery {
  @IsOptional()
  @IsIn([...KB_KINDS])
  kind?: (typeof KB_KINDS)[number];

  @IsOptional()
  @IsString()
  q?: string;

  /** kb.manage only: include drafts/archived. */
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
}

export class CreateContentDto {
  @IsIn([...KB_KINDS])
  kind: (typeof KB_KINDS)[number];

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titleAr: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titleEn: string;

  @IsOptional()
  @IsString()
  summaryAr?: string;

  @IsOptional()
  @IsString()
  summaryEn?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsUrl()
  videoUrl?: string;

  @IsOptional()
  @IsISO8601()
  expiryAt?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdateContentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titleAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titleEn?: string;

  @IsOptional()
  @IsString()
  summaryAr?: string;

  @IsOptional()
  @IsString()
  summaryEn?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsUrl()
  videoUrl?: string;

  @IsOptional()
  @IsISO8601()
  expiryAt?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class CreateCourseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titleAr: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titleEn: string;

  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  descriptionEn?: string;

  /** Defaults to the creator (§10.2 Course Admin). */
  @IsOptional()
  @IsString()
  courseAdminId?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titleAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titleEn?: string;

  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  courseAdminId?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

export class AddLessonDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titleAr: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titleEn: string;

  @IsOptional()
  @IsString()
  contentId?: string;

  @IsOptional()
  @IsUrl()
  videoUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationSeconds?: number;
}

export class AssignCourseDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  teamIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];

  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

export class LessonProgressDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  positionSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  watchTimeDeltaSeconds?: number;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
