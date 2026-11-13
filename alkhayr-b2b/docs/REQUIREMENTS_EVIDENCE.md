# Requirements → evidence matrix (stages 00–17, accepted in stage 18)

Release candidate **1.0.0-rc.1** (image `alkhayr-b2b:1.0.0-rc.1`, see `RELEASE_NOTES.md`). Branch `ccr-b8f31a52-xk6wqg`.
A progress report or a test count is **not** evidence on its own. Every PASS below names a check that ran against
the code in this repository, and the environment it ran in.

## Environments

| Code | Meaning | What it can prove | What it cannot prove |
|---|---|---|---|
| **UNIT** | `npm run check`: typecheck, build and 618 unit/integration tests (in-process servers, temporary SQLite files) | Rules, invariants, error codes, races reproduced deterministically | Container, proxy or TLS behaviour |
| **PROC** | Real server/CLI processes in this container (real terminal via a pseudo-terminal, real signals) | Process lifecycle, operator commands, locks | Deployment packaging |
| **STACK** | Local production-like Docker stack: release image + Caddy 2.11.9 with its **LOCAL CA** + named volumes; Chromium and Node clients **verify TLS** against that local root | Packaging, hardening, proxy rules, HTTPS behaviour, backup/restore/upgrade procedures | Public DNS, a publicly trusted certificate, a real host or provider network |
| **HOSTED** | An authorized server, domain and off-server storage | Production technical acceptance | — **not available: every HOSTED check is NOT RUN** |

**Stage-18 acceptance runs:**
- `accept18`: clean install from the documented artifacts, 123 checks, STACK.
- `upgrade18`: upgrade from the stage-15 release, 36 checks, PROC + STACK.
- `load18`: bounded mixed load on the release image, STACK, no proxy in the path.
- Browser suites over HTTPS, STACK: merchant 87, administration 126, import 44, business 67, recovery 19,
  secure cookies 19.

Final counts and dates are in `FINAL_ACCEPTANCE_18.md` §4.

Status values: **PASS** · **FAIL** · **NOT RUN** · **DEFERRED** (deliberately out of scope or awaiting an owner decision).

---

## A. Product scope and rules (stages 00–01)

| # | Requirement | Implementation | Evidence | Env | Status | Remaining action / owner |
|---|---|---|---|---|---|---|
| A1 | Arabic RTL portal; ALKHAYR owns catalog, prices, inventory, merchants, orders; no external dependency | `src/web`, `src/server`; `docs/SPEC.md` §1 | Browser suites (lang/dir, no external calls except configured image URLs) | STACK | PASS | — |
| A2 | Out-of-scope features are not offered (payments, invoices, returns, e-mail/SMS…) | SPEC §2; UI copy "no e-mail/SMS is sent" | Admin journey checks the approval dialog text; no such routes exist (router 404 tests) | UNIT, STACK | PASS | — |
| A3 | Owner decisions D-009 (tax formula), categories (§5.8), stock-status threshold (§5.10) | `src/shared/categories.ts`, `src/shared/stock-status.ts`, `services/orders.ts` | `shared.test.ts`, `orders.test.ts`; `accept18` quote check matches an independent BigInt model (57 033 / 8 685 / 70 718 piastres) | UNIT, STACK | PASS | Tax treatment is a business configuration; the owner must confirm the legal rate before launch |
| A4 | Capacity is not promised without a real load test | SPEC §6; `KNOWN_LIMITATIONS.md` | `load18` reported as a local observation only | STACK | PASS (no claim made) | Measure on the real host |

## B. Database and integrity (stage 02 + later migrations)

| # | Requirement | Implementation | Evidence | Env | Status | Remaining action / owner |
|---|---|---|---|---|---|---|
| B1 | Versioned, checksummed, append-only migrations; never edited after release | `src/server/database/migrations.ts`, `migrations/0001–0008` | `database-migrations.test.ts`; `upgrade18`: checksums recorded by the stage-15 release equal the shipped files; `git diff 9097aac..HEAD -- migrations/` adds only 0008 | UNIT, PROC | PASS | — |
| B2 | No auto-init / no auto-migrate; app refuses missing or old schemas | `database/runtime.ts` | `accept18` (`DATABASE_MISSING` before `db:init`), `upgrade18` (`MIGRATIONS_PENDING` before `db:migrate`) | STACK | PASS | — |
| B3 | `on_hand ≥ reserved ≥ 0`; ledger, events and audit append-only | CHECK constraints + triggers (0001/0003/0008) | `database-schema.test.ts`; `load18`: 0 products violating the invariant after 360 orders, 151 transitions, an import and a backup | UNIT, STACK | PASS | — |
| B4 | One instance per database; a second one fails safely | `database/instance-lock.ts` | `upgrade18`: second container on the same volume → `INSTANCE_LOCKED`; stage 17: `db:migrate` while running → `INSTANCE_LOCKED` | STACK | PASS | — |
| B5 | Read-only consistency verifier (orders, events, allocations, ledger, imports) | `database/consistency.ts`, CLI `db:check` | `consistency.test.ts`; `db:check` clean after `accept18`, `upgrade18`, `load18` and the restore | UNIT, STACK | PASS | `db:check` needs the data volume mounted read-write (SQLite WAL shared memory) even though it writes nothing |

