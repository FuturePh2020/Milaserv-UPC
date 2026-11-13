# Stage 18 — Final acceptance report (release candidate 1.0.0-rc.1)

> **Conclusion: ACCEPTANCE PASSED FOR LOCAL DEPLOYMENT PACKAGE; PUBLIC LAUNCH BLOCKED.**
>
> - Every independent acceptance check ran on the release artifact in a local production-like stack and passed.
> - **No hosted check could run:** no server, domain, DNS or off-server storage was provided. Production technical
>   acceptance is therefore **not** passed.
> - Business launch approval is a separate owner decision. Six owner decisions are **pending**
>   (`OWNER_DECISIONS_18.md`).
> - This is not an independent penetration test or certification, and no claim of complete security is made.

Date: 2026-11-13 (UTC). Environment: one cloud development container (4 vCPU Intel Xeon 2.1 GHz, 16 GB RAM,
Docker 29.9.2, overlay storage). The host itself was restarted twice during the stage (outside this project's
control).

---

## 1. Blockers and weaknesses (first)

| # | Item | Severity | Status | Owner |
|---|---|---|---|---|
| B-1 | Exact stock inferable by quote/order probing (17 requests) | Business | **Open** — DR-1 pending | Owner |
| B-2 | No real off-server backup exists; only a LOCAL S3-compatible test server was used | High (operational) | **Open** — DR-4 inputs missing | Owner + operator |
| B-3 | No public DNS / publicly trusted certificate / hosted checks | High (deployment) | **Open** — DR-5 inputs missing | Owner + operator |
| B-4 | RPO / RTO not approved; off-server transfer and human reconciliation unmeasured | Medium | **Open** — DR-2 pending | Owner |
| B-5 | Distributed sign-in DoS residual (≥ 6 sources lock one username ≤ 15 min; queue saturation → 503) | Medium | **Open** (reduced in stage 18, see §5) — DR-3 pending | Owner |
| B-6 | Proxy image (Caddy 2.11.9, newest official) carries HIGH advisories with no official fixed build | Medium | **Reachable one mitigated by configuration; residual open** — DR-6 pending | Owner + operator |

**Other weaknesses:**
- **Browsers and accessibility:** Chromium only; other browsers NOT RUN. Accessibility was checked with automated
  axe rules only; no manual screen-reader review.
- **Load:** a local observation through the Docker bridge, not through Caddy (§5).
- **Data and platform:** synthetic data only. The Docker host's own hardening (kernel, firewall, disk encryption,
  OS updates) is out of scope and unverified.
- **Alerts:** no alert channel exists; no message was sent.

## 2. What the owner can use now
- **The release package:**
  - `Dockerfile`, `deploy/compose.yaml`, `deploy/caddy/Caddyfile` and `deploy/env.example`;
  - the Arabic deployment guide `DEPLOYMENT_AR.md` (every command in §2–§7 ran as written in `accept18` /
    `upgrade18`);
  - the recovery guide `BACKUP_RECOVERY_AR.md`.
- **Handover documents:**
  - `OWNER_QUICKSTART_AR.md` (daily use);
  - `MAINTENANCE_AR.md` (maintenance and incidents);
  - `DEPLOYMENT_INPUTS.md` (what to provide);
  - `RELEASE_CHECKLIST.md`, `KNOWN_LIMITATIONS.md`, `RELEASE_NOTES.md`, `REQUIREMENTS_EVIDENCE.md`.
- **A private staging or pilot** on an authorized host with test data (never real trader data without access
  control). This is possible once DR-5 inputs exist. **Do not open it to traders** until the launch gates in
  `RELEASE_CHECKLIST.md` pass.

## 3. Proxy (Caddy) findings — resolved, mitigated or open

- **Image:** `caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0`, the
  current official `2.11.9-alpine`; 2.11.9 is the newest Caddy on the Go module proxy.
- **Binary:** `/usr/bin/caddy` sha256 `a563843e…a60cdf`, built with Go 1.27.3.
- **Scanners:**
  - Trivy 0.76.2 (DB updated 2026-11-13 12:56 UTC);
  - govulncheck v1.9.0 in binary mode against the official Go vulnerability database (index modified
    2026-11-11 02:51 UTC).

  Govulncheck reports which vulnerable **symbols are present in the binary**, which is stronger than a module
  version match but still not runtime reachability.
