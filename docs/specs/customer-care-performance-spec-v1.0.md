# Customer Care Pilot — Performance & Targets — Module Specification v1.0

Source: blueprint §12.1 (Yeastar P570 Integration) + §12.2 (أهداف الموظف
والفريق), Sprint 7 "Customer Care Pilot" of §23. Module scope per §5 table:
**Customer Care = Ticketing + Yeastar performance + SLA** — ticketing and the
SLA engine already run (Sprints 3–4); this sprint adds the performance layer
so Customer Care can pilot end-to-end (§23.1 UAT → soft launch).

Open points are flagged as assumptions D1–D7.

## 1. Blueprint requirements (verbatim mapping)

| §    | Requirement                                                   | Delivered as                                                                    |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 12.1 | 16 call/SLA KPIs (Inbound…AVG Wait Time, Team SLA, Agent SLA) | `PerformanceMetricDef` catalog seeded verbatim; values stored per day per scope |
| 12.2 | SLA وTargets يومية/شهرية/سنوية لكل موظف أو فريق               | `PerformanceTarget` (USER/TEAM × metric × DAILY/MONTHLY/YEARLY)                 |
| 12.2 | يظهر Actual، Target، Achievement %، Trend، وحالة اللون        | `GET /performance/dashboard` computes all five per row                          |
| 21.1 | معيار التكامل (Idempotency، Logging، Health…)                 | Ingestion endpoint is idempotent upsert + audit-logged; connector slot per D1   |
| 23.1 | Pilot مع Customer Care في UAT ثم Soft Launch                  | UAT browser walkthrough of the full flow; ticket SLA metrics live from day one  |

## 2. Design decisions

### D1 — Connector later, ingestion now

The §23 sprint table places Integrations in **Later**; ADR-009 routes every
external system through the Integration Layer. So Sprint 7 ships the
integration-**ready** half: `POST /performance/metrics/ingest` accepting daily
KPI rows (batch, idempotent upsert on `date+scope+metric`, §21.1). The future
Yeastar connector becomes a client of this endpoint; until then the pilot can
feed daily exports through it without schema changes.

### D2 — Metrics as data (ADR-008)

The 16 KPIs are catalog rows, not code: key, bilingual labels, unit
(count/seconds/percent), aggregation across days (SUM for volumes,
AVG for averages/percentages), source (YEASTAR / TICKETING), and
`higherIsBetter` (false for Missed, Abandoned, AVG Handle/Hold/Wait — D6).
New KPIs later are inserts, not deployments.

### D3 — Ticket-derived SLA metrics computed live

`team_sla` / `agent_sla` come from the ticketing engine, not ingestion: % of
tickets resolved in the period whose `slaState` never reached BREACHED —
agent-level by `resolvedById`, team-level over the team's tickets. The pilot
therefore shows real SLA performance with zero external dependencies (§22:
integration outage never stops the core).

### D4 — Color state from settings

`performance.green_from_pct` (default 100) and `performance.amber_from_pct`
(default 80): achievement ≥ green → GREEN, ≥ amber → AMBER, else RED.
No target defined → GRAY (informational row).

### D5 — Trend

Trend compares the period's actual against the previous equivalent period
(yesterday / previous month / previous year): UP / DOWN / FLAT (±2%
tolerance). Direction is raw (value direction), color logic uses D6.

### D6 — Achievement for lower-is-better metrics

Achievement % = actual/target when higher is better, target/actual otherwise
(capped at 999%). Flagged because §12.2 defines the display, not the formula.

### D7 — Agent identity mapping

Ingest rows address agents by platform user email (Yeastar extensions will be
mapped to emails in the connector). Unknown emails are rejected per row and
reported back — no silent drops.

## 3. Data model

```
PerformanceMetricDef   key (unique), nameAr/nameEn, unit, aggregation SUM|AVG,
                       source YEASTAR|TICKETING, higherIsBetter, sortOrder

MetricValue            metricDate (day), scopeType USER|TEAM, scopeId,
                       metricKey → def, value (Decimal)
                       @@unique(metricDate, scopeType, scopeId, metricKey)

PerformanceTarget      scopeType USER|TEAM, scopeId, metricKey → def,
                       period DAILY|MONTHLY|YEARLY, targetValue, active
                       @@unique(scopeType, scopeId, metricKey, period)
```

USER-scope rows carry agent KPIs; TEAM-scope rows carry queue-level KPIs the
PBX only reports per queue/team. Dashboards aggregate USER rows for teams
when no TEAM row exists.

## 4. API surface

```
POST /performance/metrics/ingest        performance.ingest   batch upsert (D1/D7)
GET  /performance/metrics               performance.view     raw daily values (scoped, filters)
GET  /performance/dashboard             performance.view     period=DAILY|MONTHLY|YEARLY, date, teamId?, metricKey?
                                                             → rows {scope, metric, actual, target,
                                                                achievementPct, trend, color}
GET  /performance/targets               performance.view
POST /performance/targets               performance.manage   upsert (scope × metric × period)
DELETE /performance/targets/:id         performance.manage
GET  /performance/metric-defs           performance.view
```

Scoping mirrors the rest of the platform (§19.1): MY_RECORDS = own rows,
MY_TEAM = team members + own team rows, DEPARTMENT, ALL_DATA. All mutations
audit-logged; target changes also produce timeline events
(`entityType: 'performance_target'`).

## 5. Permissions

| Key                  | Meaning                                | Defaults                                                                     |
| -------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `performance.view`   | Dashboards & raw metrics (scope-based) | Agent MY_RECORDS, Supervisor/Leader MY_TEAM, Manager DEPARTMENT, admin ALL   |
| `performance.manage` | Set/delete targets                     | Team Manager DEPARTMENT, admins ALL                                          |
| `performance.ingest` | Push metric values                     | INTEGRATION_SUPPORT ALL_DATA (its first grant — matches its purpose), admins |

## 6. Settings (seeded, category `performance`)

| Key                        | Type   | Default | Basis |
| -------------------------- | ------ | ------- | ----- |
| performance.green_from_pct | NUMBER | 100     | D4    |
| performance.amber_from_pct | NUMBER | 80      | D4    |
| performance.trend_flat_pct | NUMBER | 2       | D5    |

## 7. Out of scope (explicitly)

- The physical Yeastar P570 connector (poller/webhook) — Later per §23; lands
  behind the D1 endpoint.
- §12.3 (Skill Matrix, capacity, shift coverage) — part of Team Management &
  Performance but not named in the Customer Care module scope; scheduled with
  the Later phases unless you pull it forward.
- §13 Reporting Engine dashboards beyond this module's view.