## C. Security primitives, authentication and sessions (stages 03–04, 16)

| # | Requirement | Implementation | Evidence | Env | Status | Remaining action / owner |
|---|---|---|---|---|---|---|
| C1 | First administrator only through the local CLI with mandatory TOTP; no default account | `cli/setup-admin.ts`, `services/admin-bootstrap.ts` | `setup-admin.test.ts`; `accept18`: setup in a real terminal, password not echoed, second "first admin" refused | UNIT, STACK | PASS | — |
| C2 | scrypt password hashing with a bounded queue; dummy work for unknown users | `auth/passwords.ts` | `passwords.test.ts`, `auth-security.test.ts` | UNIT | PASS | — |
| C3 | Login limits per source, per (source, username) and per username; generic errors | `auth/rate-limit.ts`, `services/authentication.ts` | `auth-security.test.ts`; stage 17: spoofed forwarding headers through Caddy stay ONE source | UNIT, STACK | PASS | — |
| C4 | **Stage 18:** a capacity refusal (503 or per-source concurrency) does not spend sign-in attempts | `RateLimiter.refund`, `login()` | New test fails without the fix (6th retry → 429) and passes with it; `load18` login burst: 70/70 sessions, 0 × 429 (before the fix 49/70, 525 × 429) | UNIT, STACK | PASS | Residual distributed DoS remains → DR-3 |
| C5 | `__Host-` session cookie (Secure, HttpOnly, SameSite=Strict, Path=/, no Domain); rotation; logout deletion | `auth/cookies.ts`, `auth/sessions.ts` | `cookies17` browser suite (19); `accept18` Set-Cookie attribute check | STACK | PASS (local CA) | Repeat on the real host (HOSTED NOT RUN) |
| C6 | CSRF tokens + exact Origin + Fetch-Metadata on every mutation | `auth/csrf.ts`, `http/request-guards.ts` | `auth-security.test.ts`; `accept18`: missing token 403, foreign Origin 403 | UNIT, STACK | PASS | — |
| C7 | Password change and operator resets revoke all sessions | `services/authentication.ts`, `services/account-recovery.ts` | `accept18` password-sessions + operator-recovery sections | STACK | PASS | — |
| C8 | Administrator recovery only by the operator CLI (reset password/MFA, revoke sessions), audited, server stopped | `cli/operator.ts` | `operator-terminal.test.ts`; `accept18`: reset-password and reset-mfa in a real terminal; the old authenticator is refused | PROC, STACK | PASS | — |
| C9 | No secrets in logs | `logger.ts` redaction; Caddy log filter | `logger.test.ts`; `accept18` scans the app logs for passwords, TOTP secrets, cookies and CSRF tokens | UNIT, STACK | PASS | — |

## D. Merchants (stage 05)

| # | Requirement | Implementation | Evidence | Env | Status | Remaining action / owner |
|---|---|---|---|---|---|---|
| D1 | Registration always answers 202 (no enumeration); pending accounts see no prices and cannot order | `services/authentication.ts`, `auth/authorization.ts` | `merchants.test.ts`; `accept18` registration section | UNIT, STACK | PASS | — |
| D2 | Approve / suspend / return to review with version checks and reasons; suspension revokes sessions; admins protected | `services/merchants.ts` | `merchants.test.ts`; `accept18` approval + suspension sections; admin journey (126) | UNIT, STACK | PASS | — |
| D3 | **Stage 18:** after a version conflict the admin UI never offers stale choices | `pages/admin/Merchants.tsx` | Admin journey check with a 1.5 s delayed reload: fails on 17.0.0-rc8, passes on 1.0.0-rc.1 | STACK | PASS | — |

## E. Products, catalog and inventory (stages 06–07)

| # | Requirement | Implementation | Evidence | Env | Status | Remaining action / owner |
|---|---|---|---|---|---|---|
| E1 | Products created inactive with zero stock; strict validation; no DELETE | `services/products.ts` | `products.test.ts`; `accept18` catalog-admin | UNIT, STACK | PASS | — |
| E2 | Catalog search (name, brand, exact barcode), category filter, detail; availability as a state only | `services/products.ts`, `shared/stock-status.ts` | `accept18` catalog-trader (no counts in the trader JSON) | STACK | PASS | Exact stock is inferable through quotes → DR-1 |
| E3 | Receipts / corrections / set-total with reason, expected version, idempotent key; never below reserved | `services/inventory.ts` | `inventory.test.ts`; `accept18`: retry applied once; set-total below reserved → 422 `INVENTORY_BELOW_RESERVED` | UNIT, STACK | PASS | — |

