import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
import { UserStatus } from "@lcrm/shared";

export interface RequestMetaInput {
  ipAddress: string;
  userAgent: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async login(username: string, password: string, meta: RequestMetaInput) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    const security = await this.settings.getSecuritySettings();

    if (!user) {
      await this.audit.log({
        action: "LOGIN_FAILED",
        entityType: "User",
        metadata: { username, reason: "not_found" },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException("Invalid username or password");
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.log({
        action: "LOGIN_FAILED",
        userId: user.id,
        entityType: "User",
        entityId: user.id,
        metadata: { reason: "locked" },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException("Account is temporarily locked. Try again later.");
    }

    if (user.status !== UserStatus.ACTIVE) {
      await this.audit.log({
        action: "LOGIN_FAILED",
        userId: user.id,
        entityType: "User",
        entityId: user.id,
        metadata: { reason: "inactive_status", status: user.status },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException("Account is not active");
    }

    const passwordValid = await argon2.verify(user.passwordHash, password).catch(() => false);

    if (!passwordValid) {
      const failedCount = user.failedLoginCount + 1;
      const shouldLock = failedCount >= security.maxFailedLoginAttempts;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failedCount,
          lockedUntil: shouldLock
            ? new Date(Date.now() + security.lockoutDurationMinutes * 60_000)
            : user.lockedUntil,
        },
      });
      await this.audit.log({
        action: "LOGIN_FAILED",
        userId: user.id,
        entityType: "User",
        entityId: user.id,
        metadata: { reason: "bad_password", failedCount, locked: shouldLock },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException("Invalid username or password");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastActivityAt: new Date() },
    });

    const tokens = await this.issueTokens(user.id, user.username, user.role, meta);

    await this.audit.log({
      action: "LOGIN",
      userId: user.id,
      entityType: "User",
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        email: user.email,
      },
      ...tokens,
    };
  }

  async issueTokens(userId: string, username: string, role: string, meta: RequestMetaInput) {
    const security = await this.settings.getSecuritySettings();
    const accessTtlSec = security.accessTokenTtlMinutes * 60;
    const refreshTtlDays = security.refreshTokenTtlDays;

    const accessToken = await this.jwt.signAsync(
      { sub: userId, username, role },
      {
        secret: this.config.get<string>("JWT_ACCESS_SECRET"),
        expiresIn: accessTtlSec,
      },
    );

    const refreshTokenRaw = randomBytes(48).toString("hex");
    const refreshTokenHash = hashToken(refreshTokenRaw);
    const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refreshTokenHash,
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });

    return {
      accessToken,
      accessTokenTtlSec: accessTtlSec,
      refreshToken: refreshTokenRaw,
      refreshTokenTtlSec: refreshTtlDays * 24 * 60 * 60,
    };
  }

  async refresh(refreshTokenRaw: string, meta: RequestMetaInput) {
    const tokenHash = hashToken(refreshTokenRaw);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    if (existing.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("Account is not active");
    }

    const tokens = await this.issueTokens(existing.user.id, existing.user.username, existing.user.role, meta);

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    return {
      user: {
        id: existing.user.id,
        username: existing.user.username,
        fullName: existing.user.fullName,
        role: existing.user.role,
        email: existing.user.email,
      },
      ...tokens,
    };
  }

  async logout(refreshTokenRaw: string | undefined, userId: string | undefined, meta: RequestMetaInput) {
    if (refreshTokenRaw) {
      const tokenHash = hashToken(refreshTokenRaw);
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    if (userId) {
      await this.audit.log({
        action: "LOGOUT",
        userId,
        entityType: "User",
        entityId: userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }
}
