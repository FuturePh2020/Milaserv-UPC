# Architecture

## Monorepo layout

```
apps/api        NestJS backend (REST API, Prisma, BullMQ, Swagger at /api/docs)
apps/web        Next.js 14 App Router frontend (Tailwind + @lcrm/ui)
packages/shared Zod schemas + shared enums used by both apps
packages/ui     Shared Tailwind/shadcn-style component primitives
infrastructure  Docker Compose, Nginx reverse proxy config
docs            This file + ROADMAP.md
```

pnpm workspaces tie it together (`pnpm-workspace.yaml`). `packages/shared` and
`packages/ui` are built to `dist/` (`tsc`) and consumed as regular npm
packages — this matters for `apps/api`'s `node dist/src/main.js` runtime and
for the Docker images, which cannot execute the raw `.ts` source directly.

## Request flow

Browser → Next.js server (same-origin `/api/*` rewrite, or Nginx `/api/`
location in Docker) → NestJS API → PostgreSQL / Redis.

Cookies (`access_token`, `refresh_token`, `csrf_token`) are always set by the
API and consumed by the browser at the *same origin* the browser talks to
(the Next.js server or Nginx), because the frontend never calls the API
cross-origin — it always goes through the rewrite/proxy. This keeps
`SameSite=Lax` cookies simple and avoids CORS entirely for browser traffic.

## Auth

- Argon2 password hashing.
- Short-lived JWT access token (default 15 min) in an httpOnly cookie.
- Opaque, rotating refresh token (default 7 days), stored **hashed** in
  `RefreshToken`, httpOnly cookie. Every refresh revokes the old token and
  issues a new one (rotation), so a stolen refresh token has a short window.
- `csrf_token` cookie is intentionally **not** httpOnly — the frontend reads
  it and echoes it in the `x-csrf-token` header on every mutating request
  (double-submit pattern), enforced by `CsrfGuard`.
- `JwtAuthGuard` + `RolesGuard` are registered globally; endpoints opt out
  with `@Public()`, and role-restrict with `@Roles(UserRole.ADMIN)` etc.
  Frontend route guards are UX only — every authorization decision is
  re-checked server-side.

## Atomic lead distribution (spec section 7)

`DistributionService.generateLead()`:

1. Cheap checks outside any transaction: active session, `AVAILABLE` status,
   not on break, has permission for the requested/any task.
2. A Redis lock per-agent (`RedisLockService`) prevents redundant concurrent
   transactions from the same agent double-clicking — it is a **performance**
   guard, not the correctness guarantee.
3. Inside `prisma.$transaction`, a raw SQL query:
   `SELECT l.id ... FROM "Lead" l ... WHERE ... ORDER BY <strategy> LIMIT 1
   FOR UPDATE OF l SKIP LOCKED` — Postgres row-level locking is the actual
   correctness guarantee. Two concurrent transactions can never select the
   same row; the second one skips it and gets the next eligible row (or
   none). Proven in `test/distribution-concurrency.e2e-spec.ts`, which fires
   20 concurrent `generateLead()` calls at a pool of 8 leads and asserts
   zero double-assignment.
4. The same transaction writes `Lead.assignmentStatus/workflowStatus`,
   `LeadAssignment`, `LeadStatusHistory`, `AuditLog`, and the agent's
   `currentAgentStatus` atomically — if anything fails, everything rolls
   back (no partial assignment).

## Break concurrency rule (spec section 13)

`BreaksService.start()` computes, for the agent's current `TaskAssignment`,
how many *other* agents on the same task are currently on the same
`BreakType` (`BreakTypeTaskLimit` overrides the type's default
`maxConcurrentAgents`, default 3). If the limit is reached, the request is
rejected unless an `overrideReason` is supplied (admin-only path), in which
case the break is recorded with `wasOverridden: true` and a `BREAK_OVERRIDE`
audit entry. Proven in `test/breaks-concurrency.e2e-spec.ts`.

