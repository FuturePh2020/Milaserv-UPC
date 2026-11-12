# ALKHAYR — Project State

| Field | Value |
|---|---|
| Last updated | 2026-11-12 |
| Current stage | **03 — Security primitives & administrator bootstrap: COMPLETE** |
| Next stage | **04 — Authentication, sessions, CSRF & abuse limits** (awaiting owner prompt) |
| Execution mode | BUILD_NEW (D-001) |
| Project root | `alkhayr-b2b/` (self-contained) in repo `FuturePh2020/Milaserv-UPC`, branch `ccr-b8f31a52-xk6wqg` |
| Runtime | Node.js 24.22.1 (`/opt/node24/bin` here; Node 22 refused) — SQLite 3.53.4 via `node:sqlite` |
| Application | HTTP server + React shell + SQLite schema/CLI + password/TOTP/encryption primitives + local admin enrollment. **No web login, sessions, catalog, orders or business endpoints yet.** |

## Stage log

| Stage | Status | Evidence |
|---|---|---|
| 00 | ✅ Done (spec + capability probe) | Commit `2427e9e` |
| 01 | ✅ Done (foundation) | Commit `f6ac774` |
| 02 | ✅ Done (database) | Commit `fa2fe06` |
| 03 | ✅ Done (security primitives + setup-admin) | 245/245 tests, typecheck clean, 9 mutation checks, real-PTY tests, 8× repeated clean-copy runs — below |
| 04–18 | ⏳ Not started | — |

## Stage 03 — documentation clarifications (requested)
- `DATABASE.md` §3 now lists all **13 tables** (12 blueprint + `product_categories`) and explains the addition.
- **Absent barcode = `NULL`.** `''` is invalid; uniqueness applies to non-NULL barcodes as exact text (DATABASE.md §3, D-036).
- **Audit retention: at least 365 days**; younger rows undeletable (trigger), older rows only by an explicit operator purge, never automatic — stated identically in DATABASE.md §4, SECURITY.md §10 and D-014 (now Accepted).

## Stage 03 — what was built
| Area | Files | Summary |
|---|---|---|
| Passwords | `src/server/auth/passwords.ts` | scrypt N=2^17,r=8,p=1, 16-byte salt, maxmem 128·N·r·p+1 MiB; `$scrypt$v=1$…` format; strict parser with parameter allow-list; constant-time compare; limiter 2 concurrent / 32 queued, immediate busy error; `verifyDummy()` at the real work factor; policy 12/15–128 graphemes and ≤ 512 bytes, NFC, no trim/lowercase/truncation |
| TOTP | `src/server/auth/totp.ts` | RFC 4226/6238, 20-byte secret, base32, 6 digits with leading zeros, 30 s, ±1 window, returns accepted step, optional last-step exclusion, `otpauth://` URI |
| Encryption | `src/server/auth/encryption.ts` | HKDF-SHA256 purpose keys from APP_SECRET; AES-256-GCM `v1.` envelope, random nonce, AAD per user; explicit MALFORMED / UNSUPPORTED_VERSION / TRUNCATED / AUTH_FAILED |
| Key check | `src/server/auth/mfa-key-check.ts`, `database/runtime.ts`, `main.ts` | Startup refuses `MFA_KEY_MISMATCH` / `APP_SECRET_REQUIRED`; never resets; `no_administrator` warning when none exists |
| Bootstrap | `src/server/services/admin-bootstrap.ts`, `src/server/cli/setup-admin.ts`, `src/server/cli/prompt.ts`, `src/server/cli/index.ts` | `setup-admin`: TTY-only, no args, instance lock, current schema required, refuses existing admin / taken username (no promotion); hidden password ×2; hash + TOTP proof + encryption before one atomic write of user + approved profile + `admin.bootstrap` audit; enrollment step stored as `last_otp_step` |
| Shared validation | `src/shared/schemas.ts` | Username NFKC/trim/lowercase + pattern; merchant profile (phone normalization incl. Arabic-Indic digits, Egyptian mobile or E.164, optional email) |
| Build | `scripts/build.mjs` | Writes `dist/server/package.json` `{"type":"module"}` (D-048) |
| Schema | — | **No migration needed**; 0001 untouched; runtime authorizer unchanged |