## F. Orders and fulfilment (stages 08–09, 11, 14)

| # | Requirement | Implementation | Evidence | Env | Status | Remaining action / owner |
|---|---|---|---|---|---|---|
| F1 | Exact integer money, server-side amounts only, BigInt tax | `services/orders.ts` | `orders.test.ts`; `accept18` independent model match; client totals/merchant ids → 400 | UNIT, STACK | PASS | — |
| F2 | Quote = same evaluation, writes nothing; reviewed terms bound to the order (`TERMS_CHANGED`) | `services/orders.ts` | `business.test.ts`; `accept18` terms-conflict | UNIT, STACK | PASS | — |
| F3 | Idempotent creation; lost-response retry returns the original; same key + other content → 409 | `services/orders.ts` | `orders.test.ts`; `accept18` order-create; `load18` 0 duplicate request keys | UNIT, STACK | PASS | — |
| F4 | Immutable snapshots (items, prices, buyer, settings) | Order snapshot columns | `accept18` snapshots section (product, price, settings and profile edited afterwards) | STACK | PASS | — |
| F5 | State machine; reserve on confirm, deduct on ship exactly once, release on cancel of this order only | `services/fulfillment.ts` | `fulfillment.test.ts` (concurrency races); `accept18` fulfilment + cancellation (reserved 10→6, other allocation intact) | UNIT, STACK | PASS | — |
| F6 | Merchant separation: foreign orders/summaries → 404; traders cannot reach admin routes | `auth/authorization.ts` | `security-review.test.ts` HTTP matrix; `accept18` separation section | UNIT, STACK | PASS | — |

## G. Browser experience (stages 10–12)

| # | Requirement | Implementation | Evidence | Env | Status | Remaining action / owner |
|---|---|---|---|---|---|---|
| G1 | Merchant flows in the browser, distinct loading/error/conflict states | `src/web/pages/*` | Merchant suite 87 checks over HTTPS | STACK | PASS (Chromium only) | Other browsers NOT RUN |
| G2 | Administration screens with re-authentication and idempotent retries | `src/web/pages/admin/*` | Administration suite 126 checks | STACK | PASS (Chromium only) | — |
| G3 | Accessibility | Design system | axe: 0 violations (stages 11–14, 21 states) | PROC | PASS (automated rules only) | Manual screen-reader review NOT RUN |

## H. Imports, settings, reports, exports, printing (stages 13–14)

| # | Requirement | Implementation | Evidence | Env | Status | Remaining action / owner |
|---|---|---|---|---|---|---|
| H1 | CSV preview writes nothing; commit all-or-nothing; durable idempotency; unknown columns refused | `import/csv.ts`, `services/imports.ts` | `csv.test.ts`, `imports.test.ts`, `imports-restart.test.ts`; `accept18`: a concurrent change makes the whole file fail (row 1 not applied), the unconsumed key is reused, the identical retry is replayed | UNIT, STACK | PASS | There is no "undo import": a correction is a new traceable import or adjustment |
| H2 | Settings with versions; future orders only | `services/settings.ts` | `business.test.ts`; `accept18` settings + snapshots | UNIT, STACK | PASS | — |
| H3 | Reports from the whole DB, demo/cancelled excluded from value, Africa/Cairo dates | `services/reports.ts` | `reports.test.ts`; `accept18` reports (inventory totals exact) | UNIT, STACK | PASS | — |
| H4 | Spreadsheet-safe exports (BOM, CRLF, `'` prefix), buyer contact only on request, `no-store` | `services/exports.ts`, `reports/csv-out.ts` | `business.test.ts`; `accept18`: a business name `=HYPERLINK(…)` is neutralised; contact data absent by default | UNIT, STACK | PASS | — |
| H5 | Printable order summary, not a tax invoice; own merchant or admin only | `pages/OrderSummaryPrint.tsx`, summary routes | Business suite (67); `accept18` summary checks | STACK | PASS | — |

## I. Backup, restore and recovery (stages 15–16)

