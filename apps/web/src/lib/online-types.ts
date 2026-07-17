export interface OnlineOrderRow {
  id: string;
  externalNumber: string;
  orderSource: { key: string; nameAr: string; nameEn: string };
  orderedAt: string;
  customerName: string | null;
  customerPhone: string | null;
  value: string | null;
  externalStatus: string | null;
}

export interface OnlineStats {
  date: string;
  dailyOrders: number;
  issues: { open: number; closedToday: number; handledToday: number };
  requests: { open: number; closedToday: number; handledToday: number };
  avgHandlingMinutes: number | null;
  slaAchievementPct: number | null;
}

export type IntegrationOpStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'DEAD';

export interface IntegrationHealth {
  integrationKey: string;
  counts: Partial<Record<IntegrationOpStatus, number>>;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

export interface IntegrationOperationRow {
  id: string;
  integrationKey: string;
  operation: string;
  status: IntegrationOpStatus;
  attempts: number;
  nextRetryAt: string;
  lastError: string | null;
  createdAt: string;
}
