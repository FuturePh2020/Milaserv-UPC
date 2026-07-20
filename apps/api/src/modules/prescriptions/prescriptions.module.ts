import { Module } from '@nestjs/common';
import { NumberingModule } from '../numbering/numbering.module';
import { SettingsModule } from '../settings/settings.module';
import { PrescriptionsController } from './prescriptions.controller';
import { PrescriptionsService } from './prescriptions.service';
import { PythonOcrClientService } from './python-ocr-client.service';
import { PreprocessingConfigService } from './preprocessing-config.service';
import { OcrConfigService } from './ocr-config.service';
import { RegionDetectionConfigService } from './region-detection-config.service';
import { PrescriptionStorageModule } from './storage/prescription-storage.module';
import {
  PrescriptionQueueRedisShutdown,
  prescriptionQueueRedisProvider,
} from './queue/queue-redis.provider';
import { PrescriptionOcrQueueService } from './queue/prescription-ocr.queue';
import { PrescriptionOcrWorkerService } from './queue/prescription-ocr.worker';
import { MatchConfigService } from './matching/match-config.service';
import { DrugCandidateGenerator } from './matching/candidates/drug-candidate-generator';
import { DrugMatchingEngine } from './matching/drug-matching.engine';
import { PrescriptionDrugMatchingQueueService } from './matching/queue/prescription-drug-matching.queue';
import { DrugMatchingWorkerService } from './matching/queue/drug-matching.worker';

/**
 * CR-001 Prescription Intelligence Engine — Sprint OCR-01
 * (docs/change-requests/CR-001-prescription-intelligence-engine.md).
 * Runs alongside the Phase 10 OcrModule (untouched) until the OCR-12
 * migration/cutover.
 */
@Module({
  imports: [NumberingModule, SettingsModule, PrescriptionStorageModule],
  controllers: [PrescriptionsController],
  providers: [
    PrescriptionsService,
    PythonOcrClientService,
    PreprocessingConfigService,
    OcrConfigService,
    RegionDetectionConfigService,
    prescriptionQueueRedisProvider,
    PrescriptionQueueRedisShutdown,
    PrescriptionOcrQueueService,
    PrescriptionOcrWorkerService,
    MatchConfigService,
    DrugCandidateGenerator,
    DrugMatchingEngine,
    PrescriptionDrugMatchingQueueService,
    DrugMatchingWorkerService,
  ],
  exports: [
    PrescriptionsService,
    PrescriptionOcrQueueService,
    PrescriptionDrugMatchingQueueService,
  ],
})
export class PrescriptionsModule {}
