'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { QualityDashboard, QualityIssueDrug } from '@/lib/dic-types';
import { Badge, ErrorState, Spinner } from '@/components/ui';

const RULES = [
  'missing_name_ar',
  'missing_dosage_form',
  'missing_manufacturer',
  'missing_strength',
  'missing_barcode',
  'needs_review',
  'incomplete',
] as const;

/** dic.pharmacist_review dashboard (design doc §18): aggregate counts
 *  plus a rule-keyed drill-down into the offending drugs. */
export function QualityTab() {
  const t = useTranslations();
  const [rule, setRule] = useState<(typeof RULES)[number] | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dic-quality-dashboard'],
    queryFn: () => api<QualityDashboard>('/dic/quality/dashboard'),
  });

  const { data: issues, isFetching: issuesLoading } = useQuery({
    queryKey: ['dic-quality-issues', rule],
    queryFn: () => api<QualityIssueDrug[]>(`/dic/quality/issues?rule=${rule}&limit=25`),
    enabled: rule !== null,
  });

  if (isLoading) return <Spinner />;
  if (error || !data) {
    return <ErrorState message={error instanceof ApiError ? error.message : t('common.error')} />;
  }

  const cards: { key: string; value: number }[] = [
    { key: 'totalActiveDrugs', value: data.totalActiveDrugs },
    { key: 'pendingAliasApprovals', value: data.pendingAliasApprovals },
    { key: 'pendingAlternativeApprovals', value: data.pendingAlternativeApprovals },
    { key: 'pendingImportBatches', value: data.pendingImportBatches },
    { key: 'mergedDrugs', value: data.mergedDrugs },
  ];

  const ruleCounts: Partial<Record<(typeof RULES)[number], number>> = {
    missing_name_ar: data.missingFields.nameAr,
    missing_dosage_form: data.missingFields.dosageForm,
    missing_manufacturer: data.missingFields.manufacturer,
    missing_strength: data.missingFields.strengthText,
    missing_barcode: data.missingFields.barcode,
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.key} className="rounded-lg border border-gray-200 bg-white p-4 text-center">
            <div className="text-2xl font-bold text-[#0b2545]">{c.value}</div>
            <div className="mt-1 text-xs text-gray-500">{t(`dic.quality.card.${c.key}`)}</div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('dic.quality.byStatus')}</h3>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(data.byDataQualityStatus).map(([status, count]) => (
            <Badge key={status} tone="blue">
              {status}: {count}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">
          {t('dic.quality.missingFields')}
        </h3>
        <div className="flex flex-wrap gap-2">
          {RULES.map((ruleKey) => (
            <button
              key={ruleKey}
              onClick={() => setRule(ruleKey)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                rule === ruleKey
                  ? 'border-[#0b2545] bg-[#0b2545] text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {t(`dic.quality.rule.${ruleKey}`)}
              {ruleCounts[ruleKey] !== undefined && `: ${ruleCounts[ruleKey]}`}
            </button>
          ))}
        </div>
      </div>

      {rule && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">
            {t(`dic.quality.rule.${rule}`)}
          </h3>
          {issuesLoading ? (
            <Spinner />
          ) : !issues || issues.length === 0 ? (
            <p className="text-sm text-gray-400">{t('dic.quality.noIssues')}</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {issues.map((d) => (
                <li key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-gray-900">{d.nameEn}</span>
                  <span className="text-xs text-gray-400" dir="ltr">
                    {d.materialNo}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
