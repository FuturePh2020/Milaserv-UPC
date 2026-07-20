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

  async getCrmWorkflowSettings() {
    return this.prisma.crmWorkflowSettings.upsert({
      where: { id: DEFAULT_ID },
      update: {},
      create: { id: DEFAULT_ID },
    });
  }

  async updateCrmWorkflowSettings(data: Partial<{
    orderNumberFormat: string;
    mandatoryNotesOutcomes: string[];
    rescheduleMorningStart: string;
    rescheduleMorningEnd: string;
    rescheduleEveningStart: string;
    rescheduleEveningEnd: string;
  }>) {
    const { mandatoryNotesOutcomes, ...rest } = data;
    return this.prisma.crmWorkflowSettings.upsert({
      where: { id: DEFAULT_ID },
      update: { ...rest, mandatoryNotesOutcomes: mandatoryNotesOutcomes as any },
      create: { id: DEFAULT_ID, ...rest, mandatoryNotesOutcomes: (mandatoryNotesOutcomes ?? []) as any },
    });
  }

  async getAutoRefreshSettings() {
    return this.prisma.autoRefreshSettings.upsert({
      where: { id: DEFAULT_ID },
      update: {},
      create: { id: DEFAULT_ID },
    });
  }

  async updateAutoRefreshSettings(data: Partial<{
    enabled: boolean;
    defaultIntervalSeconds: number;
    minIntervalSeconds: number;
    maxIntervalSeconds: number;
    pauseWhileEditing: boolean;
    realtimeEnabled: boolean;
    fallbackPollingEnabled: boolean;
    pageIntervals: Record<string, number>;
  }>) {
    const { pageIntervals, ...rest } = data;
    return this.prisma.autoRefreshSettings.upsert({
      where: { id: DEFAULT_ID },
      update: { ...rest, pageIntervals: pageIntervals as any },
      create: { id: DEFAULT_ID, ...rest, pageIntervals: (pageIntervals ?? {}) as any },
    });
  }

  async listConfigurableReasons(category?: string) {
    return this.prisma.configurableReason.findMany({
      where: { category },
      orderBy: [{ category: "asc" }, { displayOrder: "asc" }],
    });
  }

  async upsertConfigurableReason(data: { category: string; code: string; label: string; isActive?: boolean; displayOrder?: number }) {
    return this.prisma.configurableReason.upsert({
      where: { category_code: { category: data.category, code: data.code } },
      update: { label: data.label, isActive: data.isActive, displayOrder: data.displayOrder },
      create: data,
    });
  }
}
