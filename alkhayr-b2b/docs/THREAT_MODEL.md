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
| T1 | Credential stuffing / brute force on login | external | scrypt, per-account + per-IP rate limits, generic errors, admin TOTP | 03/04 |
| T2 | Admin TOTP replay or race | external w/ observed code | atomic last_otp_step guard | 04 |
| T3 | Self-registration as admin / mass assignment of role, status, prices | trader/visitor | strict schemas reject unknown fields; role only via CLI | 04/05 |
| T4 | IDOR: trader reads another's orders/profile | approved trader | ownership in SQL WHERE, 404 for foreign IDs, signed cursors | 05/08 |
| T5 | Pending/suspended trader sees prices or orders | trader | per-request status check; suspension revokes sessions | 05 |
| T6 | CSRF / cross-site mutation | malicious site | SameSite=Strict, exact Origin, CSRF token, JSON-only | 04 |
| T7 | Session theft/fixation | external | HttpOnly __Host cookie, rotation on login, idle/absolute expiry, hash-only storage | 04 |
| T8 | Forged identity headers (ChatGPT/role headers) | external | headers ignored; identity only from session | 04 |
| T9 | Price tampering in order request | trader | server-authoritative pricing; client prices only for stale detection | 08 |
| T10 | Overselling via concurrent confirmations | admins concurrently | BEGIN IMMEDIATE, guarded UPDATE `available >= qty`, all-or-nothing | 09 |
| T11 | Double order on retry/double click | trader/network | idempotency key + digest | 08 |
| T12 | Stale admin form overwrites stock/price | admin | expectedVersion, version bump on stock change | 06/07 |
| T13 | SQL injection via search/sort | any | parameters + allow-lists | 06 |
| T14 | Stored XSS via product names, notes, addresses | admin/trader | React escaping, no `dangerouslySetInnerHTML`, strict CSP | 10–12 |
| T15 | Malicious image URLs (javascript:, credentials, tracking) | admin | https-only validation, no userinfo, no-referrer, CSP img-src | 06 |
| T16 | CSV formula injection in exports | trader-controlled text | prefix `'` for cells starting (after trim/BOM/control) with = + - @ ; quote escaping | 13 |
| T17 | Oversized/abusive bodies, slowloris | external | streaming body limit, collection caps, server timeouts, proxy limits | 01/04 |
| T18 | Static file traversal (.env, DB, source) | external | explicit asset allow-list; data dir outside web root | 01 |
| T19 | Secrets leaked in logs/responses | bug | redaction, response schemas, tests scanning logs | 04/16 |
| T20 | Backup theft / tampering | host compromise / storage provider | AES-256-GCM with independent key, authenticated header, no HTTP endpoint | 15 |
| T21 | Restore reintroduces live sessions or mixes WAL | operator error | new target path only, sessions revoked, integrity checks | 15 |
| T22 | Dependency compromise | supply chain | minimal deps, lockfile, audit, no runtime CDN | 01/16 |
| T23 | Spoofed client IP to evade rate limits | external | XFF trusted only from configured proxy IPs | 04/17 |
| T24 | Direct access to Node port bypassing proxy | external | bind to 127.0.0.1 / internal network; compose exposes proxy only; Host check | 17 |
| T25 | Running two app instances on one SQLite file / NFS corruption | operator | documented single-instance constraint; startup lock file | 02/17 |
| T26 | Loss of only admin (lost TOTP device) | operator | CLI reset-mfa on trusted host; cannot suspend sole admin via UI | 03/05/15 |

## Accepted / residual risks (initial)
- SQLite data file not encrypted at rest (rely on host disk encryption).
- Single host = single point of failure; recovery via off-host encrypted backups (operator task).
- Login rate limiting allows temporary targeted lockout (availability vs. brute-force trade-off).
- Trader cart drafts in localStorage are readable by anyone with access to the device browser
  (contain no credentials or prices of record).
