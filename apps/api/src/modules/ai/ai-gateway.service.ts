import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

const AI_TIMEOUT_MS = 5_000;

/**
 * AI readiness (blueprint §2.1, spec docs/specs/ai-readiness-spec-v1.0.md).
 * The single seam every future AI feature calls. Two hard preconditions
 * (K2): the data-sharing policy must be approved AND an endpoint must be
 * configured — otherwise no byte leaves the platform. Every outbound call
 * is audit-logged (K4). Callers must always have a non-AI fallback (K1):
 * this method returns null on a closed gate or any failure.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async gateOpen(): Promise<boolean> {
    const [approved, endpoint] = await Promise.all([
      this.settings.resolve('ai.policy.approved').catch(() => false),
      this.settings.resolve('integrations.ai.endpoint').catch(() => ''),
    ]);
    const on = (v: unknown) => Boolean(v) && String(v) !== 'false' && String(v) !== '';
    return on(approved) && on(endpoint);
  }

  async invoke(feature: string, payload: unknown): Promise<unknown | null> {
    if (!(await this.gateOpen())) return null;
    const endpoint = String(await this.settings.resolve('integrations.ai.endpoint'));
    const body = JSON.stringify({ feature, payload });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    let ok = false;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`AI bridge returned HTTP ${res.status}`);
      const data = (await res.json()) as { result?: unknown };
      ok = true;
      return data.result ?? null;
    } catch (e) {
      this.logger.warn(`AI invoke '${feature}' failed: ${e instanceof Error ? e.message : e}`);
      return null;
    } finally {
      clearTimeout(timer);
      // K4: the audit trail is the evidence the approved policy is followed.
      await this.audit
        .record({
          actorEmail: 'ai-gateway',
          action: 'ai.invoke',
          entityType: 'ai_call',
          after: { feature, payloadBytes: body.length, ok },
        })
        .catch(() => undefined);
    }
  }
}
