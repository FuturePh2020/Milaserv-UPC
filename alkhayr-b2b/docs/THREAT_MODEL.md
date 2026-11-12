# ALKHAYR — Threat Model (initial, stage 00)

Method: asset → actor → threat → control → verifying stage. Revisited in stage 16 against real code.

## Assets
1. Merchant accounts & personal contact data (phone, address, email).
2. Admin credentials and TOTP secrets.
3. Prices, inventory balances, order records (financial integrity).
4. Session tokens, APP_SECRET, BACKUP_KEY.
5. Backups (full copy of all data).
6. Availability of ordering during business hours.

## Trust boundaries
Internet → reverse proxy (TLS) → Node process (127.0.0.1/private network) → SQLite file on local
disk. Operator shell (CLI) is trusted. Browser is untrusted. Product image URLs are untrusted
third-party content rendered by the browser only (never fetched server-side).

## Threats & controls

| # | Threat | Actor | Control | Stage |
|---|---|---|---|---|
| T1 | Credential stuffing / brute force on login | external | scrypt; per-account (5/15 min) + per-IP (20/15 min) limits applied before hashing; one generic failure; admin TOTP | 03/04 ✅ |
| T2 | Admin TOTP replay or race | external w/ observed code | `verifyTotp` returns the accepted step (03 ✅); enrollment step stored as baseline (03 ✅); atomic `last_otp_step` update at login (04) | 03/04 |
| T3 | Self-registration as admin / mass assignment of role, status, prices | trader/visitor | strict schemas reject unknown fields (tested: role, status, ids, totp, hash); registration creates pending traders only; admin only via CLI | 04 ✅ (profile edits: 05) |
| T4 | IDOR: trader reads another's orders/profile | approved trader | profile selected only by session (no ids/params accepted); 404 for foreign ids; signed cursors | 05 ✅ profile (orders: 08) |
| T5 | Pending/suspended trader sees prices or orders | trader | guards read live status per request (`requireApproved`); suspended accounts have no valid session | 04 ✅ guards (routes: 06–09) |
| T6 | CSRF / cross-site mutation | malicious site | SameSite=Strict, exact Origin, Fetch Metadata, session-bound CSRF, pre-login CSRF, JSON-only | 04 ✅ |
| T7 | Session theft/fixation | external | HttpOnly `__Host-` cookie, rotation destroying any presented session, duplicate-cookie rejection, idle/absolute expiry, hash-only storage, cap 5 | 04 ✅ |
| T8 | Forged identity headers (ChatGPT/role headers) | external | headers ignored; identity only from session + live rows | 04 ✅ |
| T9 | Price tampering in order request | trader | server-authoritative pricing; client prices only for stale detection | 08 |
| T10 | Overselling via concurrent confirmations | admins concurrently | BEGIN IMMEDIATE, guarded UPDATE `available >= qty`, all-or-nothing | 09 |
| T11 | Double order on retry/double click | trader/network | idempotency key + digest | 08 |
| T12 | Stale admin form overwrites stock/price | admin | expectedVersion pre-check + WHERE expectedVersion; version +1 on every update incl. stock (trigger) | 06 ✅ (stock writes: 07) |
| T13 | SQL injection via search/sort | any | bound parameters, fixed sort/column maps, strict query parsing | 05/06 ✅ |
| T14 | Stored XSS via product names, notes, addresses | admin/trader | React escaping, no `dangerouslySetInnerHTML`, strict CSP | 10–12 |
| T15 | Malicious image URLs (javascript:, credentials, tracking) | admin | https-only, no userinfo (even empty), canonical storage, never fetched server-side, no-referrer, CSP img-src | 06 ✅ |
| T16 | CSV formula injection in exports | trader-controlled text | prefix `'` for cells starting (after trim/BOM/control) with = + - @ ; quote escaping | 13 |
| T17 | Oversized/abusive bodies, slowloris | external | streaming body limit (auth 8 KiB), server timeouts, general per-IP API limit; proxy limits (17) | 01/04 ✅ |
| T18 | Static file traversal (.env, DB, source) | external | explicit asset allow-list; data dir outside web root | 01 |
| T19 | Secrets leaked in logs/responses | bug | redaction, explicit response shapes, tests scanning logs, audit rows and responses for passwords/hashes/tokens/codes | 04 ✅ (re-review 16) |
| T20 | Backup theft / tampering | host compromise / storage provider | AES-256-GCM with independent key, authenticated header, no HTTP endpoint | 15 |
| T21 | Restore reintroduces live sessions or mixes WAL | operator error | new target path only, sessions revoked, integrity checks | 15 |
| T22 | Dependency compromise | supply chain | minimal deps, lockfile, audit, no runtime CDN | 01/16 |
| T23 | Spoofed client IP to evade rate limits | external | XFF trusted only from configured proxy IPs, right-to-left; IPv6 /64 grouping | 04 ✅ (deployment wiring: 17) |
| T24 | Direct access to Node port bypassing proxy | external | bind to 127.0.0.1 / internal network; compose exposes proxy only; Host check | 17 |
| T25 | Running two app instances on one SQLite file / NFS corruption | operator | exclusive instance lock (OS-released), network-filesystem refusal, documented constraint | 02 ✅ |
| T26 | Loss of only admin (lost TOTP device) | operator | CLI reset-mfa on trusted host (15); cannot suspend sole admin via UI (05); setup-admin refuses a second bootstrap (03 ✅) | 03/05/15 |

