/**
 * Phase 6 §22/§27 — shared Prisma include shape for a FulfillmentPlan
 * with enough branch/drug detail (names, not just ids) for the review
 * UI to render without extra lookups. Kept in one place so the
 * generator, selection service, and request-service reads never drift.
 */
export const PLAN_WITH_DETAIL_INCLUDE = {
  branches: {
    include: {
      branch: {
        select: { id: true, code: true, nameEn: true, nameAr: true, latitude: true, longitude: true },
      },
      items: {
        include: {
          drug: { select: { id: true, materialNo: true, nameEn: true, nameAr: true } },
        },
      },
    },
  },
} as const;
