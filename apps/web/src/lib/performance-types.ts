export type TargetPeriod = 'DAILY' | 'MONTHLY' | 'YEARLY';
export type PerfScopeType = 'USER' | 'TEAM';
export type PerfColor = 'GREEN' | 'AMBER' | 'RED' | 'GRAY';
export type PerfTrend = 'UP' | 'DOWN' | 'FLAT' | null;

export interface MetricDef {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  unit: 'count' | 'seconds' | 'percent';
  aggregation: 'SUM' | 'AVG';
  source: 'YEASTAR' | 'TICKETING';
  higherIsBetter: boolean;
}

export interface DashboardRow {
  scopeType: PerfScopeType;
  scope: { id: string; nameAr: string; nameEn: string };
  metric: {
    key: string;
    nameAr: string;
    nameEn: string;
    unit: string;
    higherIsBetter: boolean;
  };
  actual: number | null;
  target: number | null;
  achievementPct: number | null;
  trend: PerfTrend;
  color: PerfColor;
}

export interface DashboardResponse {
  period: TargetPeriod;
  from: string;
  to: string;
  rows: DashboardRow[];
}

export interface TargetRow {
  id: string;
  scopeType: PerfScopeType;
  scopeId: string;
  metricKey: string;
  period: TargetPeriod;
  targetValue: string;
  active: boolean;
  metric: { key: string; nameAr: string; nameEn: string; unit: string };
}