## Accepted / residual risks (initial)
- SQLite data file not encrypted at rest (rely on host disk encryption).
- Single host = single point of failure; recovery via off-host encrypted backups (operator task).
- Login rate limiting allows temporary targeted lockout (availability vs. brute-force trade-off).
- Trader cart drafts in localStorage are readable by anyone with access to the device browser
  (contain no credentials or prices of record).
| T27 | Schema changed or FKs disabled through an injected/buggy query on the HTTP path | bug / attacker with SQL injection | runtime connection authorizer denies DDL, ATTACH, PRAGMA writes, SAVEPOINT; parameters only | 02 ✅ |
| T28 | Silent data loss or reset on startup/upgrade | operator error / bug | server never creates/migrates; explicit CLI; checksum + newer-schema guards; atomic migrations; `--confirm-backup` | 02 ✅ |
| T29 | History tampering through ordinary UPDATE/DELETE | insider / bug | append-only and immutability triggers; RESTRICT foreign keys | 02 ✅ (database level) |
| T30 | Hash-format abuse: stored/crafted hash with inflated scrypt cost exhausts CPU/RAM | attacker with DB write / bug | strict parser + parameter allow-list; no work for rejected params | 03 ✅ |
| T31 | Password-hashing flood exhausts memory | external | ≤ 2 concurrent (≈ 258 MiB peak) and ≤ 32 queued; immediate rejection beyond | 03 ✅ (rate limits: 04) |
| T32 | MFA secret disclosure from DB/backup | DB/backup theft | AES-256-GCM with HKDF key from APP_SECRET (not in DB), AAD per user; secret shown only in operator terminal; no QR service | 03 ✅ |
| T33 | Wrong/rotated APP_SECRET silently disables or resets admin MFA | operator error | startup refuses (`MFA_KEY_MISMATCH`); nothing replaced | 03 ✅ |
| T34 | Rogue or accidental admin creation (second bootstrap, trader promotion, web setup route) | operator / attacker | local TTY-only CLI with instance lock; refuses if an admin exists; never promotes; no HTTP route | 03 ✅ |
| T35 | Password captured via shell history, process list or terminal echo | local observer | no CLI argument accepted; hidden raw-mode input; refused on non-TTY stdin | 03 ✅ (PTY-tested) |
| T36 | Login oracle: distinguishing missing / wrong password / suspended / MFA-needed accounts | external | one `INVALID_CREDENTIALS` body for all; dummy scrypt for unknown users; TOTP sent with the login (no "MFA required" step); identical registration response for duplicates | 04 ✅ |
| T37 | Hashing-queue exhaustion (CPU/RAM DoS through login) | external | rate limits before hashing; 2 running/32 queued cap; 503 + Retry-After | 04 ✅ |
| T38 | Stale verification wins a race (reset/suspension/password change during login or password change) | concurrent actor | commit transaction re-reads hash, `password_changed_at`, status, session; conditional updates | 04 ✅ (gated-race tests) |
| T39 | Concurrent TOTP replay | attacker with an observed code | `UPDATE … WHERE last_otp_step < step` must affect 1 row inside the session-creating transaction | 04 ✅ |
| T40 | Targeted login lockout (availability) | external | 15-minute windows, no permanent lockout, monitoring of `rate_limited` events — **OPEN risk**, not solved | carried to 16 and release gate 18 |
| T41 | Rate-limit key spraying (many IPs/usernames) to grow storage | external | HMAC keys, 100 000-row cap with expired purge and shared overflow counter; periodic sweep | 04 ✅ |
| T42 | ABA status race: approved → suspended → approved during an in-flight login | concurrent admin action | monotonic `merchants.access_version` compared at login commit (migration 0002) | 05 ✅ |
| T43 | Stale identity authorizes a write after suspension/logout/recency lapse while the body is in flight | concurrent actor | `revalidateAtCommit` inside every mutating transaction | 05 ✅ |
| T44 | Suspension reported but sessions still valid (partial failure) | storage failure | state change, revocation and audit in one transaction; injected failures roll back all | 05 ✅ |
| T45 | Privilege change through merchant controls (promote trader, demote/suspend admin) | admin error / attacker with admin session | strict schemas (no role field), `ADMIN_ACCOUNT_PROTECTED`, no role/password/MFA endpoints | 05 ✅ |
| T46 | Data harvesting through admin search/pagination | trader / forged cursor | admin-only, strict params, escaped LIKE, HMAC cursors bound to admin/sort/filters, limit ≤ 100 | 05 ✅ |
| T47 | Prices/catalog exposed to unapproved users or inactive items disclosed | visitor / pending trader | live approval guard, active-only queries, identical 404, no stock numbers to traders | 06 ✅ |
| T48 | Catalog flooding beyond the 5000 cap | admin error / race | cap counted inside the serialized create transaction | 06 ✅ |
| T49 | Stock changed through metadata endpoints (bypassing the ledger) | admin / attacker with admin session | strict schemas without stock fields; creation fixed at zero; stock only via stage-07 service | 06 ✅ |
| T50 | Server-side request forgery through image URLs | admin | server never fetches URLs; no proxy or upload | 06 ✅ (by design) |
