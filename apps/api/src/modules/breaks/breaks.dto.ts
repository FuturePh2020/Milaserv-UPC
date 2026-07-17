import { IsISO8601, IsOptional, IsString } from 'class-validator';
import { PaginationQuery } from '../../core/pagination';

export class HeartbeatDto {
  /** Timestamp of the most recent mouse/keyboard input (spec §4 — the only
   *  activity datum ever transmitted). Omitted = "alive, nothing new". */
  @IsOptional()
  @IsISO8601()
  lastActivityAt?: string;
}

export class ListSessionsQueryDto extends PaginationQuery {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
