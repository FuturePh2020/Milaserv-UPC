# Phase 4 — Break Tracker & Team Live View (Acceptance Record)

Implements `docs/specs/break-tracker-spec-v1.0.md` (blueprint §11, Sprint 6 of
§23). Assumptions C1–C6 applied as flagged.

| Area                   | Delivered                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sessions (§11.1)       | Start/End Session; Active/Idle/Break time accounting; every WORK/BREAK/IDLE period recorded with start & end; one ACTIVE session per user enforced by a partial unique index; abandoned sessions auto-end (endReason AUTO)                                                     |
| Idle detection (§11.2) | Browser activity heartbeat (input **timestamps only** — no keystrokes/screen content, per the privacy clause); WORK → IDLE backdated to the start of inactivity; employee notification + timeline event; server-side sweeper catches silent clients; clamped client timestamps |
| Break rules (§11.3)    | Daily allowance from settings (TEAM/DEPARTMENT overrides); remaining balance shown, overage rendered red; overage notification to employee + team leader/manager gated by `break.notify_on_overage`; per-team concurrency cap (409 at the limit)                               |
| Live Team View (§11.3) | AVAILABLE / ON_BREAK / IDLE / OFFLINE derived per member, data-scope filtered (`break.viewTeam`), 15 s polling (WebSocket = §20 upgrade slot); session history endpoint with periods                                                                                           |
| Permissions            | `break.track` (all staff, self) / `break.viewTeam` (supervisor MY_TEAM, leader MY_TEAM, manager DEPARTMENT, admin ALL) — 36 keys total                                                                                                                                         |
| Configuration          | 7 `break.*` settings seeded (idle threshold 300 s per §11.2, allowance, concurrency cap, offline threshold, overage toggle, heartbeat interval, auto-end hours)                                                                                                                |
| Frontend               | `/breaks` page: session controls, live-ticking Active/Idle/Break timers, allowance card (red on overage), Live Team View table; sidebar item behind `break.track`; bilingual                                                                                                   |

Out of scope (per spec §12): shift scheduling, payroll export, break-type
catalogs, native desktop idle agent, WebSocket push.

## Definition of Done (§24)

- [x] Business rules documented — spec + this record
- [x] UI + API implemented; migration `break_tracker`; 2 new permissions, 7 settings
- [x] Permissions/audit/timeline on every mutation (`work_session` timeline entity); notifications (idle, overage) verified by tests
- [x] Tests — Breaks suite 12 e2e tests; full regression 84/84 green
- [x] UAT walkthrough — Chromium 10/10: agent tracks own session without Live Team View; supervisor starts session/break, live view shows both members' states, overage in red, break & session end cleanly
- [x] Docs updated; rollback = revert commits + `break_tracker` migration

Note (environment): the refreshed toolchain in this environment (eslint 9.39 /
typescript-eslint 8.64) flags NestJS DI value imports and comment-separated
case labels; `consistent-type-imports` is scoped off for `apps/api/src` since
`emitDecoratorMetadata` requires value imports for injected classes.

Next per blueprint §23: Sprint 7 — Customer Care pilot rollout (§12 partner
directory + §9 customer-care flows end-to-end).
