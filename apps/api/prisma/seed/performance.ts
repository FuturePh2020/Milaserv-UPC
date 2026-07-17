import type { MetricAggregation, MetricSource, PrismaClient } from '@prisma/client';

interface MetricDefSeed {
  key: string;
  nameAr: string;
  nameEn: string;
  unit: 'count' | 'seconds' | 'percent';
  aggregation: MetricAggregation;
  source: MetricSource;
  higherIsBetter: boolean;
}

/** Blueprint §12.1 — the Yeastar P570 KPI list, verbatim (spec D2/D6). */
const METRIC_DEFS: MetricDefSeed[] = [
  {
    key: 'inbound_calls',
    nameAr: 'المكالمات الواردة',
    nameEn: 'Inbound Calls',
    unit: 'count',
    aggregation: 'SUM',
    source: 'YEASTAR',
    higherIsBetter: true,
  },
  {
    key: 'outbound_calls',
    nameAr: 'المكالمات الصادرة',
    nameEn: 'Outbound Calls',
    unit: 'count',
    aggregation: 'SUM',
    source: 'YEASTAR',
    higherIsBetter: true,
  },
  {
    key: 'missed_calls',
    nameAr: 'المكالمات الفائتة',
    nameEn: 'Missed Calls',
    unit: 'count',
    aggregation: 'SUM',
    source: 'YEASTAR',
    higherIsBetter: false,
  },
  {
    key: 'abandoned_calls',
    nameAr: 'المكالمات المهجورة',
    nameEn: 'Abandoned Calls',
    unit: 'count',
    aggregation: 'SUM',
    source: 'YEASTAR',
    higherIsBetter: false,
  },
  {
    key: 'queue_calls_answered',
    nameAr: 'مكالمات الطابور المُجابة',
    nameEn: 'Queue Calls Answered',
    unit: 'count',
    aggregation: 'SUM',
    source: 'YEASTAR',
    higherIsBetter: true,
  },
  {
    key: 'queue_calls_talk_time',
    nameAr: 'زمن التحدث لمكالمات الطابور',
    nameEn: 'Queue Calls Talk Time',
    unit: 'seconds',
    aggregation: 'SUM',
    source: 'YEASTAR',
    higherIsBetter: true,
  },
  {
    key: 'outbound_calls_answered',
    nameAr: 'المكالمات الصادرة المُجابة',
    nameEn: 'Outbound Calls Answered',
    unit: 'count',
    aggregation: 'SUM',
    source: 'YEASTAR',
    higherIsBetter: true,
  },
  {
    key: 'outbound_calls_talk_time',
    nameAr: 'زمن التحدث للمكالمات الصادرة',
    nameEn: 'Outbound Calls Talk Time',
    unit: 'seconds',
    aggregation: 'SUM',
    source: 'YEASTAR',
    higherIsBetter: true,
  },
  {
    key: 'total_calls',
    nameAr: 'إجمالي المكالمات',
    nameEn: 'Total Calls',
    unit: 'count',
    aggregation: 'SUM',
    source: 'YEASTAR',
    higherIsBetter: true,
  },
  {
    key: 'total_talk_time',
    nameAr: 'إجمالي زمن التحدث',
    nameEn: 'Total Talk Time',
    unit: 'seconds',
    aggregation: 'SUM',
    source: 'YEASTAR',
    higherIsBetter: true,
  },
  {
    key: 'avg_handle_time',
    nameAr: 'متوسط زمن المعالجة',
    nameEn: 'AVG Handle Time',
    unit: 'seconds',
    aggregation: 'AVG',
    source: 'YEASTAR',
    higherIsBetter: false,
  },
  {
    key: 'avg_talk_time',
    nameAr: 'متوسط زمن التحدث',
    nameEn: 'AVG Talk Time',
    unit: 'seconds',
    aggregation: 'AVG',
    source: 'YEASTAR',
    higherIsBetter: true,
  },
  {
    key: 'avg_hold_time',
    nameAr: 'متوسط زمن الانتظار المعلق',
    nameEn: 'AVG Hold Time',
    unit: 'seconds',
    aggregation: 'AVG',
    source: 'YEASTAR',
    higherIsBetter: false,
  },
  {
    key: 'avg_wait_time',
    nameAr: 'متوسط زمن الانتظار',
    nameEn: 'AVG Wait Time',
    unit: 'seconds',
    aggregation: 'AVG',
    source: 'YEASTAR',
    higherIsBetter: false,
  },
  {
    key: 'team_sla',
    nameAr: 'SLA الفريق',
    nameEn: 'Team SLA',
    unit: 'percent',
    aggregation: 'AVG',
    source: 'TICKETING',
    higherIsBetter: true,
  },
  {
    key: 'agent_sla',
    nameAr: 'SLA الموظف',
    nameEn: 'Agent SLA',
    unit: 'percent',
    aggregation: 'AVG',
    source: 'TICKETING',
    higherIsBetter: true,
  },
];

export async function seedPerformanceCatalog(prisma: PrismaClient): Promise<void> {
  let order = 0;
  for (const def of METRIC_DEFS) {
    order += 10;
    await prisma.performanceMetricDef.upsert({
      where: { key: def.key },
      update: {
        nameAr: def.nameAr,
        nameEn: def.nameEn,
        unit: def.unit,
        aggregation: def.aggregation,
        source: def.source,
        higherIsBetter: def.higherIsBetter,
        sortOrder: order,
      },
      create: { ...def, sortOrder: order },
    });
  }
  console.log(`✔ performance metric defs (§12.1): ${METRIC_DEFS.length}`);
}
