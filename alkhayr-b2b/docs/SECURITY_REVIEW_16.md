# Stage 16 — Adversarial security review, consistency enforcement and release gates

| Field | Value |
|---|---|
| Scope | `alkhayr-b2b/`: HTTP API, browser SPA, operator CLI, backup/restore, database schema/migrations |
| Base commit reviewed | `9097aac` (stage 15), branch `ccr-b8f31a52-xk6wqg`; fixes in the stage-16 commit |
| Date | 2026-11-13 (UTC) |
| Reviewer | The same AI coding agent that built the system (not an independent party) |
| Environment | Linux container, 4 vCPU, 16 GB RAM, x86_64, Node 24.22.1, SQLite 3.53.4, Chromium (Playwright), running as **root** |

> This is an internal, code-reading-plus-testing review by the implementer. It is **not** an independent
> penetration test, an audit or a certification. A test count is not a security score. Nothing here claims the
> system is "unhackable" or "100% secure".

## 1. Method and tools actually used
- **Code reading.** Every route handler (42 routes), the authorization helpers, all operator commands, the backup
  module, the migrations 0001–0008 and the web client's API, storage and identity layers.
- **New tests:**
  - in-process HTTP tests (permission matrix, ownership, ambiguity probes, recovery gate, throttling);
  - unit tests (consistency verifier, admission, epoch handling);
  - real-process tests (built server and CLI);
  - real PTY tests through `npm run cli`;
  - Chromium journeys via Playwright with axe-core automated rules;
  - focused mutation runs.
- **Bounded synthetic workloads** with recorded timings (§6).
- **Not used:**
  - no external scanner, fuzzer, DAST or SAST tool;
  - no independent tester;
  - no TLS or reverse-proxy deployment;
  - `npm audit` (registry advisories for declared dependencies only; not a security assessment).
- **No external guidance documents were consulted in this stage.** Rules come from the project's own
  specification and threat model.

## 2. Inventory (what was in scope)

| Area | Facts |
|---|---|
| **HTTP routes** | 42 (src/server/routes). Public: `/healthz`, `/readyz`, `GET /auth/csrf`, login/register (pre-login CSRF). Session: `/auth/me`, `/auth/password`, own profile. Approved trader: catalog, filters, orders, quote, summaries. Admin: lists/reads/reports, import preview. Recent admin (15 min): every admin mutation, exports, pre-filled templates, import commit. |
| **Operator commands** | `db:status|init|migrate|check`, `setup-admin`, `admin:create`, `account:reset-password|reset-mfa|revoke-sessions`, `backup:keygen|create|inspect|verify|restore|prune|status`, `recovery:status|reopen`. They run as the service user with read/write on DATA_DIR and BACKUP_DIR; account and restore commands take the instance lock. |
| **Secrets** | `APP_SECRET` → HKDF keys for TOTP encryption, CSRF, rate-limit keying, IP HMAC, cursor and import-preview signing. Session tokens are stored only as SHA-256. Passwords use scrypt. The backup key is a separate 32-byte key file (or a hidden prompt), never in `.env`. |
| **Browser persistence** | localStorage only: the cart draft plus one pending order submission per user+merchant (7-day TTL, now with its recovery epoch). No tokens, passwords or CSRF values. |
| **External network** | Only product images (`img-src 'self' https: data:`). No analytics, CDNs or other outbound calls from the server. |
| **DB vs service rules** | DATABASE §12–§18 "Enforcement boundary". New in 0008: ledger continuity and the unlinked-row block. Still service-only: event→state atomicity and reserve→allocation pairing (detected by the verifier). |
| **Background work** | One 60 s sweeper (expired rate-limit rows and sessions, bounded batches). Staging cleanup runs at server start and before backup/verify/restore. No other timers. |
| **Backup/restore trust boundaries** | Holders of the backup key can read and create backups. Holders of shell access on the host can do anything. Restored data is trusted only after a full verification. Sessions are dropped, recovery mode is entered, and the recovery epoch separates pre-restore browser state. |

