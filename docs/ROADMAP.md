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

---

## Phase 2: Milaserv 360 rebrand + Orders/Retention/Products/Timeline

The second pass added the Order/Retention/Product-catalog layer, the
Milaserv 360 rebrand, and an automatic cross-entity Timeline, per a new
40-section spec. As with Phase 1, everything described as "implemented" is
real and tested — full dependent-dropdown Call Customer workflow, manual
and lead-driven Order creation with item search, the Pending/Holded/On the
Way/Picked Up/Completed/Closed status machine with live-aggregated (not
cached) KPIs, My Orders/Team Orders with monthly-vs-filtered toggles,
Retention Customers with due-date follow-up filtering, the full Product &
Item Catalog (lookups, partner-specific pricing/availability, Excel
import/export, price history), granular `orders.*`/`retention.*`/
`products.*` permissions layered on top of Phase 1's role-based guard, and
an append-only `TimelineEvent` feed wired into Orders/Products/Retention/
Call Outcomes.

A few items were explicitly scoped down this pass. None require schema
changes — the tables/fields already exist — so they remain additive
follow-up work:

- **Realtime channel**: the spec asks for WebSocket/SSE "with polling as
  fallback." This pass ships the polling side only (`useAutoRefresh`,
  configurable interval, pause-while-editing, filters/pagination/search
  preserved across refetch) on every page listed in spec §19. A true
  push channel (a Nest gateway + client subscription model) is real new
  infrastructure and is left as follow-up; the functional requirement
  ("stay current without manual reload") is met by polling today.
- **Product test matrix (spec §39)**: the spec lists 20 specific test
  cases. `products-availability.e2e-spec.ts` covers a representative
  subset (~8) of the correctness-critical paths — duplicate item
  code/barcode rejection, active/archived exclusion from agent search,
  cash/insurance filtering, partner-specific availability exclusion. The
  remaining cases in §39 are mechanical repetition of the same
  create/search/assert pattern against different field combinations
  (e.g. Arabic-name search, dosage-form filter, import-driven updates)
  and are a good first task for anyone picking this up.
- **Price history UI and "future-ready" fields**: `ProductPriceHistory`
  records every price change and is queryable, but has no dedicated
  timeline/chart view yet. Likewise VAT rate, insurance code, and
  controlled-item flag exist as nullable fields on `Product` for future
  regulatory needs, but neither has UI beyond a plain input.

### How to pick this up

- Realtime: start from `useAutoRefresh` (`apps/web/lib/use-auto-refresh.ts`)
  for the contract each page already expects, then add a Nest
  `@WebSocketGateway` that emits the same shape of event the polling
  refetch currently pulls, with the hook falling back to polling if the
  socket drops.
- Remaining product tests: follow the pattern in
  `apps/api/test/products-availability.e2e-spec.ts`.
