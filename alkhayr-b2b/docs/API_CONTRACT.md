# ALKHAYR — HTTP API Contract (v1)

Status: **Specified in stage 00. Implemented so far: `GET /healthz` (01), `GET /readyz` (02), the error envelope, 404/405, request-target/Host validation, and the six `/api/v1/auth/*` endpoints with sessions, CSRF, Origin/Fetch-Metadata checks and rate limits (04). No catalog/order/admin business endpoint exists yet.** Each feature stage updates the
"Implemented in" column only after its tests pass.

## 1. Conventions
- Business routes under `/api/v1`. JSON only (`Content-Type: application/json; charset=utf-8`),
  except CSV export.
- Every response carries `X-Request-Id`; error bodies include it.
- Never returned anywhere: password_hash, TOTP secret/ciphertext, raw session token, keys,
  APP_SECRET/BACKUP_KEY, raw IP. (CSRF tokens are returned by design; they are HMACs, not secrets of record.)
- IDs are UUIDs. Money fields end in `Cents` and are integers (piasters).
- Unknown JSON fields are **rejected** (`strict` schemas) — prevents mass assignment of
  `role`, `status`, `merchantId`, prices, totals.
- Pagination: cursor-based. `?limit=` (1–100, default 25) and opaque `cursor` (base64url of
  `createdAt|id`, HMAC-signed and bound to the caller). Response: `{ items, nextCursor|null }`.
- Optimistic concurrency: mutable resources expose `version`; updates require `expectedVersion`.
- **Request boundary for every `/api/*` request** (before routing): if `Sec-Fetch-Site` is sent it must be
  `same-origin` (`none` also allowed for GET/HEAD) → else `403 ORIGIN_REJECTED`; the general per-IP limit
  applies (`429`).
- **Mutations (POST/PATCH/PUT/DELETE)** additionally require: `Origin` exactly equal to `APP_ORIGIN`
  (missing → 403), `Content-Type: application/json` (415), a body within the route limit (413; auth routes
  8 KiB), and `X-CSRF-Token`: the **pre-login token** for `/auth/login` and `/auth/register`, the
  **session-bound token** for every authenticated mutation (`403 CSRF_FAILED`). Plain same-origin GETs need
  no Origin. No CORS headers are ever sent.
- Authentication is **only** the session cookie (`__Host-alkhayr_session` in production,
  `alkhayr_session` in development/test). Headers such as `X-User-Role`, `X-Merchant-Id`, `Authorization`
  or ChatGPT/OpenAI identity headers are ignored.
- Unknown `/api/*` path → 404 JSON (never the SPA index). Unknown non-API paths → 404 JSON too:
  there is no index.html fallback (hash routing). Static files: only entries in the build manifest.
- Every request's `Host` header must equal the host of `APP_ORIGIN` (case-insensitive).

