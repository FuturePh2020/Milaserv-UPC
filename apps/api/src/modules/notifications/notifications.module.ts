import { Global, Module } from '@nestjs/common';
import { InAppChannel } from './in-app.channel';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** Global: domain modules send notifications on their important actions. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, InAppChannel],
  exports: [NotificationsService],
})
export class NotificationsModule {}
