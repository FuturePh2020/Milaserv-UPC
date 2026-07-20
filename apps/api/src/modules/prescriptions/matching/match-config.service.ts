import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';

export interface MatchWeights {
  name: number;
  ingredient: number;
  strength: number;
  dosageForm: number;
  context: number;
  dataQuality: number;
}

export interface MatchPenalties {
  strengthConflict: number;
  dosageFormConflict: number;
  discontinuedDrug: number;
  inactiveDrug: number;
  unapprovedAlias: number;
}

export interface MatchThresholds {
  minimumTopScore: number;
  minimumCandidateMargin: number;
  veryHighMarginThreshold: number;
  veryHighMinScore: number;
  highMinScore: number;
  mediumMinScore: number;
  minimumOcrConfidence: number;
}

export interface MatchLimits {
  maxCandidatesPerLine: number;
  maxCandidatesPerStrategy: number;
  minTrigramSimilarity: number;
  maxInputTextLength: number;
}

export interface MatchConfig {
  weights: MatchWeights;
  penalties: MatchPenalties;
  thresholds: MatchThresholds;
  limits: MatchLimits;
  ocrReliabilityAdjustmentMax: number;
  engineVersion: string;
}

/**
 * CR-001 Phase 5 — resolves every matching weight/threshold from Settings
 * (ADR-008: configuration over hard-coded values), mirroring
 * OcrConfigService's exact split. Never mutated by normal agents —
 * Settings writes are gated by `setting.manage`, same as every other
 * business tunable in this codebase; no new permission key needed.
 * Callers must snapshot the resolved object onto
 * DrugMatchRun.configurationSnapshotJson so a run stays reproducible
 * even after these values change later.
 */
@Injectable()
export class MatchConfigService {
  constructor(private readonly settings: SettingsService) {}

  async resolve(): Promise<MatchConfig> {
    const num = (key: string) => this.settings.resolve(key).then(Number);
    const [
      nameWeight,
      ingredientWeight,
      strengthWeight,
      dosageFormWeight,
      contextWeight,
      dataQualityWeight,
      ocrReliabilityAdjustmentMax,
      strengthConflictPenalty,
      dosageFormConflictPenalty,
      discontinuedDrugPenalty,
      inactiveDrugPenalty,
      unapprovedAliasPenalty,
      minimumTopScore,
      minimumCandidateMargin,
      veryHighMarginThreshold,
      veryHighMinScore,
      highMinScore,
      mediumMinScore,
      minimumOcrConfidence,
      maxCandidatesPerLine,
      maxCandidatesPerStrategy,
      minTrigramSimilarity,
      maxInputTextLength,
      engineVersion,
    ] = await Promise.all([
      num('prescriptions.matching.name_weight'),
      num('prescriptions.matching.ingredient_weight'),
      num('prescriptions.matching.strength_weight'),
      num('prescriptions.matching.dosage_form_weight'),
      num('prescriptions.matching.context_weight'),
      num('prescriptions.matching.data_quality_weight'),
      num('prescriptions.matching.ocr_reliability_adjustment_max'),
      num('prescriptions.matching.strength_conflict_penalty'),
      num('prescriptions.matching.dosage_form_conflict_penalty'),
      num('prescriptions.matching.discontinued_drug_penalty'),
      num('prescriptions.matching.inactive_drug_penalty'),
      num('prescriptions.matching.unapproved_alias_penalty'),
      num('prescriptions.matching.minimum_top_score'),
      num('prescriptions.matching.minimum_candidate_margin'),
      num('prescriptions.matching.very_high_margin_threshold'),
      num('prescriptions.matching.very_high_min_score'),
      num('prescriptions.matching.high_min_score'),
      num('prescriptions.matching.medium_min_score'),
      num('prescriptions.matching.minimum_ocr_confidence'),
      num('prescriptions.matching.max_candidates_per_line'),
      num('prescriptions.matching.max_candidates_per_strategy'),
      num('prescriptions.matching.min_trigram_similarity'),
      num('prescriptions.matching.max_input_text_length'),
      this.settings.resolve('prescriptions.matching.engine_version') as Promise<string>,
    ]);

    return {
      weights: {
        name: nameWeight,
        ingredient: ingredientWeight,
        strength: strengthWeight,
        dosageForm: dosageFormWeight,
        context: contextWeight,
        dataQuality: dataQualityWeight,
      },
      penalties: {
        strengthConflict: strengthConflictPenalty,
        dosageFormConflict: dosageFormConflictPenalty,
        discontinuedDrug: discontinuedDrugPenalty,
        inactiveDrug: inactiveDrugPenalty,
        unapprovedAlias: unapprovedAliasPenalty,
      },
      thresholds: {
        minimumTopScore,
        minimumCandidateMargin,
        veryHighMarginThreshold,
        veryHighMinScore,
        highMinScore,
        mediumMinScore,
        minimumOcrConfidence,
      },
      limits: {
        maxCandidatesPerLine,
        maxCandidatesPerStrategy,
        minTrigramSimilarity,
        maxInputTextLength,
      },
      ocrReliabilityAdjustmentMax,
      engineVersion,
    };
  }
}
