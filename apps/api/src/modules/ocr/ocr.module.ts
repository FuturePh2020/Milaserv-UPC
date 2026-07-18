import { Module } from '@nestjs/common';
import { NumberingModule } from '../numbering/numbering.module';
import { SettingsModule } from '../settings/settings.module';
import { AiModule } from '../ai/ai.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { OcrController } from './ocr.controller';
import { OcrService } from './ocr.service';
import { OcrMatchService } from './ocr-match.service';

/** §17 OCR Prescription Processing (spec docs/specs/ocr-spec-v1.0.md). */
@Module({
  imports: [NumberingModule, IntegrationsModule, SettingsModule, AiModule],
  controllers: [OcrController],
  providers: [OcrService, OcrMatchService],
  exports: [OcrService],
})
export class OcrModule {}