## Commands (from `alkhayr-b2b/`, Node 24 on PATH)
| Purpose | Command |
|---|---|
| Install / build | `npm ci` · `npm run build` |
| **Initialization sequence** | `npm run db:init` → `npm run setup-admin` (interactive, server stopped) → `npm start` |
| Status / upgrade | `npm run db:status` · `npm run db:migrate -- --confirm-backup` |
| Checks | `npm run typecheck` · `npm test` · `npm run check` |
| Release form | `node dist/server/cli.js db:init|setup-admin|db:status|db:migrate` · `node dist/server/main.js` |

## Checks run in stage 03 (2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ 0 errors |
| Full suite (stages 01–03) | `npm test` | ✅ **245 tests, 51 suites, 245 pass, 0 fail** |
| — new files: passwords / totp / encryption / schemas / setup-admin (in-process) / setup-admin (real CLI + PTY) | `node --test <file>` | ✅ 15 / 14 / 8 / 3 / 17 / 7 |
| Mutation checks (9) | verify→true; no param allow-list; unbounded queue; trim in policy; window ±2; ignore replay boundary; drop AAD; no in-txn re-check; no transaction | ✅ each caught (1–3 failing tests); restored → 54/54 |
| Flakiness check | clean copy, full suite ×6 before fix, then ×8 after fix; PTY file ×12 | Before: 2 of 7 runs failed (Ctrl-C race, D-047). After: ✅ 8/8 full runs, 12/12 PTY runs |
| Clean reproduction | tracked files only → `npm ci` → typecheck + tests | ✅ 245/245 |
| Dependency audit | `npm audit` | ✅ 0 findings (57 packages); no dependency or lockfile change |
| Interactive terminal | real bundled CLI in a **pseudo-terminal** (Python `pty`) | ✅ hidden password not in transcript; Ctrl-C cancels; TOTP proof; non-TTY and argv passwords refused. **A human at a physical terminal was NOT tested**; terminal emulators other than the PTY (TERM=dumb) not tested |
| Browser QA | — | NOT RUN (no UI change) |
| Docker / hosted HTTPS | — | ⛔ NOT RUN (stage 17) |

### Acceptance → evidence
| Required test | Where |
|---|---|
| Correct/incorrect verification; unique salts | passwords: hash format, wrong case/space/char, two hashes differ |
| Length/byte limits without truncation | passwords: 11/12, 14/15, 128/129 chars, 1220-byte 20-grapheme input, over-limit verify false |
| Malformed hashes; inflated/unsupported params | passwords: 11 malformed forms; ln=30, r=64, p=16, weaker params rejected in < 50 ms, no work |
| Bounded concurrency / overload | passwords: 8 calls → 5 done, 3 busy, max 2 active; waves; shared with verify |
| Dummy verification at the supported factor | passwords: dummy hash uses reference params, ≥ 50 ms real work, through the limiter |
| TOTP vectors, leading zeros, boundaries | totp: RFC 4226 ×10, RFC 6238 ×6 (081804, 050471, 005924), last/first ms of periods, ±1/±2 |
| Accepted step / replay boundary | totp: step returned; ≤ last step refused; next step accepted |
| Encryption round trip, nonces, wrong key, tamper, truncation, version | encryption: all, plus AAD (other user, other purpose key) |
| Missing/placeholder production secrets | config tests (stage 01) + encryption `MissingSecretError` + setup-admin `APP_SECRET_REQUIRED` + server `APP_SECRET_REQUIRED` |
| Bootstrap on uninitialized/foreign DB | setup-admin: missing, empty, foreign, pending-migration databases (nothing created/migrated) |
| Duplicate admin / username conflicts | setup-admin: second bootstrap refused before prompts; trader username in 3 casings refused, not promoted |
| Cancellation / invalid proof | setup-admin: cancel at password and TOTP; 3 wrong/stale codes; profile exhaustion; real PTY Ctrl-C |
| Atomic rollback | setup-admin: failing profile insert, failing audit insert (last statement), in-txn re-check |
| No plaintext in DB, logs, API/static | setup-admin: DB/WAL bytes; operator output; real server logs and `/`, `/healthz`, `/readyz`, auth paths |
| Runtime DB / file protections continue | full stage-02 suites unchanged and passing; authorizer untouched |

## Limitations (known)
- Web login/sessions/CSRF/rate limiting are stage 04; `POST /api/v1/auth/login` is a 404 (tested), nothing claims otherwise.
- The hashing limiter is per process (fine for the single-instance design); stage 04 adds request rate limits in front of it.
- `setup-admin` enrolls only the first administrator; adding further admins, password reset and MFA reset are later stages (15). If APP_SECRET is lost, admin MFA cannot be decrypted until that procedure exists.
- APP_SECRET rotation is not implemented (envelope is versioned for it).
- Interactive behaviour was verified through a pseudo-terminal, not by a person at a real terminal.
- Passwords are not checked against breached-password lists (no external calls by design).
- JavaScript strings holding passwords cannot be wiped from memory; they are short-lived and never logged.

