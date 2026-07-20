# Roadmap / Deferred Scope

This pass built a genuinely production-quality **foundation**: the full
domain model, auth/RBAC, partner/task/lead-category management, Excel
import with validation and dedupe, the atomic lead distribution engine
(the hardest correctness requirement in the spec), agent sessions and the
status state machine, break management with the concurrency rule, a
provider-agnostic VoIP layer with a working mock provider, audit logging,
background jobs, the core admin and agent dashboards, three of the highest-
value reports, and Docker Compose deployment. Everything listed as
"implemented" in the PR is real, wired end-to-end, and covered by a test
that actually exercises it (unit, Supertest/e2e, or Playwright).

The original spec describes a much larger system (26 sections). The
following are **not** implemented yet. None of them require schema changes —
the Prisma schema already has the tables/fields they need — so they're
additive follow-up work, not architectural rework.

## Frontend pages not yet built

- **Inbound Performance** / **Outbound Performance** dashboards (spec
  §22–23). The backend already computes the underlying metrics
  (`VoipService.metrics()`, `CallRecord` queries) — this is a frontend page
  + a couple of extra grouped-by-agent/hour queries.
- **Task Allocation** page (§18): manual/automatic agent-to-task assignment
  UI. `TaskAssignment` table and `TaskAssignment` model already exist and are
  used by the break concurrency rule; the automatic-assignment algorithm and
  its UI are not built.
- Additional admin settings screens: password-complexity policy display,
  VoIP status-mapping table editor UI (the API exists:
  `POST /voip/status-mappings`), agent-level partner/category restriction
  editors (the API exists on `UsersController`).
- Remaining reports: session/attendance report, activity report, break
  report, call reports beyond the raw `CallRecord` listing endpoint.
- Multi-language / RTL support.

## Backend refinements

- **Distribution strategies**: `FIFO`, `OLDEST_FIRST`, `HIGHEST_PRIORITY`,
  `PARTNER_PRIORITY`, and `TASK_PRIORITY` are fully implemented with real
  `ORDER BY` clauses. `ROUND_ROBIN`, `WEIGHTED`, `REGION_MATCH`, and
  `CATEGORY_MATCH` currently fall back to FIFO ordering — see the comment in
  `DistributionService`. These strategies are naturally about balancing
  *across agents*, which fits a push-based distribution model better than
  the pull-based "Generate Lead" button the spec describes; a real
  implementation needs a design decision (push queue vs. pull-time
  weighting) before it's built.
- **Inactivity detection**: the backend sweep job (`system-sweep` /
  `inactivity-sweep`) and settings exist and run. The frontend heartbeat is
  wired (agent dashboard pings `/sessions/heartbeat` every 30s), but the
  richer browser-activity tracking described in spec §14 (mouse/keyboard/
  visibility/tab-focus listeners, warning toast before auto-standby) is not
  built — only the heartbeat itself.
- Real VoIP provider adapters beyond `MockVoipProvider`.
- Session correction / break correction admin UI (the API endpoints exist:
  `PUT /sessions/admin/:id/correct`, `PUT /breaks/admin/:id/correct`).

## How to pick this up

Everything above is a new module/page/query on top of the existing schema
and service layer — grep the relevant `*.service.ts` for a TODO-shaped gap,
or start from the Prisma model that already has the needed fields.
