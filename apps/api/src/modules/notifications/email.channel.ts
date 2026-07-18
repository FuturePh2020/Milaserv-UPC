import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { NotificationChannel, NotificationMessage } from './notification-channel';

/**
 * §21 Email connector as a notification channel (integrations spec J4):
 * when notifications.email_enabled is on and the user has an address, the
 * message is queued as an `email.send` integration operation toward the
 * SMTP bridge — retry/DLQ/Monitor semantics included.
 *
 * The operation row is created directly (not via IntegrationsService):
 * NotificationsModule is a dependency of the Integration Engine, so
 * importing it back here would be circular. Same queue, same executor.
 */
@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly name = 'email';

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async deliver(message: NotificationMessage): Promise<void> {
    const enabled = await this.settings.resolve('notifications.email_enabled').catch(() => false);
    if (!enabled || String(enabled) === 'false') return;

    const user = await this.prisma.user.findFirst({
      where: { id: message.userId, deletedAt: null },
      select: { email: true },
    });
    if (!user?.email) return;

    await this.prisma.integrationOperation.create({
      data: {
        integrationKey: 'email',
        operation: 'send',
        payload: {
          to: user.email,
          titleAr: message.titleAr,
          titleEn: message.titleEn,
          bodyAr: message.bodyAr ?? null,
          bodyEn: message.bodyEn ?? null,
          type: message.type,
        },
      },
    });
  }
}
