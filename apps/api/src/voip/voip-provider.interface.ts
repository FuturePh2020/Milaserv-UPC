/**
 * Provider-agnostic VoIP adapter contract (spec section 19). Every real
 * integration (e.g. a specific SIP/PBX vendor) implements this interface;
 * the rest of the system only ever talks to `VoipProviderAdapter`, never to
 * a concrete provider SDK. `MockVoipProvider` is the only implementation
 * shipped in this pass — real vendor adapters are follow-up work
 * (docs/ROADMAP.md) but require no changes to this contract or its callers.
 */
export interface InitiateCallParams {
  agentId: string;
  agentExtension?: string;
  leadId?: string;
  customerPhone: string;
  taskId?: string;
}

export interface InitiateCallResult {
  externalCallId: string;
  status: string;
}

export interface CallStatusResult {
  externalCallId: string;
  status: string;
  talkTimeSeconds?: number;
  holdTimeSeconds?: number;
  wrapUpTimeSeconds?: number;
  recordingUrl?: string;
}

export interface AgentPresenceResult {
  agentExtension: string;
  status: string;
}

export interface VoipProviderAdapter {
  authenticate(): Promise<boolean>;
  initiateCall(params: InitiateCallParams): Promise<InitiateCallResult>;
  getCallStatus(externalCallId: string): Promise<CallStatusResult>;
  receiveWebhook(payload: unknown, signature: string | undefined): Promise<void>;
  getAgentCalls(agentExtension: string): Promise<CallStatusResult[]>;
  getInboundCalls(sinceIso: string): Promise<CallStatusResult[]>;
  getOutboundCalls(sinceIso: string): Promise<CallStatusResult[]>;
  getAgentPresence(agentExtension: string): Promise<AgentPresenceResult>;
  syncCallRecords(sinceIso: string): Promise<CallStatusResult[]>;
}
