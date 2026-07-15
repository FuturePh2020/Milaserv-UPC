import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { LocalDiskStorage } from './storage';

@Global()
@Module({
  imports: [SettingsModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, LocalDiskStorage],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
