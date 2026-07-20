'use client';

/**
 * Phase 6 — Location-Aware Branch Inventory & Fulfillment Engine: the
 * review workspace. Reuses drug-match-review.tsx's shape (tone maps +
 * expandable evidence, permission-gated mutations, invalidate-on-
 * success) for a different domain. Every plan the engine offers is
 * shown as-is, including why a branch was scored the way it was — never
 * hidden behind a single "best pick." The engine never auto-selects a
 * plan; "select" here is the one explicit confirm action that reserves
 * stock (§26), and it's a distinct, higher-trust permission from
 * merely searching.
 *
 * Note: the candidate-exclusion list (which branches were filtered out
 * and why) is computed during plan generation but not persisted per
 * branch — only a NO_SAFE_PLAN row's explanationJson carries an
 * aggregate excludedBranchCount. A full per-branch exclusion panel
 * would need that data persisted first; out of scope for this step.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pickName } from '@/lib/names';
import type { DrugMatchesResponse } from '@/lib/prescription-types';
import type { City, District } from '@/lib/fulfillment-types';
import type {
  FulfillmentPlanEntry,
  FulfillmentPlanType,
  FulfillmentRequestEntry,
  FulfillmentRequestStatus,
  PlanItemAvailabilityStatus,
  SearchLocationSourceType,
} from '@/lib/fulfillment-types';
import { Badge, Button, EmptyState, ErrorState, Input, Select, Spinner } from '@/components/ui';

type Tone = 'gray' | 'green' | 'red' | 'blue' | 'amber' | 'purple';

const REQUEST_STATUS_TONES: Record<FulfillmentRequestStatus, Tone> = {
  DRAFT: 'gray',
  LOCATION_REQUIRED: 'gray',
  SEARCH_QUEUED: 'gray',
  SEARCHING: 'blue',
  OPTIONS_FOUND: 'green',
  PARTIAL_OPTIONS_FOUND: 'amber',
  NO_OPTIONS_FOUND: 'red',
  REVIEW_REQUIRED: 'amber',
  PLAN_SELECTED: 'blue',
  EXPIRED: 'gray',
  FAILED: 'red',
};

const PLAN_TYPE_TONES: Record<FulfillmentPlanType, Tone> = {
  SINGLE_BRANCH: 'green',
  SPLIT_BRANCH: 'amber',
  PICKUP: 'blue',
  DELIVERY: 'blue',
  MIXED_MODE: 'amber',
  NO_SAFE_PLAN: 'red',
};

const AVAILABILITY_TONES: Record<PlanItemAvailabilityStatus, Tone> = {
  AVAILABLE: 'green',
  PARTIAL: 'amber',
  UNAVAILABLE: 'red',
  UNKNOWN: 'gray',
};

export default function FulfillmentPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { hasPermission } = useAuth();
  const canRequest = hasPermission('fulfillment.request');
  const canSelectPlan = hasPermission('fulfillment.select_plan');
  const qc = useQueryClient();

  const [prescriptionId, setPrescriptionId] = useState('');
  const [loadedPrescriptionId, setLoadedPrescriptionId] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [cityId, setCityId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [addressText, setAddressText] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [usedGeolocation, setUsedGeolocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fulfillmentRequestId, setFulfillmentRequestId] = useState<string | null>(null);

  const { data: matches, isLoading: matchesLoading } = useQuery({
    queryKey: ['fulfillment-drug-matches', loadedPrescriptionId],
    queryFn: () => api<DrugMatchesResponse>(`/prescriptions/${loadedPrescriptionId}/drug-matches`),
    enabled: !!loadedPrescriptionId,
    retry: false,
  });

  const { data: cities } = useQuery({
    queryKey: ['fulfillment-cities'],
    queryFn: () => api<City[]>('/locations/cities'),
    staleTime: 300_000,
  });
  const { data: districts } = useQuery({
    queryKey: ['fulfillment-districts', cityId],
    queryFn: () => api<District[]>(`/locations/districts?cityId=${cityId}`),
    enabled: !!cityId,
  });

  const { data: request, refetch: refetchRequest } = useQuery({
    queryKey: ['fulfillment-request', fulfillmentRequestId],
    queryFn: () => api<FulfillmentRequestEntry>(`/fulfillment/requests/${fulfillmentRequestId}`),
    enabled: !!fulfillmentRequestId,
  });

  const confirmedLines = (matches?.lines ?? []).filter(
    (l) => l.matchingStatus === 'CONFIRMED' || l.matchingStatus === 'MANUALLY_SELECTED',
  );

  function loadPrescription() {
    if (!prescriptionId.trim()) return;
    setError(null);
    setFulfillmentRequestId(null);
    setSelectedLineIds(new Set());
    setLoadedPrescriptionId(prescriptionId.trim());
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError(t('locator.noGeolocation'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setUsedGeolocation(true);
      },
      () => setError(t('locator.locationDenied')),
    );
  }

  const search = useMutation({
    mutationFn: async () => {
      const sourceType: SearchLocationSourceType =
        lat && lng ? (usedGeolocation ? 'DEVICE_GEOLOCATION' : 'MAP_PIN') : districtId ? 'MANUAL_DISTRICT' : cityId ? 'MANUAL_CITY' : 'FREE_TEXT_ADDRESS';
      const location = await api<{ id: string }>('/fulfillment/search-locations', {
        method: 'POST',
        body: {
          cityId: cityId || undefined,
          districtId: districtId || undefined,
          latitude: lat ? Number(lat) : undefined,
          longitude: lng ? Number(lng) : undefined,
          addressText: addressText || undefined,
          sourceType,
        },
      });
      const req = await api<{ id: string }>('/fulfillment/requests', {
        method: 'POST',
        body: {
          prescriptionId: loadedPrescriptionId,
          medicationLineIds: [...selectedLineIds],
          searchLocationId: location.id,
        },
      });
      await api(`/fulfillment/requests/${req.id}/generate-plans`, { method: 'POST' });
      return req.id;
    },
    onSuccess: (id) => {
      setError(null);
      setFulfillmentRequestId(id);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  const selectPlan = useMutation({
    mutationFn: (planId: string) =>
      api(`/fulfillment/requests/${fulfillmentRequestId}/plans/${planId}/select`, { method: 'POST' }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['fulfillment-request', fulfillmentRequestId] });
      void refetchRequest();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  });

  if (!canRequest) {
    return <ErrorState message={t('fulfillment.noPermission')} />;
  }

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">{t('fulfillment.title')}</h1>
      {error && <ErrorState message={error} />}

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label={t('fulfillment.prescriptionId')}
            dir="ltr"
            value={prescriptionId}
            onChange={(e) => setPrescriptionId(e.target.value)}
            className="w-72"
          />
          <Button type="button" onClick={loadPrescription} disabled={!prescriptionId.trim()}>
            {t('fulfillment.loadBtn')}
          </Button>
        </div>

        {matchesLoading && <Spinner />}

        {matches && (
          <div>
            {confirmedLines.length === 0 ? (
              <EmptyState message={t('fulfillment.noConfirmedLines')} />
            ) : (
              <ul className="space-y-1.5">
                {confirmedLines.map((line) => (
                  <li key={line.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedLineIds.has(line.id)}
                      onChange={(e) =>
                        setSelectedLineIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(line.id);
                          else next.delete(line.id);
                          return next;
                        })
                      }
                    />
                    <span className="text-gray-900">
                      {line.selectedDrug?.nameEn ?? line.rawText}
                    </span>
                    {line.selectedDrug && (
                      <span className="text-xs text-gray-400" dir="ltr">
                        {line.selectedDrug.materialNo}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {loadedPrescriptionId && confirmedLines.length > 0 && (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">{t('fulfillment.locationTitle')}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select
              label={t('fulfillment.city')}
              value={cityId}
              onChange={(e) => {
                setCityId(e.target.value);
                setDistrictId('');
              }}
            >
              <option value="">{t('common.select')}</option>
              {(cities ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {pickName(locale, c)}
                </option>
              ))}
            </Select>
            <Select
              label={t('fulfillment.district')}
              value={districtId}
              onChange={(e) => setDistrictId(e.target.value)}
              disabled={!cityId}
            >
              <option value="">{t('common.select')}</option>
              {(districts ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {pickName(locale, d)}
                </option>
              ))}
            </Select>
            <Input
              label={t('fulfillment.addressText')}
              value={addressText}
              onChange={(e) => setAddressText(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label={t('locator.lat')}
              dir="ltr"
              value={lat}
              onChange={(e) => {
                setLat(e.target.value);
                setUsedGeolocation(false);
              }}
              className="w-40"
            />
            <Input
              label={t('locator.lng')}
              dir="ltr"
              value={lng}
              onChange={(e) => {
                setLng(e.target.value);
                setUsedGeolocation(false);
              }}
              className="w-40"
            />
            <Button type="button" variant="secondary" onClick={useMyLocation}>
              📍 {t('locator.useMyLocation')}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => search.mutate()}
              disabled={
                search.isPending ||
                selectedLineIds.size === 0 ||
                (!cityId && !districtId && !addressText && !(lat && lng))
              }
            >
              {search.isPending ? t('fulfillment.searching') : t('fulfillment.searchBtn')}
            </Button>
          </div>
        </div>
      )}

      {request && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">{t('fulfillment.plansTitle')}</h2>
            <Badge tone={REQUEST_STATUS_TONES[request.status] ?? 'gray'}>
              {t(`fulfillment.requestStatus.${request.status}`)}
            </Badge>
          </div>
          {request.plans.length === 0 ? (
            <EmptyState message={t('fulfillment.noPlans')} />
          ) : (
            <ul className="space-y-3">
              {request.plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  canSelectPlan={canSelectPlan}
                  busy={selectPlan.isPending}
                  onSelect={() => selectPlan.mutate(plan.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  canSelectPlan,
  busy,
  onSelect,
}: {
  plan: FulfillmentPlanEntry;
  canSelectPlan: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();

  if (plan.planType === 'NO_SAFE_PLAN') {
    return (
      <li className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2">
          <Badge tone="red">{t('fulfillment.planType.NO_SAFE_PLAN')}</Badge>
        </div>
        <p className="mt-2 text-sm text-red-800">{plan.explanationJson?.reason}</p>
        {plan.explanationJson?.excludedBranchCount != null && (
          <p className="mt-1 text-xs text-red-600" dir="ltr">
            {t('fulfillment.excludedBranchCount', { count: plan.explanationJson.excludedBranchCount })}
          </p>
        )}
      </li>
    );
  }

  return (
    <li className={`rounded-lg border p-4 ${plan.selected ? 'border-blue-400 bg-blue-50/50' : 'border-gray-200 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0b2545] text-xs font-bold text-white">
            {plan.rank}
          </span>
          <Badge tone={PLAN_TYPE_TONES[plan.planType]}>{t(`fulfillment.planType.${plan.planType}`)}</Badge>
          {plan.completeCoverage && <Badge tone="green">{t('fulfillment.completeCoverage')}</Badge>}
          {plan.selected && <Badge tone="blue">{t('fulfillment.selected')}</Badge>}
          <span className="text-xs text-gray-500" dir="ltr">
            {Math.round(plan.totalScore)}/100
          </span>
        </div>
        {canSelectPlan && !plan.selected && (
          <Button type="button" variant="secondary" onClick={onSelect} disabled={busy}>
            {t('fulfillment.selectPlanBtn')}
          </Button>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {plan.branches.map((branch) => (
          <li key={branch.id} className="rounded-md border border-gray-100 bg-gray-50 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-gray-900">{pickName(locale, branch.branch)}</span>
                <span className="text-xs text-gray-400" dir="ltr">
                  {branch.branch.code}
                </span>
                {branch.distanceKm != null && (
                  <span className="text-xs text-gray-500" dir="ltr">
                    {branch.distanceKm.toFixed(1)} {t('locator.km')}
                  </span>
                )}
              </div>
              {branch.score != null && (
                <span className="text-xs text-gray-400" dir="ltr">
                  {Math.round(branch.score)}/100
                </span>
              )}
            </div>
            <ul className="mt-1.5 space-y-1">
              {branch.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge tone={AVAILABILITY_TONES[item.availabilityStatus]}>
                    {t(`fulfillment.availability.${item.availabilityStatus}`)}
                  </Badge>
                  <span className="text-gray-700">{item.drug.nameEn}</span>
                  {item.allocatedQuantity != null && (
                    <span className="text-gray-400" dir="ltr">
                      {item.allocatedQuantity}/{item.requestedQuantity ?? '—'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </li>
  );
}