- **Configuration evidence:** `caddy adapt` of our Caddyfile, in both TLS modes, loads only the apps `http` and
  `tls`. The handlers are `headers`, `reverse_proxy`, `subroute` and, after stage 18, `static_response`; there is
  no `pki` app, `acme_server`, admin API, `encode` or file server.
- **Import graph:** `go mod why` / `go list -deps` on caddy v2.11.9.

| Advisory | Component (installed) | Fixed in | Affected functionality and prerequisites | Enabled by our configuration? | Status |
|---|---|---|---|---|---|
| **GO-2026-6859 / CVE-2026-97054** (Trivy: severity UNKNOWN) | Go stdlib `net/http` 1.27.3 | Go 1.26.11 / 1.27.4 | HTTP/1 server panics (process crash) when `MaxBytesReader` hits its limit while a handler reads the body concurrently with writing response headers. Caddy uses `MaxBytesReader` only in `request_body` and the admin API. | **Yes until stage 18:** our Caddyfile used `request_body max_size 3MB` in front of `reverse_proxy`, which streams the body while writing headers. Admin API is off. | **Mitigated:** `request_body` removed. A declared `Content-Length ≥ 3 000 000` gets 413 from a header matcher without reading the body. The app enforces exact limits on every body, chunked included. Re-verified: 3.5 MB declared → 413 in 5 ms; 2.5 MB and chunked 3.5 MB → app 413; Host≠SNI 421; HTTP→HTTPS 308; no panics; 6 browser suites, `accept18` and `upgrade18` re-run. Residual: the stdlib `OPTIONS *` handler still uses `MaxBytesReader`, but sequentially (no concurrent header write), so the race condition cannot occur there. |
| **CVE-2026-116587 / GHSA-mgcc-cww5-fp2q** (HIGH 7.5) | `github.com/go-jose/go-jose/v3` v3.0.5 | v4.1.6 only — **no fixed v3** | CPU DoS when parsing attacker-supplied RSA JWKs. Reached via `caddypki` → smallstep `certificates/authority` → `go.step.sm/crypto/jose`. Untrusted JWKs arrive only through CA/ACME-server endpoints. | **No:** no `acme_server`, no `pki` app in the adapted config, admin off. `tls internal` signs locally; ACME mode talks to a public CA as a client. | **Open (not reachable by configuration — review evidence, not runtime proof).** Not in the Go vuln DB, so govulncheck cannot confirm. DR-6. |
| CVE-2026-116585 / 116586 (MEDIUM) | go-jose v3.0.5 | none for v3 | DoS via empty ciphertext / deeply nested JSON | No (same reasoning) | Open, as above |
| **CVE-2026-78661 / GO-2026-6860** (HIGH 7.5) | `golang.org/x/net` v0.60.0 `html.Parse` | v0.62.0 | Quadratic parse time on crafted HTML | **No:** the only importer is smallstep `cli-utils/usage/report.go` (CLI help rendering of static text); none of our handlers parses HTML | Open (unreachable by configuration); no Caddy release with x/net ≥ 0.62 |
| CVE-2026-97045 / GO-2026-6866 (MEDIUM) | x/net v0.60.0 `html.Render` | v0.62.0 | Namespace confusion when re-rendering HTML | No (same importer) | Open, as above |
| GO-2026-6865 / CVE-2026-116591 (govulncheck only) | `klauspost/compress` v1.20.1 (zstd/huff0) | v1.20.2 | Panic on two-block frames | **No:** imported only by `encode zstd`; our config has no `encode` | Open (unreachable) |
| GO-2026-5932 (UNKNOWN) | `golang.org/x/crypto/openpgp` v0.57.0 | — | Deprecated, unsafe-by-design package | Not in `go list -deps ./cmd/caddy`; no handler uses OpenPGP | Open (unreachable) |
| CVE-2026-4738 (MEDIUM) | Alpine `zlib` 1.3.2-r1 | 1.4-r0 | Memory-bounds issue in zlib | Caddy is a static Go binary and does not link Alpine zlib | Open (unreachable by Caddy) |

