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
| T4 | IDOR: trader reads another's orders/profile | approved trader | profile and orders selected only by session (no ids/params accepted); 404 for foreign ids; signed cursors | 05 ✅ profile · 08 ✅ orders |
| T5 | Pending/suspended trader sees prices or orders | trader | guards read live status per request (`requireApproved`); suspended accounts have no valid session; order reads/creation approved-only | 04 ✅ guards · 06/08/09 ✅ routes |
| T6 | CSRF / cross-site mutation | malicious site | SameSite=Strict, exact Origin, Fetch Metadata, session-bound CSRF, pre-login CSRF, JSON-only | 04 ✅ |
| T7 | Session theft/fixation | external | HttpOnly `__Host-` cookie, rotation destroying any presented session, duplicate-cookie rejection, idle/absolute expiry, hash-only storage, cap 5 | 04 ✅ |
| T8 | Forged identity headers (ChatGPT/role headers) | external | headers ignored; identity only from session + live rows | 04 ✅ |
| T9 | Price tampering in order request | trader | server-authoritative pricing; client prices/packaging only for stale detection (409 with current terms); strict schema rejects totals/tax/shipping | 08 ✅ |
| T10 | Overselling via concurrent confirmations | admins concurrently | BEGIN IMMEDIATE; availability checked and reserved in one transaction; ledger/products CHECKs; all lines or none | 09 ✅ |
| T11 | Double order on retry/double click | trader/network | per-merchant idempotency key + canonical digest; replay before current-state rules; serialized writes | 08 ✅ |
| T12 | Stale admin form overwrites stock/price | admin | expectedVersion pre-check + WHERE expectedVersion; version +1 on every update incl. stock (trigger) | 06/07 ✅ |
| T13 | SQL injection via search/sort | any | bound parameters, fixed sort/column maps, strict query parsing | 05/06 ✅ |
| T14 | Stored XSS via product names, notes, addresses | admin/trader | React escaping, no `dangerouslySetInnerHTML`/`innerHTML`/`eval` in `src/web` (test), strict CSP unchanged | 10 ✅ components (screens: 11–12) |
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
| T51 | Double stock movement from a retried/duplicated request | network / double click | per-administrator operation key + request digest; replay checked before the version; concurrent identical requests serialized | 07 ✅ |
| T52 | Stock changed without a traceable ledger entry (any write path, incl. raw SQL by a buggy feature) | bug / insider | 0003 trigger: every on_hand/reserved change needs a new matching ledger row; ledger append-only | 07 ✅ (database) |
| T53 | Manual adjustment used to alter reservations or push on_hand below commitments | admin error / attacker with admin session | strict schemas without reserved; reserved floor check; ledger and products CHECKs | 07 ✅ |
| T54 | Product created already active or stocked, bypassing review and ledger | bug / future import path | 0003 insert trigger (inactive, zero stock) | 07 ✅ (database) |
| T55 | Portal stock diverges from stock sold through other channels | business process | documented: the business allocates/reconciles portal stock; no automatic sync | 07 (documented, operational) |
| T56 | Order for another merchant / admin acting for a trader through the order API | trader / admin | merchant only from the session; strict schema rejects ids; headers ignored; no admin order routes before 09 | 08 ✅ |
| T57 | Stock probing through order attempts (binary search on quantities) | approved trader | errors carry status only, never counts; per-merchant 30 attempts / 10 min — **residual**: bounds remain inferable slowly | 08 (residual, documented) |
| T58 | Partial order visible or inconsistent (header without items, wrong subtotal, mixed demo) | bug / other write path | one transaction; creation event as finalization marker guarded by 0004; reads finalized only | 08 ✅ |
| T59 | Money overflow / rounding manipulation | trader | BigInt, half-up rule, limits rejected not clamped; database total/tax CHECKs | 08 ✅ |
| T60 | Approval revoked/restored (ABA) while an order body is in flight | concurrent admin action | commit-time session + approval + `access_version` comparison | 08 ✅ |
| T61 | Shipping/cancelling one order consumes or releases another order's reservation | bug / admin / raw SQL | per-order allocations; settle guard requires this order's own outstanding allocation (database) | 09 ✅ |
| T62 | Double release/deduction (retries, two admins, different keys) | network / concurrent admins | idempotent replay; version layers; allocation settled once; one release/ship row per line (unique index) | 09 ✅ |
| T63 | Carton meaning changed under stock (repack) silently reinterprets inventory/orders | admin error | pack-size lock while stocked/reserved (service + trigger); confirmation requires snapshot pack size | 09 ✅ |
| T64 | Suspended buyer's orders keep moving forward, or suspension silently releases stock | admin action | approval gate for confirm/prepare/ship (service + database); no automatic cancellation/release | 09 ✅ |
| T65 | State changed without an audit trail (raw SQL) | bug / insider | state change requires its matching latest event; events append-only, administrator actor, reason for cancellation | 09 ✅ (database) |
| T66 | Replayed operation result disclosed after the administrator lost access | stale session | eligibility re-checked before idempotency lookup | 09 ✅ |
| T67 | Credentials or CSRF tokens persisted in the browser and stolen by another script/user of the device | XSS / shared device | memory-only tokens, no storage APIs in source or bundles (tests), HttpOnly cookie | 10 ✅ |
| T68 | Development preview (fake data, synthetic states) shipped to production and mistaken for real records | build error | separate dev entry; bundle tests for gallery code/fixture marker; browser check of `#/__gallery` in production | 10 ✅ |
| T69 | Third-party font/script CDN as tracking or supply-chain vector | supply chain | fonts bundled from a pinned OFL package; CSP `'self'`; build tests reject remote CSS/JS references | 10 ✅ |
| T70 | Duplicate order after a lost response, double tap or refresh | network / user | stored key + exact payload before sending; explicit same-request retry; server replay by key+digest; busy buttons are only a convenience | 11 ✅ (browser: interrupted response, refresh, retry → one order) |
| T71 | One merchant's cart draft or pending order shown to another account on a shared browser | shared device | drafts keyed by user+merchant; other accounts' drafts deleted on sign-in; cleared on logout; UI remounted per identity | 11 ✅ |
| T72 | Account discovery through the sign-in UI (separate OTP step, factor-specific errors) | external | single request with optional OTP chosen by the user; one generic message; no separate verification endpoint | 11 ✅ |
| T73 | Quote endpoint used to probe stock or flood evaluation | approved trader | status-only errors; 60 / 10 min per merchant; same probing limits as T57 (residual: bounds remain inferable slowly) | 11 (residual, documented) |
| T74 | Stale client data (prices, packaging) silently ordered | trader | reviewed values sent as expected values; server conflict; new review and new key required | 08/11 ✅ |
| T75 | Trader browser requests administration data | approved trader / bug | admin screens mounted only in the administrator shell; server role checks on every route | 12 ✅ (browser-verified: no `/api/v1/admin` request from trader contexts) |
| T76 | Administrator credentials captured or replayed by a generic confirmation UI | bug / XSS | dedicated re-authentication panel posting to the real login; inputs cleared; no storage; TOTP replay protection | 12 ✅ |
| T77 | Duplicate stock movement or transition after a lost response | network / operator | same key + exact payload retry (server replay); new attempts carry the old expected version and are refused | 09/12 ✅ |
| T78 | Predictable operation keys from a weak random source | bug / old browser | `getRandomValues` only; refusal without it (no fallback) | 12 ✅ |
| T79 | Products of inactive categories shown to traders | configuration | trader catalog list/detail/filters exclude inactive categories | 12 ✅ |
| T87 | Order accepted under terms the trader never reviewed (shipping/tax changed after the quote) | operator change / race | required `expectedTerms`, compared after idempotency; renewed review required | 14 ✅ |
| T88 | Settings changed by a stolen idle admin session | session theft | recent authentication, CSRF, Origin, version check, audit | 14 ✅ |
| T89 | Formula injection through exported text (CSV opened in a spreadsheet) | malicious trader/product text | apostrophe prefix for formula-like cells incl. whitespace/control/full-width bypasses; quoting | 14 ✅ (real spreadsheet apps NOT RUN) |
| T90 | Re-import corrupts data with export-safety prefixes | operator | separate canonical template format; view exports labelled "not for import"; importer never strips prefixes | 14 ✅ |
| T91 | Bulk data exfiltration through exports | stolen admin session | recent auth, rate limit, caps, contact data opt-in, audit metadata | 14 ✅ (residual: an authorized admin can export) |
| T92 | Misleading financial reports (wrong timezone, cancelled/demo mixed, overflow) | design error | documented definitions, Cairo day bounds tested at boundaries, cancelled/demo separate, exact BigInt sums, overflow error | 14 ✅ |
| T93 | Order summary read by another merchant or with internal data | trader | ownership 404, trader-safe content, no public links | 14 ✅ |
| T94 | Printed summary mistaken for a tax invoice/receipt | business misuse | title «ملخص طلب», explicit disclaimer, current company labelled | 14 (documented) |
| T95 | Unbounded growth of append-only import records | time | rate limit bounds growth RATE only; stage 15 policy: retain indefinitely, measure via `backup:status`; archive design open | 15 (accepted, monitored) |
| T96 | Backup file read by someone with disk/backup-site access | theft | AES-256-GCM, per-backup HKDF key, key kept separately (file outside data/backup dirs) | 15 ✅ |
| T97 | Tampered, truncated, downgraded or crafted backup restored | attacker without key / storage fault | AAD over prefix+header, GCM tag + SHA-256, strict header, version refusal, full DB verification before replacing | 15 ✅ (residual: attacker WITH the key) |
| T98 | Backup key or passphrase leaked via argv, shell history, logs, filenames or world-readable key file | operator error | strict parser rejects secret options; hidden prompt; key-file owner/mode/symlink/location checks; key id only printed | 15 ✅ |
| T99 | Restore silently overwrites live data or merges an older point in time | operator error | refuses running target and existing DB unless `--replace`; previous DB moved aside; no merge; older-point-in-time warning + reconciliation guide | 15 ✅ |
| T100 | Restored sessions or stale logins grant access after recovery | stolen cookie / race | sessions deleted on restore; `credential_version` checked at login commit; TOTP anti-replay step preserved | 15 ✅ |
| T101 | Lost APP_SECRET "fixed" by disabling MFA or promoting a trader | operator under pressure | no such path; explicit `--accept-new-app-secret` + server refusal until each admin re-enrolled with proof | 15 ✅ |
| T102 | Recovery endpoint or default account used for takeover | external | none exist; recovery only via host OS access | 15 ✅ |
| T103 | Prune or cleanup deletes the last good backup or follows a symlink outside | operator error / local attacker | newest verified always kept; managed names only; lstat, no symlink following | 15 ✅ |
| T104 | Plaintext snapshot left behind after a crash | crash | staging only inside 0700 `DATA_DIR`; removed in `finally`; stale (>1 h) removed by next run; reported by status | 15 (residual window) |
| T105 | Typing a password at an informational line while echo is still on | operator UX | info lines no longer look like prompts ("Password rules:"); found by the PTY test | 15 ✅ (16: early-typing PTY measurement; residual for typing during other echoing phases) |
| T106 | Unauthenticated attacker locks a username out of sign-in | external | per-(source, username) guessing bound; account-wide backstop needs ≥ 6 sources; per-source hashing admission | 16 ✅ (residual: distributed sources) |
| T107 | Pre-restore browser retry silently creates an order/movement/import missing from the restored data | restore + stale browser | recovery mode until audited reopen; exact recovery-epoch match for new writes; stored submissions keep their epoch | 16 ✅ |
| T108 | Order event without state change, or orphan reserve row, corrupts fulfillment unnoticed | raw SQL / bug | verifier at startup, backup and db:check; per-order/product write guards; 0008 blocks further movements of a product with an unlinked row | 16 ✅ (reverse pairing not enforceable in SQLite: detected, fail-closed) |
| T109 | Cleanup deletes an active job's staging or follows a planted symlink | operator / local attacker | per-job OS lock; managed names, ownership, expected-file check; per-file unlink | 16 ✅ |
| T110 | Exact stock inferred by bisection over quotes/orders | approved trader | status-only responses; rate limits (60 quotes / 10 min) slow but do not prevent it (17 quotes measured) | 16 (business limitation; requires owner acceptance) |
| T111 | Lost-APP_SECRET path used to disguise a foreign database or skip MFA | operator error / attacker with shell | application_id check before acceptance; startup refused until every admin re-enrolled with proof; no promotion | 16 ✅ |
| T80 | Malformed/oversized CSV exhausts memory or CPU | administrator account misuse / compromised admin | streamed 2 MiB body limit, 1 MiB/1 000 rows/4 096-char cells, strict parser, 2 concurrent jobs, per-admin rate limits | 13 ✅ |
| T81 | Edited preview or swapped file executed as the reviewed plan | attacker with admin session / bug | server never trusts preview JSON; HMAC binding of admin, mode, content hash, versions, expiry; full re-evaluation inside the commit transaction | 13 ✅ |
| T82 | Partial import leaves catalog/stock inconsistent | bug / concurrent change | one transaction; any invalid or stale record rejects the batch; injected middle-record and audit failures roll back everything | 13 ✅ |
| T83 | Batch applied twice after a lost response or a double submit | network / operator | durable per-admin key + digest checked first; concurrent identical commits serialized; in-memory coordinator keeps key/payload across navigation (limits documented: refresh, expiry, sign-out) | 13 ✅ (residual: deliberate re-import with a new key) |
| T84 | Stale spreadsheet overwrites stock or reservations | operator | required expectedVersion per record; set-total refused below reserved and for no-ops; reserved never changed | 13 ✅ |
| T85 | Formula/HTML injection through imported text | malicious file author | text stored and rendered as text; no evaluation; spreadsheet-safe export deferred to stage 14 | 13 ✅ (export: 14) |
| T86 | Barcode corruption by spreadsheet programs (leading zeros) | operator tooling | exact text kept; preview shows barcodes; documented warning (lost zeros cannot be recovered) | 13 (residual, documented) |