## 3. Findings

| ID | Severity | Class | Finding | Status |
|---|---|---|---|---|
| F-01 | **High** | Confirmed exploit | **Username lockout.** 5 failed attempts from ANY source blocked the username everywhere for 15 min: an unauthenticated attacker could keep any account (including the only administrator) out indefinitely. | **Fixed:** per-(source, username) 5/15 min; account-wide 30/15 min (needs ≥ 6 sources); per-source admission (≤ 2 credential jobs). Tests: victim from source B signs in while A is blocked; unknown vs existing users identical; IPv6 /64 grouping; spoofed X-Forwarded-For stays one source; restart persistence; bounded rows/memory. |
| F-02 | **High** | Design gap (confirmed by drill) | **Post-restore silent re-execution.** After restoring an older backup, a browser still holding an order (or an admin tab holding an adjustment/import/transition) prepared before the restore and missing from the restored data would execute it as a NEW write on retry. Writes were also accepted immediately after restore. | **Fixed:** recovery mode (migration 0008) until the audited `recovery:reopen`; exact recovery-epoch match for new writes across all families; stored submissions keep their epoch. An identical replay of an operation present in the data still returns its committed result. Tests: in-process families, real-process drill (order + adjustment + import after backup → refused), Chromium journey. |
| F-03 | Medium | Defense-in-depth weakness | **Stage-09 consistency gaps were neither detected nor guarded:** an event written without its state change, an orphan reserve/ledger row, broken event chains or allocation/ledger drift had no detector and no write guard; backup verification checked only aggregate stock invariants. | **Fixed (detection + fail-closed):** read-only verifier (16 checks) in db:check, backup verify/restore, startup integrity hold and per-order/per-product write guards (409 `CONSISTENCY_HOLD`). The 0008 trigger blocks further movements of a product with an unlinked ledger row. **Remaining:** event→state and reserve→allocation reverse pairing cannot be enforced by SQLite triggers; raw SQL can still create them (proved by tests); they are detected and fail closed. |
| F-04 | Medium | Defense-in-depth weakness | **Plaintext staging cleanup was age-based** (> 1 h, recursive delete). A long backup/verify could have its live staging deleted by another run; a staging-named directory's contents were trusted. | **Fixed:** per-job OS lock inside each staging directory; cleanup only of unlocked, owned, managed directories with expected regular files, one file at a time; startup cleanup; `backup:status` separates abandoned plaintext from active jobs. |
| F-05 | Medium | Design gap | **Restoring a pre-0008 backup then migrating** would have reopened writes silently. | **Fixed:** the 0008 seed enters recovery mode when the newest audit row is `backup.restored` (tested). |
| F-06 | Low | Confirmed (minor) | **`POST /auth/password` parsed and validated the body before authentication and CSRF** (anonymous requests got 400 instead of 401). No data exposure; inconsistent guard order. | **Fixed** (found by the permission matrix). |
| F-07 | Low | Confirmed (robustness) | **Full disk during backup** escaped as a raw ENOSPC exception. Cleanup was already correct. | **Fixed:** `DISK_FULL`/`WRITE_FAILED` mapping; measured on a 400 KB tmpfs (nothing left behind). |
| F-08 | **Business limitation** | Confirmed, measured | **Stock inference.** Traders never receive quantities, but repeated quotes reveal exact available stock by bisection: **17 quote requests** recovered 7 431 cartons (limit 60 quotes / 10 min). | **Not changed** (D-162): order acceptance/reservation rules unchanged. **Requires business acceptance** (blocker B-1). |
| F-09 | Low | Residual (operator UX) | **Early typing.** Text typed while no hidden prompt is active is echoed by the terminal (kernel). Measured: typing right after the "Password rules" line was NOT echoed, because the hidden prompt activates in the same instant. Typing during other echoing phases (e.g. while hashing) still would be. | Documented; no timing heuristic added. |
| F-12 | Low | Confirmed (UX, found in Chromium) | **A refused stale submission was invisible when the cart was empty:** the checkout discarded the pending order and showed only "cart empty", so the trader was not told that NO order was created. | **Fixed:** the refusal notice («لم يُنشأ الطلب» + reason) stays visible above the empty state (stage-16 browser journey). |
| F-10 | Info | Verified | **Lost-APP_SECRET path.** Only `--accept-new-app-secret` (offline CLI) enters it; a foreign database is refused (`DB_FOREIGN`) even with acceptance; startup is refused until EVERY administrator is re-enrolled with a proven code (1-of-2 still refused); cancel and wrong proof leave it fail-closed; no promotion; recovery mode stays until reopened. | No change needed beyond tests. |
| F-11 | Info | Verified | Ownership (another merchant's order and summary = same 404 as a missing one); CSRF on every mutation; recent-auth boundary on every admin mutation; duplicate JSON keys and `__proto__` rejected; strict money/quantity parsing; stored script-like text returned as JSON data under nosniff/CSP; product images with no referrer. | Tests added. |

**Backup cryptography review (no change).**
- AES-256-GCM with a per-backup HKDF-SHA256 key (32-byte random salt, info bound to the backup id) and a random
  12-byte nonce. Keys are unique per backup, so nonce reuse across backups cannot occur.
- The header is authenticated as AAD and strictly bounded; no KDF parameters are stored.
- **Trust-model limitation:** anyone holding the symmetric backup key can create a valid backup. No checksum
  changes that; provenance independent of the key holder is not claimed.

## 4. Residual risks
- **Distributed denial of service:**
  - ≥ 6 independent sources (IPv4 addresses or IPv6 /64s) can still block one username for ≤ 15 min;
  - many sources can saturate the scrypt queue (503 + Retry-After);
  - users behind one NAT share per-source limits.
- **Stock inference** by bisection (F-08).
- **Reverse-pairing gap** (F-03) is detectable, not preventable, at the SQLite level.
- **Plaintext:**
  - while a backup/verify/restore runs, a plaintext copy exists in the 0700 staging directory;
  - a crash leaves it until the next cleanup;
  - deleted data may persist physically on SSD/journaled filesystems (no secure erase claimed).
- **Privileged operator.** An operator with shell access, or anyone with the backup key and write access to the
  backups, is fully trusted.
- **External images.** Image hosts see viewers' IP addresses and user agents.
- **Reopening after a restore** cannot reconstruct missing business facts; reconciliation is external.

## 5. NOT RUN (explicitly)
- Permission-denied / read-only filesystem behaviour: the container runs as root (permission bits are bypassed).
  The code maps `EACCES`/`EPERM`/`EROFS`, but it was not exercised.
- Production TLS, reverse proxy, HSTS, real `TRUST_PROXY` topology and `__Host-` cookies over HTTPS (stage 17).
- Distributed (multi-source) DoS at scale; a real capacity test on production hardware.
- Screen readers; browsers other than Chromium; spreadsheet applications.
- Independent penetration test; external SAST/DAST/fuzzing tools.
- Cron scheduling, off-server backup copies, restore on Windows, restore/RTO on real-size data.

## 6. Performance and resource observations (synthetic, this container; not capacity claims)

| Workload | Result |
|---|---|
| scrypt verify, reference params (ln=17, r=8, p=1) | median 361–405 ms; RSS ≈ 115 MiB after hashing |
| Dataset: 2 000 products, 20 000 orders × 3 lines, 5 000 fulfilled | DB ≈ 125 MB (incl. WAL) |
| Full consistency verification | ≈ 0.76 s (2 000 orders: ≈ 50 ms) |
| Orders report (month) / products report | 38 ms / 175 ms |
| Export of 20 000 orders | refused in 35 ms with `EXPORT_TOO_LARGE` (cap 10 000 rows; never truncated) |
| Admin product search / orders page | 4 ms / 4 ms |
| backup:create (snapshot + verify + encrypt + re-verify) | 3.1 s, 61 MB encrypted |
| backup:verify | 1.5 s |
| Backup to a full disk (400 KB tmpfs) | `DISK_FULL`, no partial file, no staging left |
| Restore + verify + server ready (tiny dataset drill) | ≈ 0.3 s |
| Process peak RSS during the workload | ≈ 530 MiB (seeding included) |

## 7. Release-blocker register

| ID | Blocker | Severity | Owner | Required action |
|---|---|---|---|---|
| B-1 | Stock inference by bisection (F-08) | Business | Business owner | **Open.** Accept in writing, OR commission a reviewed change (OWNER_DECISIONS_18 DR-1) |
| B-2 | Off-server backup copies not automated or verified | High (operational) | Owner (destination) + operator | **Stage 17:** automated and verified end-to-end against a LOCAL S3-compatible test server; still **OPEN** until an authorized real destination is configured and a download-verified copy is observed |
| B-3 | Production TLS / proxy / cookie checks NOT RUN | High (deployment) | Owner (host/DNS) + operator | **Stage 17:** all checks PASS on the local production-like stack with Caddy's LOCAL CA; still **OPEN** for public DNS/ACME on an authorized host |
| B-4 | RTO/RPO are provisional targets (24 h / 2 h), not approved or measured on real data | Medium | Business owner + operator | **Open.** Stage-17 measured drill (synthetic 20 000 orders) in RELEASE_DECISIONS_17 DR-2; owner choice requested |
| B-5 | Distributed login DoS residual | Medium | Business owner + operator | **Open (not accepted on the owner's behalf).** Stage 18: capacity refusals no longer spend attempts (70/70 sessions in a 70-login burst, previously 49/70); distributed-source residual remains; options in OWNER_DECISIONS_18 DR-3 |
| B-6 | Caddy 2.11.9 (newest official) carries HIGH advisories; GO-2026-6859 was reachable via `request_body` | Medium | Owner (acceptance) + operator | **Stage 18:** reachable path removed (D-173) and re-tested; residual unreachable-by-configuration advisories **open** pending OWNER_DECISIONS_18 DR-6 and an official fixed build |

**No confirmed critical or high technical vulnerability remains unaddressed** in the reviewed code. B-1 needs an
explicit business decision, and B-2/B-3 belong to deployment (stage 17).

## 8. Deployment checks deferred to stage 17 (prepared, NOT RUN)
1. HTTPS-only origin; HSTS present; `__Host-` cookies with `Secure`; no plain-HTTP listener reachable.
2. `TRUST_PROXY` set to exactly the proxy address; direct access to the app port blocked; X-Forwarded-For
   from other peers ignored (test from outside).
3. The proxy enforces body/header limits at least as strict as the app; timeouts are configured; no response
   caching of `/api/*`.
4. `/readyz` and `/healthz` are not used as an information source (only `status`/`writes`).
5. Monitoring of: `consistency_failed`, `recovery_mode`, `write_refused`, `rate_limited`, `capacity_exceeded`,
   `abandoned_staging_removed`, `backup:status` exit code 3.
6. File ownership and permissions of DATA_DIR/BACKUP_DIR/key file under a NON-root service user (the
   permission tests above).
7. A timed restore drill on a production-size copy; an off-host backup copy verified with keys taken from the
   off-host store.

## 9. Mutation evidence
21 mutants (`mut16.py`). First run: 20 caught, 1 survived. N17 (disk-full mapping) had only a manual tmpfs measurement; after adding a unit-level mapping test it is caught. N04 (no per-source admission) first HUNG the harness behind the paused hasher; the test now fails fast in 3 s. Final: **21/21 caught**. Layers: N01–N04 throttling tests; N05–N09 recovery-gate / backup tests; N10–N11 caught by the `CONSISTENCY_HOLD` assertion (the 0005 transition trigger would probably still refuse the lone-event order with another error code; not separately verified); N12 verifier tests; N13 the 0008 trigger test (the verifier still DETECTS the orphan: defence in depth); N14 the migration seeding test; N15–N17 staging/filesystem tests; N18–N20 web unit tests; N21 the permission matrix (only the error code and order of refusal change; nothing is written either way).
