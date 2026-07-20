import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Prisma } from '@prisma/client';
import { REDIS } from '../../core/redis/redis.module';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { NotificationChannel, NotificationMessage } from './notification-channel';

export const unreadCacheKey = (userId: string) => `notif:unread:${userId}`;

@Injectable()
export class InAppChannel implements NotificationChannel {
  readonly name = 'in_app';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async deliver(message: NotificationMessage): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId: message.userId,
        type: message.type,
        titleAr: message.titleAr,
        titleEn: message.titleEn,
        bodyAr: message.bodyAr,
        bodyEn: message.bodyEn,
        payload: (message.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    // Unread count is a DB-backed cache — drop it, next read recomputes.
    await this.redis.del(unreadCacheKey(message.userId)).catch(() => undefined);
  }
}
