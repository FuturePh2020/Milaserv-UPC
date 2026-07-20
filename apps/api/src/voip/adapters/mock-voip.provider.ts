import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  AgentPresenceResult,
  CallStatusResult,
  InitiateCallParams,
  InitiateCallResult,
  VoipProviderAdapter,
} from "../voip-provider.interface";

/**
 * In-memory mock adapter used until a real VoIP provider is connected.
 * Deterministic and side-effect-free beyond its own state, so it's safe to
 * exercise from tests and the dev environment without any external service.
 */
@Injectable()
export class MockVoipProvider implements VoipProviderAdapter {
  private calls = new Map<string, CallStatusResult>();

  async authenticate(): Promise<boolean> {
    return true;
  }

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    const externalCallId = `mock-${randomUUID()}`;
    this.calls.set(externalCallId, { externalCallId, status: "RINGING" });
    return { externalCallId, status: "RINGING" };
  }

  async getCallStatus(externalCallId: string): Promise<CallStatusResult> {
    return this.calls.get(externalCallId) ?? { externalCallId, status: "UNKNOWN" };
  }

  async receiveWebhook(): Promise<void> {
    // The mock provider delivers state changes via `advance()` directly
    // rather than real inbound HTTP webhooks; the generic webhook endpoint
    // in VoipController still exercises the full verify/idempotency path
    // for providers that do call it.
  }

  async getAgentCalls(): Promise<CallStatusResult[]> {
    return Array.from(this.calls.values());
  }

  async getInboundCalls(): Promise<CallStatusResult[]> {
    return [];
  }

  async getOutboundCalls(): Promise<CallStatusResult[]> {
    return Array.from(this.calls.values());
  }

  async getAgentPresence(agentExtension: string): Promise<AgentPresenceResult> {
    return { agentExtension, status: "AVAILABLE" };
  }

  async syncCallRecords(): Promise<CallStatusResult[]> {
    return Array.from(this.calls.values());
  }

  /** Test/demo helper: advances a mock call to a new status. */
  advance(externalCallId: string, status: string, extra: Partial<CallStatusResult> = {}) {
    const existing = this.calls.get(externalCallId) ?? { externalCallId, status: "RINGING" };
    const updated = { ...existing, ...extra, status };
    this.calls.set(externalCallId, updated);
    return updated;
  }
}