## Open questions
None.

## Remaining blockers
None for stage 04.

## Files changed in stage 03 (all under `alkhayr-b2b/`)
New: `src/server/auth/{passwords,totp,encryption,mfa-key-check}.ts`, `src/server/services/admin-bootstrap.ts`,
`src/server/cli/{prompt,setup-admin}.ts`, `src/shared/schemas.ts`,
`tests/unit/{passwords,totp,encryption,schemas,setup-admin}.test.ts`, `tests/integration/setup-admin.test.ts`, `tests/helpers/pty_driver.py`.
Modified: `src/server/cli/index.ts` (async, `setup-admin`), `src/server/database/runtime.ts` (MFA key check, admin count),
`src/server/main.ts` (`no_administrator` warning), `scripts/build.mjs` (`dist/server/package.json`), `package.json` (`setup-admin` script),
`tests/integration/server.test.ts` (warning-free start), `.env.example` (APP_SECRET note), `README.md`,
`docs/{DATABASE,SECURITY,THREAT_MODEL,DECISIONS,MIGRATION,PROJECT_STATE}.md`.
Not touched: migrations (0001 unchanged), dependencies/lockfile, web UI, repository-root files.

## How to continue
Next: send **PROMPT 04**. Stage 04 must reuse: `PasswordHasher` (one shared instance; map
`PasswordHasherBusyError`; `verifyDummy` for unknown users), `verifyTotp` + atomic
`UPDATE … last_otp_step < ?` (affected rows = 1), `deriveKey(appSecret,'csrf'|'rate_limit'|'ip'|'cursor')`,
`usernameSchema`, `writeTransaction` (never hash inside it), `isForeignKeyError`, and keep the runtime authorizer.

---

## Stage 02 record (retained)

### What was built
- **Schema** `migrations/0001_initial.sql`: 13 STRICT tables (the 12 contract tables + `product_categories`, D-029), 19 indexes, 20 triggers; `application_id` 'AKHR'. Details in `DATABASE.md`.
- **Initial configuration only**: the 4 approved categories; settings shipping 0, tax 0 bps, shipping untaxed, minimum 0, low-stock threshold 10 (available stock); company fields NULL. **No users, passwords, sessions, products, orders, balances or audit rows** (tested).
- **Connection** `src/server/database/connection.ts`: WAL, FK on (verified), busy timeout 5 s, `synchronous=FULL`, `trusted_schema=OFF`, `secure_delete`, defensive mode, no extensions; dir 0700 / files 0600; network-filesystem refusal; stale-WAL refusal; `mustExist` never creates.
- **Runtime authorizer** (D-033): the server's connection cannot run DDL, ATTACH, VACUUM/VACUUM INTO, SAVEPOINT or PRAGMA writes.
- **Single instance** `instance-lock.ts` (D-032).
- **Migrations** `migrations.ts`: ordered/contiguous, SHA-256 checksums, `user_version` + history guard, newer-schema/foreign-file/no-history refusal, each migration atomic with its history row, FK check before commit, transaction control/ATTACH denied inside migration files.
- **Transactions** `transaction.ts`: `writeTransaction` (BEGIN IMMEDIATE), `readTransaction`; nested → refused; async callback → rolled back; busy → `DatabaseBusyError`.
- **Readiness** `readiness.ts` + `GET /readyz` (200 `{status:"ready"}` / 503 `NOT_READY`); `/healthz` stays liveness-only.
- **Startup** `runtime.ts` + `main.ts`: lock → open existing DB → schema must be current → `quick_check` → reopen with authorizer; refuses with exact operator commands; closes DB and releases lock on shutdown; `umask 077`.
- **Operator CLI** `src/server/cli/index.ts` → `dist/server/cli.js`: `db:status`, `db:init`, `db:migrate --confirm-backup`, `help`. npm scripts `db:status|db:init|db:migrate`.
- **Docs**: `DATABASE.md` (rewritten to match implementation), new `MIGRATION.md` (operator procedures + Arabic summary), `API_CONTRACT.md` (`/readyz`, `NOT_READY`), `DECISIONS.md` (D-004 accepted; D-029…D-039), `SECURITY.md`, `THREAT_MODEL.md` (T25 done; T27–T29), `migrations/README.md`, `README.md`.

