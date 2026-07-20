import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { encryptSecret } from "../common/utils/encryption";

const DEFAULT_ID = "default";

@Injectable()
export class VoipSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get() {
    const settings = await this.prisma.voipSettings.upsert({
      where: { id: DEFAULT_ID },
      update: {},
      create: { id: DEFAULT_ID },
    });
    // Never expose decrypted (or even encrypted) secrets to the frontend —
    // only whether each credential has been configured.
    return {
      id: settings.id,
      providerName: settings.providerName,
      apiBaseUrl: settings.apiBaseUrl,
      apiKeyConfigured: Boolean(settings.apiKeyEncrypted),
      apiSecretConfigured: Boolean(settings.apiSecretEncrypted),
      usernameConfigured: Boolean(settings.usernameEncrypted),
      passwordConfigured: Boolean(settings.passwordEncrypted),
      webhookSecretConfigured: Boolean(settings.webhookSecretEncrypted),
      extensionMapping: settings.extensionMapping,
      agentMapping: settings.agentMapping,
      pollingIntervalSeconds: settings.pollingIntervalSeconds,
      isActive: settings.isActive,
      ahtFormula: settings.ahtFormula,
      updatedAt: settings.updatedAt,
    };
  }

  async update(
    data: Partial<{
      providerName: string;
      apiBaseUrl: string;
      apiKey: string;
      apiSecret: string;
      username: string;
      password: string;
      webhookSecret: string;
      extensionMapping: Record<string, string>;
      agentMapping: Record<string, string>;
      pollingIntervalSeconds: number;
      isActive: boolean;
      ahtFormula: string;
    }>,
    actorId: string,
  ) {
    const encrypted: Record<string, unknown> = {};
    if (data.apiKey) encrypted.apiKeyEncrypted = encryptSecret(data.apiKey);
    if (data.apiSecret) encrypted.apiSecretEncrypted = encryptSecret(data.apiSecret);
    if (data.username) encrypted.usernameEncrypted = encryptSecret(data.username);
    if (data.password) encrypted.passwordEncrypted = encryptSecret(data.password);
    if (data.webhookSecret) encrypted.webhookSecretEncrypted = encryptSecret(data.webhookSecret);

    await this.prisma.voipSettings.upsert({
      where: { id: DEFAULT_ID },
      update: {
        providerName: data.providerName,
        apiBaseUrl: data.apiBaseUrl,
        extensionMapping: data.extensionMapping as any,
        agentMapping: data.agentMapping as any,
        pollingIntervalSeconds: data.pollingIntervalSeconds,
        isActive: data.isActive,
        ahtFormula: data.ahtFormula,
        ...encrypted,
      },
      create: {
        id: DEFAULT_ID,
        providerName: data.providerName ?? "mock",
        apiBaseUrl: data.apiBaseUrl,
        extensionMapping: (data.extensionMapping ?? {}) as any,
        agentMapping: (data.agentMapping ?? {}) as any,
        pollingIntervalSeconds: data.pollingIntervalSeconds ?? 30,
        isActive: data.isActive ?? false,
        ...encrypted,
      },
    });

    await this.audit.log({
      action: "VOIP_SETTINGS_UPDATE",
      userId: actorId,
      entityType: "VoipSettings",
      metadata: { providerName: data.providerName, isActive: data.isActive, credentialsChanged: Object.keys(encrypted).length > 0 },
    });

    return this.get();
  }

  listStatusMappings() {
    return this.prisma.voipStatusMapping.findMany({ orderBy: { providerStatus: "asc" } });
  }

  upsertStatusMapping(providerStatus: string, internalStatus: string) {
    return this.prisma.voipStatusMapping.upsert({
      where: { providerStatus },
      update: { internalStatus: internalStatus as any },
      create: { providerStatus, internalStatus: internalStatus as any },
    });
  }
}
