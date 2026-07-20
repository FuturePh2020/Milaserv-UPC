import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_ID = "default";

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSecuritySettings() {
    return this.prisma.securitySettings.upsert({
      where: { id: DEFAULT_ID },
      update: {},
      create: { id: DEFAULT_ID },
    });
  }

  async updateSecuritySettings(data: Partial<{
    maxFailedLoginAttempts: number;
    lockoutDurationMinutes: number;
    accessTokenTtlMinutes: number;
    refreshTokenTtlDays: number;
    passwordMinLength: number;
    passwordRequireUppercase: boolean;
    passwordRequireNumber: boolean;
    passwordRequireSymbol: boolean;
    maxUploadSizeMb: number;
  }>) {
    return this.prisma.securitySettings.upsert({
      where: { id: DEFAULT_ID },
      update: data,
      create: { id: DEFAULT_ID, ...data },
    });
  }

  async getDistributionSettings() {
    return this.prisma.distributionSettings.upsert({
      where: { id: DEFAULT_ID },
      update: {},
      create: { id: DEFAULT_ID },
    });
  }

  async updateDistributionSettings(data: Partial<{
    strategy: any;
    maxActiveLeadsPerAgent: number;
    allowNextBeforeCompletion: boolean;
    reservationTimeoutMinutes: number;
    autoReturnUntouched: boolean;
    maxLeadsPerHour: number;
  }>) {
    return this.prisma.distributionSettings.upsert({
      where: { id: DEFAULT_ID },
      update: data,
      create: { id: DEFAULT_ID, ...data },
    });
  }

  async getInactivitySettings() {
    return this.prisma.inactivitySettings.upsert({
      where: { id: DEFAULT_ID },
      update: {},
      create: { id: DEFAULT_ID },
    });
  }

  async updateInactivitySettings(data: Record<string, unknown>) {
    return this.prisma.inactivitySettings.upsert({
      where: { id: DEFAULT_ID },
      update: data as any,
      create: { id: DEFAULT_ID, ...(data as any) },
    });
  }

  async getBreakThresholdSettings() {
    return this.prisma.breakThresholdSettings.upsert({
      where: { id: DEFAULT_ID },
      update: {},
      create: { id: DEFAULT_ID },
    });
  }

  async updateBreakThresholdSettings(data: Record<string, unknown>) {
    return this.prisma.breakThresholdSettings.upsert({
      where: { id: DEFAULT_ID },
      update: data as any,
      create: { id: DEFAULT_ID, ...(data as any) },
    });
  }
}