### Schema and constraint decisions (summary)
| Requirement | Implementation |
|---|---|
| Integer money/quantities, no fractions | STRICT INTEGER columns reject REAL values (tested on prices, stock, reserved, pack, minimum, cartons, tax, shipping, ledger deltas). Text numerals are converted by SQLite (D-037) → services must validate types. |
| `on_hand ≥ reserved ≥ 0`; available computed | Named CHECKs `products_reserved_nonnegative`, `products_reserved_le_on_hand`; no available column (tested) |
| Positive price/pack/minimum | CHECK ranges (price 1…1e8, pack 1…1e4, minimum 1…1e5) |
| Case-insensitive usernames | lowercase-only CHECK + `UNIQUE COLLATE NOCASE` |
| Nonempty barcodes unique, TEXT, leading zeros | Absent barcode = `NULL`; `''` invalid; TEXT; unique among non-NULL values (partial unique index) (D-036) |
| One product line per order | PK `(order_id, product_id)` |
| `UNIQUE(merchant_id, request_key)` + digest | named constraint `orders_request_key_scoped`; `request_digest` SHA-256 hex CHECK |
| Token hashes only | `sessions.token_hash` = 64 lowercase hex CHECK; `csrf_secret` dropped (D-030) |
| Versions for optimistic concurrency | `version` on products, merchants, orders, settings; triggers require +1 per UPDATE |
| Snapshots independent of master data | buyer/item/price/tax/shipping columns copied into orders/order_items; trigger blocks changing them (tested after product/merchant/settings edits) |
| No cascading deletes of history | all history FKs `ON DELETE RESTRICT`; append-only triggers; only `sessions` cascades with an unreferenced user |

### Checks run in stage 02 (2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ 0 errors |
| Build | `npm run build` | ✅ server + CLI + web bundles |
| Full test suite (stage 01 + 02) | `npm test` | ✅ **180 tests, 31 suites, 180 pass, 0 fail** |
| — database unit: connection / migrations / schema / transactions | `node --test tests/unit/database-*.test.ts` | ✅ 10 / 13 / 31 / 7 |
| — database integration (real built CLI + server) | `node --test tests/integration/database.test.ts` | ✅ 12 |
| Mutation checks | no-op runtime authorizer; skipped checksum check; COMMIT instead of ROLLBACK | ✅ caught by 1 / 1 / 3 failing tests; restored → 61/61 DB unit tests pass |
| Clean reproduction | tracked files only (no `.git`, no `node_modules`) → `npm ci` → `npm run check` | ✅ 180/180 |
| Experimental-warning check | `db:init` + server start | ✅ no `ExperimentalWarning` from `node:sqlite` |
| Manual smoke | server w/o DB; init; init again; migrate (no-op); status; server; `/readyz`; 2nd server; migrate while running; status while running | ✅ exit 1 `DATABASE_MISSING` / 0 / 1 refused / 0 / 0 / ready / `INSTANCE_LOCKED` / `INSTANCE_LOCKED` / 0 |
| `VACUUM` / `VACUUM INTO` on runtime connection | probe + regression test | ✅ denied; no copy written |
| Dependency audit | `npm audit` | ✅ 0 findings (57 packages); lockfile unchanged in stage 02 |
| Browser QA | — | NOT RUN in stage 02 (no UI change; stage-01 check stands) |
| Docker / hosted HTTPS / real host disk | — | ⛔ **NOT RUN** (stage 17; no hosting here) |
| Supplied real database migration | — | N/A — none supplied (BUILD_NEW); nothing destructive was run on any real data |

