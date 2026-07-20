import { Injectable } from "@nestjs/common";
import { DEFAULT_AGENT_PERMISSIONS, Permission, UserRole } from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface PermissionCheckUser {
  userId: string;
  role: string;
}

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admins always pass. Agents pass if granted an override or covered by the role default set. */
  async can(user: PermissionCheckUser, permission: Permission): Promise<boolean> {
    if (user.role === UserRole.ADMIN) return true;

    const override = await this.prisma.userPermission.findUnique({
      where: { userId_permission: { userId: user.userId, permission } },
    });
    if (override) return true;

    return (DEFAULT_AGENT_PERMISSIONS as string[]).includes(permission);
  }

  async listForUser(userId: string) {
    return this.prisma.userPermission.findMany({ where: { userId } });
  }

  async setForUser(userId: string, permissions: Permission[]) {
    await this.prisma.$transaction([
      this.prisma.userPermission.deleteMany({ where: { userId } }),
      this.prisma.userPermission.createMany({
        data: permissions.map((permission) => ({ userId, permission })),
        skipDuplicates: true,
      }),
    ]);
    return this.listForUser(userId);
  }
}