## Lead statuses are deliberately four separate concepts (spec section 9)

- `Lead.workflowStatus` — where the lead is in the pipeline.
- `CallRecord.status` — what the VoIP provider reported for one specific call.
- `LeadAssignment.businessOutcome` — the agent's read on the interaction.
- `LeadAssignment.taskCompletionStatus` — whether *this assignment* is done.

They're on different tables/rows on purpose so a lead's history and a call's
outcome never overwrite each other.

## VoIP adapter layer (spec section 19)

`VoipProviderAdapter` (interface) → `MockVoipProvider` (only implementation
shipped). A real provider is a new class implementing the same interface,
swapped in `VoipModule`; nothing else in the codebase changes. Credentials in
`VoipSettings` are AES-256-GCM encrypted at rest (`VOIP_ENCRYPTION_KEY`) and
the settings API only ever returns `*Configured: boolean`, never the secret.
Webhooks are deduplicated via a unique constraint on
`VoipWebhookEvent.externalEventId` (a duplicate delivery is caught, logged,
and returns success rather than reprocessing).

## Background jobs (BullMQ)

- `lead-import` queue: parses/validates synchronously on upload (so the
  admin gets an immediate success/fail count), but the actual DB duplicate
  check + insert happens in a job (`LeadImportProcessor`) so large files
  don't block the request.
- `system-sweep` queue: two repeatable jobs every 60s —
  `reservation-sweep` (auto-returns leads whose reservation timeout elapsed
  untouched) and `inactivity-sweep` (moves idle `AVAILABLE` agents to
  Standby/Break per `InactivitySettings`).

## Realtime channel (Phase 2 spec section 19)

`RealtimeGateway` (`@nestjs/websockets` + socket.io) at `/api/socket.io`,
authenticated by parsing the same `access_token` cookie the REST API uses
and verifying it with the same `JWT_ACCESS_SECRET` — no separate login flow.
Sockets that fail verification are disconnected immediately.

Clients `subscribe`/`unsubscribe` to named channels (rooms); the gateway
exposes a single `emitRefresh(channel)` method other services call. Rather
than scatter gateway calls across every Orders/Retention/Products/Call
Outcomes mutation, `TimelineService.record()` is the one choke point: since
virtually every meaningful mutation already writes a `TimelineEvent`, that
write also emits to the entity-scoped room (`timeline:<entityType>:<id>`,
for an open detail view's `TimelineFeed`) and to whichever list-page
channels `TIMELINE_ENTITY_CHANNELS` maps that entity type to (e.g.
`Order` → `my-orders` + `team-orders`). This guarantees no mutation site is
missed rather than relying on remembering to wire each one individually.

On the frontend, `useRealtimeChannel` (one shared socket per tab) drives
`useAutoRefresh`: while the socket is connected, pushes trigger an
immediate refetch and the polling `setInterval` doesn't run at all; if the
socket disconnects, polling resumes as the fallback — satisfying the
spec's "WebSocket/SSE preferred, polling fallback" requirement literally,
not just functionally.

CORS for the socket adapter is read from `ConfigService` inside a custom
`ConfigurableSocketIoAdapter.createIOServer()` at `app.listen()` time,
rather than in the `@WebSocketGateway()` decorator's static options —
decorator arguments evaluate at module-import time, before dotenv has
necessarily populated `process.env`, so reading `CORS_ORIGIN` there would
be import-order-dependent.

In production behind Nginx, the browser connects same-origin and Nginx's
existing `/api/` location (now with `Upgrade`/`Connection` headers added)
proxies the handshake straight to the API container — no new port to
expose. Local dev without Nginx needs `NEXT_PUBLIC_API_ORIGIN` set to the
API's own origin (see `apps/web/.env.example`), since a browser WebSocket
handshake can't ride through Next's HTTP-only `rewrites()` the way a plain
`fetch()` call can.

## What's deliberately out of scope for this pass

See `ROADMAP.md`.
