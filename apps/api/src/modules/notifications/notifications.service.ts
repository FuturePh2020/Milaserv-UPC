import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../core/redis/redis.module';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { PaginationQuery } from '../../core/pagination';
import { skipTake, toPage } from '../../core/pagination';
import type { NotificationChannel, NotificationMessage } from './notification-channel';
import { InAppChannel, unreadCacheKey } from './in-app.channel';
import { EmailChannel } from './email.channel';

const UNREAD_CACHE_TTL_SECONDS = 30;

@Injectable()
export class NotificationsService {
  private readonly channels: NotificationChannel[];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    inApp: InAppChannel,
    email: EmailChannel,
  ) {
    // §21 Email connector joined in Phase 11 (integrations spec J4); the
    // channel itself checks notifications.email_enabled per delivery.
    this.channels = [inApp, email];
  }

  /** Fan a message out to all enabled channels. Failures in one channel
   *  must not block the others. */
  async notify(message: NotificationMessage): Promise<void> {
    await Promise.allSettled(this.channels.map((c) => c.deliver(message)));
  }

  async notifyMany(userIds: string[], message: Omit<NotificationMessage, 'userId'>) {
    await Promise.allSettled(userIds.map((userId) => this.notify({ ...message, userId })));
  }

  async listMine(userId: string, q: PaginationQuery) {
    const where = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(q),
      }),
      this.prisma.notification.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const key = unreadCacheKey(userId);
    const cached = await this.redis.get(key).catch(() => null);
    if (cached !== null) return { count: Number(cached) };

    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    await this.redis.set(key, String(count), 'EX', UNREAD_CACHE_TTL_SECONDS).catch(() => undefined);
    return { count };
  }

  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) throw new NotFoundException('Notification not found');
    if (!notification.readAt) {
      await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
      await this.redis.del(unreadCacheKey(userId)).catch(() => undefined);
    }
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    await this.redis.del(unreadCacheKey(userId)).catch(() => undefined);
    return { ok: true };
  }
}
