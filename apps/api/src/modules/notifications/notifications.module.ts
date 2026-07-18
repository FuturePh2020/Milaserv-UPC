import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { InAppChannel } from './in-app.channel';
import { EmailChannel } from './email.channel';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** Global: domain modules send notifications on their important actions. */
@Global()
@Module({
  imports: [SettingsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, InAppChannel, EmailChannel],
  exports: [NotificationsService],
})
export class NotificationsModule {}
