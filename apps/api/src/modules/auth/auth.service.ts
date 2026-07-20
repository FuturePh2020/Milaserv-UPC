import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import type { Env } from '../../core/config/env';
import { ENV } from '../../core/config/config.module';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const REFRESH_SECRET_BYTES = 48;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Parse durations like "900s", "15m", "7d" into milliseconds. */
function ttlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);
  const value = Number(match[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2] as 's' | 'm' | 'h' | 'd'
  ];
  return value * unit;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(email: string, password: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } },
    });

    // Uniform error for unknown user vs wrong password — no account enumeration.
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'user',
        actorEmail: email,
        after: { reason: !user ? 'unknown_email' : 'inactive_account' },
        ...meta,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.record({
        actorId: user.id,
        actorEmail: email,
        action: 'auth.login_locked',
        entityType: 'user',
        entityId: user.id,
        ...meta,
      });
      throw new ForbiddenException('Account temporarily locked. Try again later.');
    }

    const passwordOk = await argon2.verify(user.passwordHash, password);
    if (!passwordOk) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= this.env.LOGIN_MAX_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: shouldLock ? 0 : attempts,
          lockedUntil: shouldLock
            ? new Date(Date.now() + this.env.LOGIN_LOCKOUT_MINUTES * 60_000)
            : null,
        },
      });
      await this.audit.record({
        actorId: user.id,
        actorEmail: email,
        action: shouldLock ? 'auth.locked' : 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        after: { attempts },
        ...meta,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const [tokens] = await Promise.all([
      this.createSession(user.id, user.email, meta),
      this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null, lastSignInAt: new Date() },
      }),
    ]);

    await this.audit.record({
      actorId: user.id,
      actorEmail: email,
      action: 'auth.login_success',
      entityType: 'user',
      entityId: user.id,
      ...meta,
    });

    return {
      ...tokens,
      mustChangePassword: user.mustChangePassword,
      user: {
        id: user.id,
        email: user.email,
        nameAr: user.nameAr,
        nameEn: user.nameEn,
        roles: user.roles.map((r) => r.role.key),
      },
    };
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<TokenPair> {
    const parsed = this.parseRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { id: parsed.sessionId },
      include: { user: true },
    });

    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < now ||
      session.refreshTokenHash !== sha256(parsed.secret) ||
      session.user.deletedAt ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Idle timeout (§19.3): a session unused for too long cannot be refreshed.
    const idleLimitMs = this.env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000;
    if (now.getTime() - session.lastActivityAt.getTime() > idleLimitMs) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: now },
      });
      throw new UnauthorizedException('Session expired due to inactivity');
    }

    // Rotate the refresh secret: a replayed old token becomes invalid.
    const newSecret = randomBytes(REFRESH_SECRET_BYTES).toString('hex');
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: sha256(newSecret),
        lastActivityAt: now,
        ip: meta.ip ?? session.ip,
        userAgent: meta.userAgent ?? session.userAgent,
      },
    });

    return {
      accessToken: await this.signAccessToken(session.user.id, session.user.email, session.id),
      refreshToken: `${session.id}.${newSecret}`,
    };
  }

  async logout(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId: userId,
      action: 'auth.logout',
      entityType: 'session',
      entityId: sessionId,
      ...meta,
    });
  }

  async changePassword(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (newPassword.length < this.env.PASSWORD_MIN_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${this.env.PASSWORD_MIN_LENGTH} characters`,
      );
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await argon2.hash(newPassword), mustChangePassword: false },
      }),
      // Revoke every other session — a password change invalidates old logins.
      this.prisma.session.updateMany({
        where: { userId, id: { not: sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      actorId: userId,
      actorEmail: user.email,
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: userId,
      ...meta,
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: { include: { role: true } },
        department: true,
        teams: { include: { team: true } },
      },
    });
    return {
      id: user.id,
      email: user.email,
      nameAr: user.nameAr,
      nameEn: user.nameEn,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      department: user.department
        ? { id: user.department.id, nameAr: user.department.nameAr, nameEn: user.department.nameEn }
        : null,
      roles: user.roles.map((r) => ({
        key: r.role.key,
        nameAr: r.role.nameAr,
        nameEn: r.role.nameEn,
      })),
      teams: user.teams.map((m) => ({
        id: m.team.id,
        nameAr: m.team.nameAr,
        nameEn: m.team.nameEn,
        role: m.role,
      })),
    };
  }

  private async createSession(
    userId: string,
    email: string,
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const secret = randomBytes(REFRESH_SECRET_BYTES).toString('hex');
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: sha256(secret),
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + ttlToMs(this.env.JWT_REFRESH_TTL)),
      },
    });
    return {
      accessToken: await this.signAccessToken(userId, email, session.id),
      refreshToken: `${session.id}.${secret}`,
    };
  }

  private signAccessToken(userId: string, email: string, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, email, sid: sessionId },
      {
        secret: this.env.JWT_ACCESS_SECRET,
        expiresIn: Math.floor(ttlToMs(this.env.JWT_ACCESS_TTL) / 1000),
      },
    );
  }

  private parseRefreshToken(token: string): { sessionId: string; secret: string } {
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return { sessionId: token.slice(0, dot), secret: token.slice(dot + 1) };
  }
}
