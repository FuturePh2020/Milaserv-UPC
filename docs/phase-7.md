# Phase 7 — Online Operation & Ordering (Acceptance Record)

Implements `docs/specs/online-operation-spec-v1.0.md` (blueprint §13 + its
integration-resilience note, §21.1 standard). Assumptions F1–F6 applied as
flagged. The Online Operation module scope from §5 — **Ticketing + Order
Issues/Requests integration readiness** — is operational.

| Area                       | Delivered                                                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily Orders (§13)         | `OnlineOrder` records via idempotent ingest (per-row rejections, audit-logged) — the Ordering connector's landing slot (F4); filtered list + daily count                                                 |
| Issues & Requests (§13)    | `ONLINE_ISSUE` / `ONLINE_REQUEST` as universal-ticket types (F1): assignment, open/closed, mandatory resolution, SLA policies, timeline, audit — all inherited; `relatedOrderNo` links tickets to orders |
| Sources (§13)              | `OrderSource` on orders + `RequestSource` on tickets (nullable new column), editable catalogs seeded APP/WEBSITE/CALL_CENTER (F3); Request Source select appears in the ticket form for online types     |
| Stats (§13, F6)            | Day counters: daily orders, open/closed/handled per type, avg handling minutes, SLA achievement % — live from the engines                                                                                |
| Retry Queue (§13 note, F5) | `IntegrationOperation` queue: callers enqueue and continue (§22); sweeper retries with exponential backoff; exhausted ops go DEAD with in-app admin alerts; §21.1 timeout/error-mapping in the executor  |
| Integration Monitor (§13)  | Health per integration (status counts, last success/failure/error), operations list with filters, manual re-queue — admin screen behind `integration.monitor`                                            |
| Outbound sync slot         | Resolving an online ticket enqueues `ordering.issue_resolved`, gated by `integrations.ordering.outbound_enabled` (default off); the future connector fills `integrations.ordering.endpoint` (ADR-009)    |
| Permissions                | `online.view` / `online.ingest` / `integration.monitor` (45 keys); INTEGRATION_SUPPORT + Business Excellence get monitor access                                                                          |
| Frontend                   | `/online` (stats cards, orders table with source filter/search, shortcuts to issue tickets); `/admin/integrations` monitor with health cards + retry; sidebar items; bilingual                           |

Out of scope (per spec §6): the physical Ordering System connector, order
lines/content, DBS availability, Reporting Engine dashboards, inbound webhook
signature scheme.

## Definition of Done (§24)

- [x] Business rules documented — spec + this record
- [x] UI + API implemented; migration `online_operation`; 3 permissions, 2 ticket types + categories + auto-generated SLA policies, 2 source catalogs, 4 integration settings
- [x] Permissions/audit/timeline on every mutation; rejected ingest rows always reported
- [x] Tests — online/integrations suite 10 e2e tests; full regression 118/118 green
- [x] UAT walkthrough — Chromium 12/12: manager sees daily orders + stats, creates an Order Issue with Request Source through the universal ticket form; resolution enqueues the outbound op; Monitor shows it Retrying with "endpoint not configured", manual Retry re-queues; stats show 1 handled issue at 100% SLA
- [x] Docs updated; rollback = revert commits + `online_operation` migration

Remaining blueprint scope (§23 "Later", no fixed order): United Pharmacy
Center DIC (§15), Branch Center (§16), OCR (§17), physical integrations
(§21), AI features.