## 2. Error envelope
```json
{ "error": { "code": "ORDER_STATE_CONFLICT", "message": "رسالة عربية آمنة", "requestId": "…",
             "details": { "fields": [{"path":"items.0.cartons","message":"…"}] } } }
```
| HTTP | code(s) | meaning |
|---|---|---|
| 400 | `BAD_REQUEST`, `VALIDATION_FAILED`, `INVALID_JSON`, `HOST_REJECTED` | malformed input, traversal/encoded-separator paths, absolute-form targets, Host ≠ APP_ORIGIN host |
| 401 | `UNAUTHENTICATED` | no valid session (missing, expired, idle, revoked, suspended account, password changed) — UI: go to login |
| 401 | `INVALID_CREDENTIALS` | **every** login failure (unknown user, wrong password, wrong/missing/replayed TOTP, suspended, stale) — one identical body |
| 403 | `FORBIDDEN` | signed in but wrong role |
| 403 | `ACCOUNT_PENDING` | signed-in trader not yet approved |
| 403 | `CSRF_FAILED` / `ORIGIN_REJECTED` | missing/invalid CSRF token / foreign Origin or cross-site Fetch Metadata — UI: reload CSRF token |
| 403 | `REAUTH_FAILED` | password change: current password or administrator TOTP wrong |
| 404 | `NOT_FOUND` | also used for resources the caller may not see (no existence leak) |
| 409 | `VERSION_CONFLICT`, `ORDER_STATE_CONFLICT`, `INSUFFICIENT_STOCK`, `PRICE_CHANGED`, `IDEMPOTENCY_KEY_REUSED`, `DUPLICATE` | concurrency/business conflict; body includes current state where safe |
| 409 | `CREDENTIALS_CHANGED` | password change lost a race with another credential change — UI: sign in again |
| 405 | `METHOD_NOT_ALLOWED` | known path, wrong method; `Allow` header set |
| 413 | `PAYLOAD_TOO_LARGE` | body limit exceeded while streaming (`Connection: close`) |
| 414 | `URI_TOO_LONG` | request target > 2048 bytes |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | |
| 422 | `BUSINESS_RULE`, `MINIMUM_ORDER_NOT_MET`, `AMOUNT_LIMIT_EXCEEDED`, `MIXED_DEMO_ITEMS`, `CATALOG_LIMIT` | valid shape, violates rule |
| 428 | `RECENT_AUTH_REQUIRED` | administrator credentials older than 15 min for a privileged operation — UI: sign in again (`POST /auth/login` with password + fresh TOTP), then retry (D-008, D-052) |
| 429 | `RATE_LIMITED` | includes `Retry-After` |
| 500 | `INTERNAL` | no stack traces or SQL in body |
| 503 | `UNAVAILABLE`, `NOT_READY` | shutting down / DB busy / password-hashing capacity exceeded (`Retry-After: 5`); `NOT_READY` from `/readyz` only |

## 3. Endpoints

Auth column: V=visitor, P=pending trader, A=approved trader, D=admin; R = recent auth (≤15 min) required.

| Method & path | Auth | Purpose | Stage |
|---|---|---|---|
| GET `/healthz` | V | Liveness: `{status:"ok"}`; no database access; no versions/paths/uptime | **01 ✅** |
| GET `/readyz` | V | Readiness: `200 {status:"ready"}` when the configured database file is open, unchanged (same inode), answers a query and is at the required schema version; otherwise `503 NOT_READY` error envelope. Reveals no path, SQL, version, configuration or data. | **02 ✅** |
| GET `/api/v1/auth/csrf` | V/P/A/D | `{authenticated, csrfToken: session token or null, preLoginToken, preLoginExpiresAt}`; sets the 10-min pre-session cookie if absent | **04 ✅** |
| POST `/api/v1/auth/register` | V (pre-login token) | `{username, password, businessName, contactName, phone, governorate, address, email?}` (strict). **Always `202 {status:"received", message}`** for new and duplicate usernames; creates a pending trader + profile; no session, no messages sent. Limit 5/h/IP | **04 ✅** |
| POST `/api/v1/auth/login` | V (pre-login token) | `{username, password, totp?}` (`totp` for administrators). 200 → `{user:{id,username,role}, merchant:{status}, session:{expiresAt, idleTimeoutMinutes}, csrfToken}` + new session cookie; any presented session is destroyed; pre-session cookie cleared. Failure → `401 INVALID_CREDENTIALS`. Limits 20/15 min/IP, 5/15 min/username | **04 ✅** |
| POST `/api/v1/auth/logout` | session token if a valid session exists | Revokes the session, expires the cookie → `200 {loggedOut:true}`. If revocation cannot be committed → error (500/503), cookie kept, session still valid. Without a valid session: clears cookie, 200 | **04 ✅** |
| GET `/api/v1/auth/me` | P/A/D | `{user, merchant:{id,status,businessName,contactName,email,phone,governorate,address,version}, session:{absoluteExpiresAt, idleExpiresAt, recentAuthUntil|null}, csrfToken}` | **04 ✅** |
| POST `/api/v1/auth/password` | P/A/D (session token) | `{currentPassword, newPassword, totp?}` (fresh TOTP for administrators). 200 → `{passwordChanged:true, sessionsRevoked, reloginRequired:true}`; **all** sessions of the account revoked, cookie expired. Limit 5/15 min/account | **04 ✅** |

