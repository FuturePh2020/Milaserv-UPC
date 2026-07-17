# Phase 5 — Customer Care Pilot: Performance & Targets (Acceptance Record)

Implements `docs/specs/customer-care-performance-spec-v1.0.md` (blueprint
§12.1/§12.2, Sprint 7 of §23). Assumptions D1–D7 applied as flagged. With
this sprint the Customer Care module scope from §5 — **Ticketing + Yeastar
performance + SLA** — is operational end-to-end for the §23.1 pilot.

| Area                  | Delivered                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KPI catalog (§12.1)   | All 16 Yeastar KPIs seeded verbatim as data (unit, SUM/AVG aggregation, source, higher-is-better flag) — new KPIs are inserts, not deployments (ADR-008)                                                              |
| Ingestion (D1, §21.1) | `POST /performance/metrics/ingest`: batch, idempotent upsert per (day × user/team × metric), per-row rejection reasons, audit-logged; the future Yeastar connector is a client of this endpoint                       |
| Ticket SLA (D3)       | `agent_sla` / `team_sla` computed live from tickets resolved in the period without SLA breach — pilot shows real SLA performance with zero external dependencies (§22)                                                |
| Targets (§12.2)       | Per employee or team × metric × DAILY/MONTHLY/YEARLY; upsert semantics; audit + timeline on every change                                                                                                              |
| Dashboard (§12.2)     | Actual (period-aggregated), Target, Achievement % (inverted for lower-is-better, D6), Trend vs previous equivalent period (D5), color state from settings thresholds (D4); scope-filtered (§19.1)                     |
| Permissions           | `performance.view` (agent self / supervisor+leader team / manager department), `performance.manage` (manager+), `performance.ingest` (INTEGRATION_SUPPORT — its first grant) — 39 keys total                          |
| Configuration         | `performance.green_from_pct` (100), `performance.amber_from_pct` (80), `performance.trend_flat_pct` (2)                                                                                                               |
| Frontend              | `/performance`: period/date/metric filters, dashboard table with color-coded achievement badges and trend arrows; targets management dialog (create/list/delete) behind `performance.manage`; sidebar item; bilingual |

Out of scope (per spec §7): the physical Yeastar connector (Later per §23,
lands behind the ingestion endpoint), §12.3 skills/capacity, §13 reporting
engine dashboards.

## Definition of Done (§24)

- [x] Business rules documented — spec + this record
- [x] UI + API implemented; migration `customer_care_performance`; 3 new permissions, 3 settings, 16-row KPI catalog
- [x] Permissions/audit/timeline on every mutation; per-row ingest rejections reported, never silent
- [x] Tests — performance suite 12 e2e tests; full regression 96/96 green
- [x] UAT walkthrough — Chromium 10/10: manager creates targets in the UI, dashboard shows 137.5% GREEN with DOWN trend and a lower-is-better 50% RED case; agent sees own metrics without target management
- [x] Docs updated; rollback = revert commits + `customer_care_performance` migration

Next per blueprint §23: the sprint plan's **Later** phase (CRM §14, Online
Operation §13, Telesales, DIC §15, Integrations §21, AI) — awaiting your
prioritization, since the blueprint fixes no order inside "Later".