**Kinds of risk:**
- **Dependency vulnerability:** 2 HIGH, 4 MEDIUM and 2 UNKNOWN remain in the image (Trivy).
- **Practical reachability in our configuration:** none after the stage-18 change, on the evidence above.
- **Residual risk:**
  - our evidence is configuration review and symbol presence, not exploitation testing;
  - a future configuration change could re-expose these paths: `acme_server`, `pki` endpoints, admin API,
    `encode zstd`, `request_body`, or HTML-processing modules. `MAINTENANCE_AR.md` forbids these without re-review;
  - no official fixed build exists.

**Risk acceptance is the owner's** (DR-6, pending).
No suppression file was added, and no unreviewed custom proxy build was substituted.

The **application image** has 0 critical and 0 high findings (Trivy, same DB): 39 medium, 12 low and 2 unknown in
Debian 13 base packages, and none in Node packages. `npm audit` reports 0 vulnerabilities.

## 4. Final verification evidence

**Tested image:** `alkhayr-b2b:1.0.0-rc.1`, Id `sha256:e8cf6ad9100efda3433053d755b069fc636ce436e7193ce872819ed939a562da`. All results in this section ran on it.

**Rebuild check:**
- A later rebuild from the same source produced Id `sha256:b8a647ab…5346`, which now holds the local tag; the tested image was removed when the tag moved.
- Image Ids include build timestamps. The shipped `/app/dist` manifest (`a4b35fdb…`) and the migrations are byte-identical in the tested image, a no-cache rebuild and the current tag.

| Check | Tool / version | Environment | Result |
|---|---|---|---|
| Typecheck + build + all tests | Node 24.22.1, `npm run check` | UNIT | **618/618** (617 + the new capacity-refund test) |
| Clean copies (fresh `npm ci` + typecheck + tests) | npm 11 | UNIT | **3/3 PASS**: `npm ci` + typecheck + 618/618 in each |
| `npm audit` | npm | — | **0 vulnerabilities** |
| Production image build | Docker 29.9.2 BuildKit; base digests pinned | STACK | built; runtime distroless Node 24.22.3, uid 1000 |
| Image scans | Trivy 0.76.2 (DB 2026-11-13 12:56 UTC); govulncheck 1.9.0 (Caddy) | — | App 0 C / 0 H; Caddy see §3 |
| Clean-install business acceptance (`accept18`) | Node client, real terminal driver, HTTPS via Caddy local CA, verification on | STACK | **123/123** on the final image |
| Upgrade acceptance from the stage-15 release (`upgrade18`) | stage-15 worktree `9097aac` + release image | PROC + STACK | **36/36** on the final image |
| Browser regressions over HTTPS (Chromium; only the local CA trusted) | Playwright + Chromium | STACK | merchant **87/87**, administration **126/126**, import **44/44**, business **67/67**, recovery **19/19**, secure cookies **19/19** (final image) |
| Consistency verification | `db:check` | STACK | Clean after acceptance, upgrade, restore, load |
| Backup / restore acceptance | `backup:run`, `backup:verify`, `backup:restore`, `recovery:reopen` | STACK | PASS (in `accept18`) |
| Bounded mixed load (`load18`) | Node HTTP client; `docker stats` | STACK (no proxy) | §5 |
| Hosted checks | — | HOSTED | **NOT RUN** |

## 5. Performance — what was actually measured

**Stage-17 test, documented exactly (it was earlier summarised too optimistically):**
- **Target:** a standalone app container (2 CPU / 1 GiB), reached directly over the Docker bridge with plain HTTP
  and a simulated client address per virtual user. **Not** through Caddy.
- **Dataset:** 2 000 products and 20 000 historical orders (61 MB).
- **Load:** 50 virtual traders for 60 s, **read-only**: 70 % catalog search, 20 % own order list, 10 % quote. No
  order creation, no admin writes.
- **Login burst:** 168 attempts, of which 45 returned 200, 48 returned 503 and 75 returned 429; 45 of 50 traders
  signed in after 11.8 s.
- **Throughput and latency:** 177 req/s. p95 10–12 ms, p99 23–32 ms (max 82 ms).
- **Resources:** peak CPU 195 % and memory 227 MiB, **during the login burst** (scrypt). Steady state was about
  25 % CPU and 45–54 MiB.