| # | Requirement | Implementation | Evidence | Env | Status | Remaining action / owner |
|---|---|---|---|---|---|---|
| I1 | Encrypted, verified backups; never copy the live DB file | `backup/backup.ts` | `backup.test.ts`; `accept18` `backup:run`; `load18` online backup during traffic (3.9 s, verified) | UNIT, STACK | PASS | — |
| I2 | Restore into an isolated target; recovery mode; stale pre-restore operations refused (epoch) | `services/recovery-mode.ts`, `http/write-gate.ts` | `recovery-gate.test.ts`, `restore-drill.test.ts`; `accept18` restore section (503 → reopen → 409 `RECOVERY_EPOCH_STALE`; original DB hash unchanged) | UNIT, STACK | PASS | — |
| I3 | Key and APP_SECRET separate from backups; key not mounted in the web process | `deploy/compose.yaml` | `accept18`: `/run/secrets/backup_key` absent in `app` | STACK | PASS | Secret custody is an owner duty (DR-4) |
| I4 | Business reconciliation before reopening | `recovery:reopen` (reason + typed confirmation) | `accept18` (scripted only) | STACK | PASS (procedure) | Human reconciliation time unmeasured |

## J. Deployment and operations (stage 17)

| # | Requirement | Implementation | Evidence | Env | Status | Remaining action / owner |
|---|---|---|---|---|---|---|
| J1 | Multi-stage, pinned, non-root, distroless image; read-only rootfs; caps dropped; limits | `Dockerfile`, `deploy/compose.yaml` | `upgrade18`: uid 1000, read-only, `CapDrop [ALL]`, data 0700 / DB 0600; Trivy app image 0 critical / 0 high | STACK | PASS | — |
| J2 | HTTPS reverse proxy: exact host, strict SNI, HTTP→HTTPS, sanitized forwarding, safe logs, private upstream | `deploy/caddy/Caddyfile` | Stage 17 proxy checks; stage 18 re-run after the Caddyfile change (308, 421, 413, no panics) | STACK | PASS (local CA) | Public ACME issuance and renewal → HOSTED NOT RUN |
| J3 | Proxy vulnerability review | Caddyfile `request_body` removed (stage 18) | `FINAL_ACCEPTANCE_18.md` §3 | STACK | Mitigated; residual **open** → DR-6 | Owner decision; upgrade when a fixed Caddy ships |
| J4 | Scheduled backups with timezone, overlap lock, retries, status, retention | `ops/backup-job.ts`, `ops/schedule.ts` | `ops.test.ts` 7/7 | UNIT | PASS | — |
| J5 | Off-server copy with download + decrypt + consistency verification | `ops/s3.ts` | Against a LOCAL S3-compatible server (SeaweedFS, real SigV4), stage 17 | STACK | PASS (local) / **HOSTED NOT RUN** | Authorized destination (DR-4, B-2) |
| J6 | Monitoring hook separate from liveness; no restart loops | `ops:status`, `/healthz`, `/readyz` | `ops.test.ts`; `accept18` `ops:status` exit 3 (no off-server copy) | UNIT, STACK | PASS | Alert channel NOT RUN (no authorized recipient) |
| J7 | Clean install, upgrade from schema 7, rollback | `DEPLOYMENT_AR.md` §2–§7 | `accept18`, `upgrade18` | STACK | PASS | Repeat on the host |
| J8 | Graceful shutdown, restart and persistence | `main.ts` shutdown | `upgrade18`: SIGTERM → `shutdown_complete`, exit 0 in 187 ms; data intact after `down`/`up`. Stage 17: daemon restart | STACK | PASS | Real host reboot NOT RUN |

## K. Hosted / production (stage 17 → 18)

| # | Requirement | Status | Missing input |
|---|---|---|---|
| K1 | Public DNS + publicly trusted certificate + renewal | **NOT RUN** | Host, domain, DNS access, ACME e-mail (DR-5) |
| K2 | Secure cookies, proxy-only access and client addresses on the real host | **NOT RUN** | Same |
| K3 | Real persistent disk, non-root permissions, host reboot | **NOT RUN** | Same |
| K4 | Real off-server backup → download → verify; restore into an isolated host | **NOT RUN** | Destination + scoped credentials (DR-4) |
| K5 | Monitoring and an authorized alert-delivery test | **NOT RUN** | Recipient/channel and permission to send |
| K6 | Production-size data and real hardware capacity | **NOT RUN** | Host + real catalog |

## L. Business decisions

| # | Decision | Status |
|---|---|---|
| L1 | DR-1 stock inference | **Pending owner** |
| L2 | DR-2 RPO / RTO / backup times | **Pending owner** |
| L3 | DR-3 distributed sign-in DoS | **Pending owner** |
| L4 | DR-4 off-server storage and secret custody | **Pending owner input** |
| L5 | DR-5 host and domain | **Pending owner input** |
| L6 | DR-6 proxy residual vulnerabilities | **Pending owner** |
| L7 | Tax/shipping/minimum configuration is a business choice | Pending owner (configure before launch) |
