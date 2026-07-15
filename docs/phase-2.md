# Phase 2 — Ticketing Module (Acceptance Record)

Implements the approved **Ticketing Module Specification v1.0**
(`docs/specs/ticketing-module-spec-v1.0.md`) — blueprint §9, ADR-003..007, Sprints 2–4
of §23. Assumptions A1–A8 were approved before implementation.

| Area | Delivered |
| --- | --- |
| Prerequisites | Number generator (settings-driven formats, atomic per-year sequences), Attachment Engine foundation (local-disk driver, settings-driven size/MIME limits, audited access), minimal Branch Directory with supervisor-change timeline |
| Config catalogs (ADR-008) | Types, categories, urgencies, statuses + transition matrix, update types, resolution categories, SLA policies — all data, seeded verbatim from §9.1–9.3/§9.6, editable via `ticket.manage_config` APIs |
| Ticketing core | Create (both types) with generated numbers + SLA due dates; scope-filtered lists (ADR-010); 8 views (§9.10); §9.11 filters + search; audited CSV export (§19.3) |
| Responsibility (ADR-004) | Single responsible + complete ownership history (§9.5); assign/take with auto-transition; multi-team redirect (§9.9) |
| Updates (§9.6) | Immutable typed updates; WAITING pauses the SLA clock; first-response stamping |
| Branch flow (ADR-006/007) | Supervisor snapshot at creation, auto-direction to the Branch Supervisor routable team, no-supervisor fallback route + data-quality audit (§9.8, §26) |
| Resolution (ADR-005) | §9.7 mandatory record enforced (422 without it); resolve→Completed freezes SLA MET/BREACHED; close/reopen with separate ADR-004 stamps; reopen restarts SLA |
| Status engine | Seeded transition matrix with per-transition permission guards; New Response automation (A3) |
| SLA engine (US-8) | Warning at threshold, breach with auto-escalation + notifications, first-response breach notify-once, pause/resume — periodic in-process sweeper (`SLA_SWEEP_INTERVAL_SECONDS`); BullMQ worker documented as the volume upgrade path |
| Routable teams | §9.9 list seeded as teams under a system Routing department |
| Frontend | Ticket queue (views/filters/SLA chips), create form with read-only supervisor card, detail page (actions per permissions+status, updates/resolution/timeline tabs, ownership history), Branches admin screen, bilingual |

Out of scope (unchanged from spec §1): customer master, case grouping, Yeastar/order
integrations, OCR, CSAT, email-to-ticket, full Branch Center, WhatsApp.

## Definition of Done (§24)

- [x] Business rules documented — spec v1.0 + this record
- [x] UI + API implemented — see above
- [x] Migrations — `ticketing_prerequisites`, `ticketing_catalogs`, `tickets_core`, `ticket_sla_relation`
- [x] Permissions applied — 13 new ticket.* + branch.* + attachment.manage keys; per-transition guards
- [x] Audit + timeline on every action (verified by tests)
- [x] Notifications verified — assignment, direction, escalation, SLA warning/breach, resolution, close/reopen, new response
- [x] Validation & error states — catalog validation, 400/403/404/409/422 semantics, loading/empty/error UI
- [x] Tests — 8 e2e suites, 63 tests green (Phase 1 suites: auth 9, permissions 5, org 12, foundations 11; Phase 2: prerequisites 10, config 3, tickets 10, SLA 4) — two Phase-1 assertions updated for the spec §8 agent grants
- [x] UAT walkthrough — Chromium 21/21: branch → branch ticket with snapshot → take → update → resolve → close → timeline → views
- [x] Docs updated; rollback = revert per-step commits + migrations

## Notes

- SLA timers deviation from spec §2 (BullMQ): implemented as an in-process sweeper with
  identical acceptance criteria; recorded here per §1.1. Upgrade slot preserved.
- Next per blueprint §23: Sprint 5 Knowledge Base Basic.