- **Correctness was not verified afterwards** (nothing was written).

**Stage-18 scenario (`load18`), same container limits, image 1.0.0-rc.1:**
- **Dataset:** 59 MB: 2 000 products, 70 traders, 20 000 historical orders (5 000 shipped).
- **A. Login burst:** 70 traders at once. All 70 signed in within 13.1 s. Of 303 responses, 71 were 200 and 232
  were 503 (retried); there were **0 × 429**. The same run before the stage-18 fix gave 49/70 sessions, with 525 × 429
  (users locked for 15 minutes).
- **B. Catalog browsing:** 50 traders for 60 s. 11 800 requests (196 req/s), 0 non-2xx and 1 client socket
  error. p50 3 ms, p95 11–12 ms, p99 17–29 ms.
- **C. Mixed with writes:** 95 s.
  - **Who:** 50 browsing/quoting traders, 20 ordering traders and one administrator confirming, preparing and
    shipping at a human pace (about 2 actions per second). A 100-row CSV import ran at +30 s and an online encrypted
    backup at +45 s.
  - **Volume:** 16 130 requests (170 req/s); read:write = 15 618 : 512.
  - **Writes:** 360 orders created, 151 transitions, the import (preview 103 ms, commit 629 ms) and the backup
    (3.9 s, verified).
  - **Errors:** **0 non-2xx**.
  - **Latency:** p95 about 114 ms and p99 about 131–139 ms for reads, max 0.73 s. Order creation p95 50 ms.
  - **Resources:** peak CPU 198 % and memory 312 MiB; median CPU 35 %.
- **Afterwards:**
  - all 360 reported orders were in the database exactly once, with 0 duplicate request keys;
  - 0 products broke the `on_hand ≥ reserved ≥ 0` rule;
  - the import was committed once and the backup file written;
  - `db:check` exit 0.
- **Observation:** one administrator at that pace processed 151 transitions while 360 orders arrived. Fulfilment
  throughput is a staffing question, not a server limit.
- **Limits hit by design:** the per-IP API limit (300 requests/min) refused an administrator script that moved
  faster than about 5 requests/s (in the first stage-18 run, before pacing).

These numbers are **local observations** on development hardware with synthetic data. They do **not** translate into
a supported number of traders. Production capacity remains unmeasured until the real host exists.

## 6. Business-flow acceptance (clean installation, production artifact, real sessions)

`accept18` installed from the documented artifacts into an empty Compose project:
- secrets per guide §2;
- `db:init`;
- `setup-admin` in a real terminal;
- app, proxy and backup services started.

Everything else went through the public HTTPS API, with no fixtures and no direct database writes. All 123 checks
passed, grouped as follows:
- **Install:**
  - app refuses before `db:init`; `db:init` once only;
  - TOTP enrolment; second bootstrap refused;
  - 8.9 s from an empty directory to ready.
- **Administrator authentication:** login without TOTP refused; `__Host-` cookie attributes; `/healthz` and
  `/readyz` without details.
- **Settings:** stale version refused.
- **Products and stock:**
  - products created inactive, then activated;
  - opening stock;
  - idempotent adjustment retry;
  - correction with a reason.
- **Registration:**
  - 202 for new and duplicate usernames alike;
  - a duplicate did not change the first password;
  - pending trader: catalog, quotes and admin refused.
- **Approval:** stale version refused; effective for the signed-in trader.
- **Catalog:** name search, exact barcode, category filter, detail without stock counts, filters with counts.
- **Quote and money:**
  - exact money matches an independent BigInt model;
  - the quote writes nothing;
  - minimum quantity enforced;
  - `PRICE_CHANGED`;
  - client amounts and merchant ids rejected.
- **Terms:** `TERMS_CHANGED` after a settings change; nothing created.
- **Orders:**
  - 201 with exact amounts;
  - lost-response retry → 200 replayed, no duplicate;
  - key reuse → 409.
- **Separation:** foreign order or summary → 404; traders blocked from transitions, settings, merchants, exports and
  imports; missing CSRF → 403; foreign Origin → 403.
