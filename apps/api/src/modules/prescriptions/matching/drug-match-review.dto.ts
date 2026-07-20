import { IsOptional, IsString, MaxLength } from 'class-validator';

/** CR-001 Phase 5 — pharmacist review workflow DTOs (design summary
 *  §21-23). Every mutating action here records a DrugMatchDecision;
 *  none of them ever silently confirms a medication on the engine's
 *  own authority (design summary §2).
 */

export class RejectCandidateDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SelectDrugManuallyDto {
  @IsString()
  drugId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class MarkNotMedicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
