export type WorkPeriodType = 'WORK' | 'BREAK' | 'IDLE';
export type LiveState = 'AVAILABLE' | 'ON_BREAK' | 'IDLE' | 'OFFLINE';

export interface BreakAllowance {
  allowanceMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
}

export interface MySessionSummary {
  id: string;
  teamId: string | null;
  startedAt: string;
  currentPeriod: { type: WorkPeriodType; startedAt: string } | null;
  activeSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
}

export interface BreaksMe {
  session: MySessionSummary | null;
  breakAllowance: BreakAllowance;
  config: { heartbeatIntervalSeconds: number; idleThresholdSeconds: number };
}

export interface LiveMember {
  user: { id: string; nameAr: string; nameEn: string };
  team: { id: string; nameAr: string; nameEn: string } | null;
  state: LiveState;
  since: string | null;
  breakAllowance: BreakAllowance;
}

export interface BreaksLive {
  asOf: string;
  members: LiveMember[];
}