- **Snapshots:** unchanged after product, price, settings and profile edits; summary contains snapshot data only;
  an old price is refused.
- **Fulfilment:**
  - confirm reserves exactly the ordered cartons;
  - transition retry replayed;
  - state skip refused;
  - ship deducts once;
  - deliver;
  - cancel after shipment refused;
  - the trader's history shows no administrator names.
- **Cancellation:**
  - cancelling one order releases only its own 4 cartons;
  - a reason is required;
  - cancelling a pending order has no stock effect;
  - a correction below reserved → 422;
  - the ledger shows every kind of movement.
- **CSV import:**
  - template with BOM, CRLF and no example rows;
  - preview writes nothing;
  - a concurrent change rejects the whole file (row 1 not applied);
  - the same unconsumed key then commits;
  - an identical retry is replayed;
  - forbidden columns refused;
  - history shows committed batches only.
- **Reports and exports:**
  - reports by state, inventory totals exact, movements;
  - export with BOM, CRLF, fixed file name and `no-store`;
  - no contact data by default;
  - a formula-like business name neutralised;
  - pre-filled template.
- **Suspension:** sessions revoked immediately; login refused generically; admin accounts protected.
- **Password and sessions:** a change revokes all sessions; old password refused; logout deletes the cookie.
- **Operator recovery:**
  - `account:reset-password` and `account:reset-mfa` in a real terminal with the server stopped;
  - sessions revoked; old authenticator refused;
  - logs free of secrets.
- **Backup:**
  - `backup:run` writes a verified encrypted copy;
  - no off-server copy configured, and `ops:status` warns (exit 3);
  - the backup key is absent from the web process.
- **Restore** (separate project, own volumes):
  - verify, then restore;
  - recovery mode; a post-backup cookie is invalid; the post-backup order replay → 503;
  - `db:check`;
  - `recovery:reopen` in a terminal; the stale replay → 409 `RECOVERY_EPOCH_STALE`;
  - an order contained in the backup is replayed;
  - history shows the restored point in time;
  - a fresh order under the new epoch is accepted;
  - the admin authenticator from backup time works;
  - **the original database hash is unchanged**.

## 7. Installation and upgrade acceptance (`upgrade18`)
- **Previous release:** the stage-15 release (commit `9097aac`, schema 7) ran natively from a git worktree. It had
  no container packaging, ran in development mode, and was served over HTTP on loopback.
  - Its own CLI initialized the database and enrolled the administrator in a real terminal.
  - Its HTTP API created the data: settings, products and receipts, an approved trader, orders left delivered,
    confirmed (open reservation), pending and cancelled, and a committed import.
- **Explicit backup** with the old release (`backup:create`, verified) **before** migration.
- **Moved into the release deployment.** The app refuses the old schema (`MIGRATIONS_PENDING`). The new release
  verifies the old backup. `db:migrate` refuses without `--confirm-backup`, then applies 0008 (0.5 s including
  container start). `db:check` is clean.
- **Data preserved:**
  - All 13 historical tables are **row-for-row identical**.
  - `schema_migrations` rows 1–7 are unchanged and exactly one row (8) was appended. The recorded checksums equal
    the shipped files.
  - The trader sees identical orders, numbers, items, amounts and buyer snapshots.
  - The administrator's old authenticator works and inventory balances carried over exactly.
- **Old work continues under the new release:**
  - the old reservation is shipped exactly once;
  - the old pending order is confirmed;
  - a stage-15-style order body (no epoch header) is accepted.
- **Operations:**
  - a second instance → `INSTANCE_LOCKED`;
  - uid 1000, read-only root, `CapDrop [ALL]`, data 0700 / DB 0600;
  - SIGTERM → `shutdown_complete`, exit 0 in 187–245 ms (two runs);
  - data intact after `compose down` / `up`.
