import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as argon2 from "argon2";
import { UserStatus } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: { role?: string; status?: string; teamId?: string; search?: string }) {
    return this.prisma.user.findMany({
      where: {
        role: params.role as any,
        status: params.status as any,
        teamId: params.teamId,
        OR: params.search
          ? [
              { username: { contains: params.search, mode: "insensitive" } },
              { fullName: { contains: params.search, mode: "insensitive" } },
            ]
          : undefined,
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        teamId: true,
        team: { select: { id: true, name: true } },
        currentAgentStatus: true,
        extension: true,
        createdAt: true,
        lastActivityAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        agentTaskPermissions: { include: { task: true } },
        agentPartnerRestrictions: { include: { partner: true } },
        agentCategoryRestrictions: { include: { category: true } },
        team: true,
      },
    });
    if (!user) throw new NotFoundException("User not found");
    const { passwordHash, ...safe } = user;
    return safe;
  }

  async create(data: {
    username: string;
    email?: string;
    password: string;
    fullName: string;
    role: "ADMIN" | "AGENT";
    teamId?: string;
    extension?: string;
  }) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: data.username }, ...(data.email ? [{ email: data.email }] : [])] },
    });
    if (existing) throw new ConflictException("Username or email already in use");

    const passwordHash = await argon2.hash(data.password);
    const user = await this.prisma.user.create({
      data: {
        username: data.username,
        email: data.email || undefined,
        passwordHash,
        fullName: data.fullName,
        role: data.role,
        teamId: data.teamId,
        extension: data.extension,
      },
    });
    const { passwordHash: _omit, ...safe } = user;
    return safe;
  }

  async update(id: string, data: Partial<{
    email: string;
    fullName: string;
    teamId: string;
    extension: string;
    isActive: boolean;
  }>) {
    await this.ensureExists(id);
    const { isActive, ...rest } = data;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...rest,
        status: isActive === undefined ? undefined : isActive ? UserStatus.ACTIVE : UserStatus.SUSPENDED,
      },
    });
    const { passwordHash, ...safe } = user;
    return safe;
  }

  async setStatus(id: string, status: "ACTIVE" | "SUSPENDED" | "LOCKED") {
    await this.ensureExists(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { status, lockedUntil: status === "LOCKED" ? new Date(Date.now() + 365 * 24 * 3600 * 1000) : null },
    });
    const { passwordHash, ...safe } = user;
    return safe;
  }

  async resetPassword(id: string, newPassword: string) {
    await this.ensureExists(id);
    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null, mustChangePassword: true },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async delete(id: string) {
    await this.ensureExists(id);
    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }

  async setTaskPermissions(userId: string, taskIds: string[]) {
    await this.ensureExists(userId);
    await this.prisma.$transaction([
      this.prisma.agentTaskPermission.deleteMany({ where: { userId } }),
      this.prisma.agentTaskPermission.createMany({
        data: taskIds.map((taskId) => ({ userId, taskId })),
        skipDuplicates: true,
      }),
    ]);
    return this.findOne(userId);
  }

  async setPartnerRestrictions(userId: string, partnerIds: string[]) {
    await this.ensureExists(userId);
    await this.prisma.$transaction([
      this.prisma.agentPartnerRestriction.deleteMany({ where: { userId } }),
      this.prisma.agentPartnerRestriction.createMany({
        data: partnerIds.map((partnerId) => ({ userId, partnerId })),
        skipDuplicates: true,
      }),
    ]);
    return this.findOne(userId);
  }

  async setCategoryRestrictions(userId: string, categoryIds: string[]) {
    await this.ensureExists(userId);
    await this.prisma.$transaction([
      this.prisma.agentCategoryRestriction.deleteMany({ where: { userId } }),
      this.prisma.agentCategoryRestriction.createMany({
        data: categoryIds.map((categoryId) => ({ userId, categoryId })),
        skipDuplicates: true,
      }),
    ]);
    return this.findOne(userId);
  }

  private async ensureExists(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }
}
