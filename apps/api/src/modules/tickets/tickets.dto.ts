import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../core/pagination';

export const TICKET_VIEWS = [
  'my_tickets',
  'assigned_to_me',
  'all',
  'unassigned',
  'escalated',
  'critical',
  'branch_complaints',
  'closed_today',
] as const;
export type TicketView = (typeof TICKET_VIEWS)[number];

export class ListTicketsQueryDto extends PaginationQuery {
  @IsOptional()
  @IsIn([...TICKET_VIEWS])
  view?: TicketView;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  typeId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  urgencyId?: string;

  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  responsibleId?: string;

  @IsOptional()
  @IsString()
  createdById?: string;

  @IsOptional()
  @IsString()
  directedTeamId?: string;

  @IsOptional()
  @IsString()
  product?: string;

  @IsOptional()
  @IsIn(['ON_TRACK', 'WARNING', 'BREACHED', 'PAUSED', 'MET'])
  slaState?: 'ON_TRACK' | 'WARNING' | 'BREACHED' | 'PAUSED' | 'MET';

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasAttachments?: boolean;

  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdTo?: string;
}

export class CreateTicketDto {
  @IsString()
  typeKey: string;

  @IsString()
  categoryKey: string;

  @IsString()
  urgencyKey: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  customerName: string;

  @IsString()
  @MinLength(5)
  @MaxLength(30)
  customerPhone: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(5)
  description: string;

  @IsOptional()
  @IsString()
  relatedOrderNo?: string;

  @IsOptional()
  @IsISO8601()
  customerVisitAt?: string;

  @IsOptional()
  @IsString()
  sapMaterialNo?: string;

  @IsOptional()
  @IsString()
  itemNameAr?: string;

  @IsOptional()
  @IsString()
  itemNameEn?: string;

  /** Required when typeKey = BRANCH (§9.8: user picks branch only). */
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  directedTeamIds?: string[];
}

export class AssignTicketDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class RedirectTicketDto {
  @IsArray()
  @IsString({ each: true })
  teamIds: string[];
}

export class AddUpdateDto {
  @IsString()
  updateTypeKey: string;

  @IsString()
  @MinLength(2)
  body: string;

  @IsOptional()
  @IsString()
  directedToTeamId?: string;
}

export class ChangeStatusDto {
  @IsString()
  statusKey: string;
}

export class EscalateTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class ResolveTicketDto {
  @IsString()
  @MinLength(5)
  summary: string;

  @IsString()
  @MinLength(3)
  rootCause: string;

  @IsString()
  @MinLength(3)
  actionTaken: string;

  @IsString()
  @MinLength(3)
  finalSolution: string;

  @IsString()
  resolutionCategoryKey: string;

  @IsBoolean()
  customerInformed: boolean;
}

export class ReopenTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