- **Rollback:**
  - App-only rollback to the previous image with the same schema (17.0.0-rc8): ready 0.8–0.9 s after the switch,
    and forward again in 0.8 s.
  - The old release **refuses** the migrated schema (`SCHEMA_TOO_NEW`).
  - The documented downgrade path restores the pre-migration backup **into a separate directory** and contains
    exactly the pre-migration rows (plus the restore's own audit entry). Writes made after the upgrade are **not**
    in it.
  - An old backup is never restored over newer business writes automatically.

**Known upgrade limitations:**
- Only the upgrade from schema 7 (stage 15) was tested. Schemas 1–6 are not claimed.
- No zero-downtime upgrade: stopping the app and having the new release ready took 0.8–1.9 s locally, with one
  failed probe.
- **Pending browser submissions:**
  - A browser tab open during an upgrade keeps its old script. The tested compatibility covers the stage-15 client
    (orders with `expectedTerms`, no epoch header).
  - A submission whose outcome was unknown when the server stopped stays in the tab's unresolved-operation notice.
    The user must check *My orders* before retrying (same key → original result).
  - After a **restore**, such submissions are refused with `RECOVERY_EPOCH_STALE` and the UI tells the user to
    review and submit again.

## 8. Backup and recovery acceptance — distinctions

| Level | Status |
|---|---|
| Local encrypted backup | **PASS:** latest local verification in `accept18` 2026-11-13; online during traffic in `load18` |
| Off-server transfer | **Tested only against a LOCAL S3-compatible test server** (stage 17). Not disaster protection |
| Download-and-verify test | PASS against the local test server; **NOT RUN** against a real destination |
| Restore drill | PASS on the deployment architecture (stage 17: 61 MB, 6.3 s / 9.1 s; stage 18: 3.0 s / 4.4 s) |
| Business reconciliation | Procedure in `BACKUP_RECOVERY_AR.md`; **time unmeasured** (human step) |
| Reopening writes | PASS (`recovery:reopen`, reason + typed confirmation) |
| Last verified actual off-server copy | **None exists** |
| Secret custody | **Unassigned:** owner to name holders of `app_secret`, `backup.key` and storage credentials (DR-4) |
| RPO / RTO | **Provisional, unapproved** (DR-2) |

**Backup gate for the public launch: OPEN.**

## 9. Hosted environment acceptance
**No authorized host, domain, DNS or storage was provided**, so nothing was bought, configured or exposed. The
following are **NOT RUN**:
- public DNS and a publicly trusted certificate;
- renewal;
- secure cookies on the real domain;
- proxy-only access and client addresses on the host;
- the real persistent disk;
- non-root permissions on the host;
- host reboot;
- real off-server backup, download and verification;
- restore into an isolated host;
- monitoring with an authorized alert test.

The exact inputs are listed in `DEPLOYMENT_INPUTS.md`. Production acceptance is **not** passed.

## 10. Findings fixed in stage 18
1. **Proxy crash exposure (GO-2026-6859):** `request_body` replaced by a declared-length check (§3).
2. **Sign-in lockout amplified by capacity refusals:**
   - **Before:** a 503 (full hashing queue) or a per-source concurrency refusal still spent the user's attempts.
     A legitimate trader retrying during a surge, or while an attacker filled the queue, was locked out for 15 min.
   - **Fix:** `RateLimiter.refund`, called only for refusals that happen before any credential is checked.
   - **Evidence:** the new test fails without the fix; `load18` went from 49/70 to 70/70 sessions.
3. **Merchant status screen after a version conflict:**
   - **Before:** the message "current data shown" appeared before the current record loaded, and the stale record's
     choices stayed selectable. The server refused any such submission (409), so there was no data risk.
   - **Fix:** controls are disabled until the current record is shown.
   - **Evidence:** a deterministic browser check with a delayed reload fails on rc8 and passes on rc.1.
4. **Documentation corrections:**
   - the stage-17 load summary;
   - the guide's mention of a 3MB proxy body limit;
   - `db:check` needs the data volume mounted read-write.

## 11. NOT RUN (complete list)
- **Hosted:** everything in §9.
- **Browsers and accessibility:** non-Chromium browsers; manual screen-reader review.
- **Security assurance:** independent penetration test or certification; exploit testing of the Caddy advisories.
- **Data and capacity:**
  - production-size real data;
  - load through the proxy from many real addresses;
  - capacity on the real host.
- **Operations:**
  - alert delivery (no authorized recipient);
  - Object Lock / versioning on a real bucket;
  - upgrade from schemas 1–6.
- **Hardening of the Docker host itself.**
