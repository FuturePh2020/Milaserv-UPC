import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { DicController } from './dic.controller';
import { DicService } from './dic.service';
import { DicImportService } from './dic-import.service';
import { DicReferenceController } from './dic-reference.controller';
import { DicReferenceService } from './dic-reference.service';
import { DicRelationsController } from './dic-relations.controller';
import { DicAliasService } from './dic-alias.service';
import { DicAlternativeService } from './dic-alternative.service';
import { DicStagedImportController } from './dic-staged-import.controller';
import { DicStagedImportService } from './dic-staged-import.service';

/** United Pharmacy Center — DIC (blueprint §15; Phase 4 design doc
 *  CR-002 for the Drug Master & Normalization Foundation additions). */
@Module({
  imports: [SettingsModule, IntegrationsModule],
  controllers: [
    DicController,
    DicReferenceController,
    DicRelationsController,
    DicStagedImportController,
  ],
  providers: [
    DicService,
    DicImportService,
    DicReferenceService,
    DicAliasService,
    DicAlternativeService,
    DicStagedImportService,
  ],
  exports: [
    DicService,
    DicImportService,
    DicReferenceService,
    DicAliasService,
    DicAlternativeService,
    DicStagedImportService,
  ],
})
export class DicModule {}