There is no `/auth/reauth` endpoint: re-authentication is a normal login (D-052). There is no
account-existence lookup, password-reset, MFA-reset or verification-email endpoint.

| GET/PATCH `/api/v1/merchant/profile` | P/A/D | own profile only; PATCH needs expectedVersion | 05 |
| GET `/api/v1/products` | A/D | catalog: `q, category, brand, sort∈{name,price_asc,price_desc,newest}`, cursor | 06 |
| GET `/api/v1/products/:id` | A/D | active product detail (trader sees `available` only if > 0 policy — stage 06) | 06 |
| POST `/api/v1/orders` | A/D | `{requestKey, note?, items:[{productId,cartons,expectedUnitPriceCents?}]}` | 08 |
| GET `/api/v1/orders` | A/D | own orders, cursor | 08 |
| GET `/api/v1/orders/:id` | A/D | own order + items + events | 08 |
| GET `/api/v1/orders/:id/summary` | A/D(own) | print data; labeled not a tax invoice | 08/14 |
| GET `/api/v1/admin/merchants` | D | queue: `status, q`, cursor | 05 |
| GET/PATCH `/api/v1/admin/merchants/:id` | D, PATCH R | `{status, expectedVersion}`; suspension revokes sessions; cannot touch admin accounts | 05 |
| GET/POST `/api/v1/admin/products` | D, POST R | list incl. inactive/demo; create (optional opening stock → ledger) | 06 |
| PATCH `/api/v1/admin/products/:id` | D R | metadata/price/active with expectedVersion; **no stock fields** | 06 |
| POST `/api/v1/admin/products/import` | D R | normalized rows, mode, operationKey, stockPolicy | 13 |
| GET `/api/v1/admin/inventory` | D | on_hand/reserved/available, low-stock filter | 07 |
| POST `/api/v1/admin/inventory/:id/adjustments` | D R | `{kind∈{receipt,correction,set_total}, quantity, reason, externalRef?, expectedVersion, operationKey}` | 07 |
| GET `/api/v1/admin/inventory/:id/ledger` | D | append-only movements, cursor | 07 |
| GET `/api/v1/admin/orders` | D | `state, merchantId, from, to, includeDemo`, cursor | 09 |
| GET `/api/v1/admin/orders/:id` | D | order, items, events | 09 |
| POST `/api/v1/admin/orders/:id/transitions` | D R | `{to, expectedVersion, note?}` | 09 |
| GET/PATCH `/api/v1/admin/settings` | D, PATCH R | settings with version | 14 |
| GET `/api/v1/admin/reports/overview` | D | DB-wide metrics (demo/cancelled excluded from value) | 14 |
| GET `/api/v1/admin/exports/orders.csv` | D R | formula-safe CSV, bounded (≤ 10,000 rows per request, date range) | 13 |
| GET `/api/v1/admin/audit` | D | audit log, cursor | 12 |

No database-maintenance (init/migrate/status), backup, restore, admin-creation, password-reset or MFA-reset HTTP endpoints exist; these are operator CLI commands (`dist/server/cli.js`). HTTP requests never create or alter schema (runtime connection authorizer, DATABASE.md §1).
No legacy `action`-style endpoint (BUILD_NEW, no old client).

## 4. Status transitions (POST …/transitions)
| from \ to | confirmed | preparing | shipped | delivered | cancelled |
|---|---|---|---|---|---|
| pending | ✔ reserve | ✘ | ✘ | ✘ | ✔ no stock effect |
| confirmed | ✘ | ✔ | ✘ | ✘ | ✔ release |
| preparing | ✘ | ✘ | ✔ deduct+release | ✘ | ✔ release |
| shipped | ✘ | ✘ | ✘ | ✔ | ✘ |
| delivered / cancelled | ✘ | ✘ | ✘ | ✘ | ✘ |

Illegal → `409 ORDER_STATE_CONFLICT` with current `state` and `version`.
Insufficient stock on confirm → `409 INSUFFICIENT_STOCK` with per-line `{productId, requested, available}`.