### Acceptance → evidence
| Required test | Where |
|---|---|
| Fresh database and repeat migrations | migrations: fresh init, no-op re-run (data kept), racing connection; integration: clean release init, init-again refused, migrate no-op |
| Migration checksum tampering | migrations: content + rename; integration: server and `db:status` refuse |
| Unsupported newer schema | migrations: history + user_version; integration: server refuses `SCHEMA_TOO_NEW` |
| Failed migration rollback | migrations: SQL error mid-file, self-COMMIT, ATTACH, deferred FK violation → still v1, nothing recorded |
| Foreign-key violations | schema: merchant→user, product→category, order→merchant/product, delete referenced user/product |
| Invalid roles and statuses | schema: role, admin w/o TOTP, merchant status, order state/insert state, ledger kind |
| Duplicate usernames with different casing | schema: `trader.one` vs `TRADER.ONE` / `Trader.One` |
| Duplicate nonempty barcodes, leading zeros | schema: `000123` kept as text, duplicate rejected, `00123` distinct, NULLs allowed, `''` rejected |
| Invalid/fractional quantities and money | schema: products, orders, items, settings, ledger |
| Reserved exceeding total | schema: insert and update paths |
| Scoped duplicate request keys | schema: same merchant rejected, other merchant allowed |
| Transaction rollback across tables | transactions: users+merchants+products+orders+items+events+ledger+audit rolled back; constraint failure in a later statement; nested; async; busy |
| Database unavailability / readiness failure | connection: moved/replaced/closed DB; integration: `/readyz` 503 (no leaks) and recovery, `/healthz` still 200 |
| DB, WAL/SHM, source, secret files not fetchable | server exposure suite (+WAL/SHM/lock/backup paths) and integration test with a canary verified inside the real DB files |
| Initialization from a clean release without Git | integration: temp root with only `dist/` + `migrations/` (asserted no `.git`/`node_modules`) |
| HTTP never alters schema; startup never resets | integration: schema fingerprint and data unchanged across two server runs with requests; connection: authorizer denies 16 statements |

### Limitations (known, intentional at this stage)
- No business services or repositories yet; test fixtures write rows directly. Business rules (pricing, idempotency, stock movements) arrive in stages 05–09; the database enforces invariants as a second line.
- SQLite STRICT converts numeric text/booleans to INTEGER (D-037): API-level type validation is required in later stages.
- Order `subtotal = Σ line totals` and ledger-vs-balance consistency are cross-row rules enforced by services (stages 07–09), not by the schema.
- `db:migrate --confirm-backup` relies on the operator's affirmation until stage 15 adds encrypted backup/restore.
- Network-filesystem detection uses Linux `statfs` magic numbers; on other OSes it is skipped. FUSE/virtiofs mounts (e.g. Docker Desktop bind mounts) are not refused — documented as unsupported in MIGRATION.md.
- Audit-log purge command and rate-limit cleanup are not implemented yet (stages 04/15).
- Readiness checks file identity and schema version, not full integrity (`quick_check` runs at startup and in `db:status`).
- `npm run dev` requires `npm run db:init` once; the server never auto-initializes (D-031).

### Files changed in stage 02 (all under `alkhayr-b2b/`)
New: `.gitattributes`, `migrations/0001_initial.sql`, `docs/MIGRATION.md`,
`src/server/database/{connection,errors,instance-lock,migrations,readiness,runtime,transaction}.ts`, `src/server/cli/index.ts`,
`tests/helpers/database.ts`, `tests/unit/database-{connection,migrations,schema,transaction}.test.ts`, `tests/integration/database.test.ts`.
Modified: `package.json` (db scripts), `scripts/build.mjs` (CLI bundle), `src/server/{main,app,config}.ts`, `src/server/routes/health.ts`,
`src/shared/errors.ts` (`NOT_READY`), `tests/helpers/server.ts` (release-shaped temp app with real DB + canary), `tests/integration/server.test.ts`
(isolated app for multi-server tests; DB/WAL/SHM exposure paths), `migrations/README.md`, `README.md`,
`docs/{DATABASE,API_CONTRACT,DECISIONS,SECURITY,THREAT_MODEL,PROJECT_STATE}.md`.
Not touched: dependencies/lockfile, web UI, repository-root files, other branches.

## Stage 01 record (retained)
Foundation: pinned toolchain (react 19.3.1, zod 4.6.7, typescript 7.0.2, esbuild 0.28.2), Node HTTP server
with typed config, Host/request-target validation, Arabic error envelope, security headers, timeouts,
graceful shutdown, allow-listed checksum-verified static assets, Arabic RTL React shell. Verified: 98/98
tests, mutation check, clean `npm ci` reproduction, Chromium mobile/desktop check, `npm audit` 0. Owner
decisions D-009, D-016, D-020, D-021 recorded.

## Stage 00 record (retained)
Blueprint preserved as `docs/BLUEPRINT_AR.md`; BUILD_NEW (repo held only an unrelated `Dashboard.jsx`);
logo stored unchanged; capability probe: Node 24.22.1, `node:sqlite` WAL persistence, scrypt, AES-GCM,
`node --test`, npm, git push all working; Docker daemon startable but Docker Hub pulls 429 (image builds
unverified); **no end-user hosting in this environment**.
