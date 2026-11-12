# ALKHAYR — HTTP API Contract (v1)

Status: **Specified in stage 00; no endpoint implemented yet.** Each feature stage updates the
"Implemented in" column only after its tests pass.

## 1. Conventions
- Business routes under `/api/v1`. JSON only (`Content-Type: application/json; charset=utf-8`),
  except CSV export.
- Every response carries `X-Request-Id`; error bodies include it.
- Never returned anywhere: password_hash, TOTP secret/ciphertext, session token, csrf secret,
  APP_SECRET/BACKUP_KEY, raw IP.
- IDs are UUIDs. Money fields end in `Cents` and are integers (piasters).
- Unknown JSON fields are **rejected** (`strict` schemas) — prevents mass assignment of
  `role`, `status`, `merchantId`, prices, totals.
- Pagination: cursor-based. `?limit=` (1–100, default 25) and opaque `cursor` (base64url of
  `createdAt|id`, HMAC-signed and bound to the caller). Response: `{ items, nextCursor|null }`.
- Optimistic concurrency: mutable resources expose `version`; updates require `expectedVersion`.
- Mutations (POST/PATCH/DELETE) require: `X-CSRF-Token` header, exact `Origin` == `APP_ORIGIN`,
  `Content-Type: application/json`.
- Unknown `/api/*` path → 404 JSON (never the SPA index).

## 2. Error envelope
```json
{ "error": { "code": "ORDER_STATE_CONFLICT", "message": "رسالة عربية آمنة", "requestId": "…",
             "details": { "fields": [{"path":"items.0.cartons","message":"…"}] } } }
```
| HTTP | code(s) | meaning |
|---|---|---|
| 400 | `BAD_REQUEST`, `VALIDATION_FAILED`, `INVALID_JSON` | malformed or invalid input |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `SESSION_EXPIRED` | no/invalid session or failed login (generic) |
| 403 | `FORBIDDEN`, `CSRF_FAILED`, `ORIGIN_REJECTED`, `ACCOUNT_PENDING`, `ACCOUNT_SUSPENDED` | authenticated but not allowed |
| 404 | `NOT_FOUND` | also used for resources the caller may not see (no existence leak) |
| 409 | `VERSION_CONFLICT`, `ORDER_STATE_CONFLICT`, `INSUFFICIENT_STOCK`, `PRICE_CHANGED`, `IDEMPOTENCY_KEY_REUSED`, `DUPLICATE` | concurrency/business conflict; body includes current state where safe |
| 413 | `PAYLOAD_TOO_LARGE` | body limit exceeded while streaming |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | |
| 422 | `BUSINESS_RULE`, `MINIMUM_ORDER_NOT_MET`, `AMOUNT_LIMIT_EXCEEDED`, `MIXED_DEMO_ITEMS`, `CATALOG_LIMIT` | valid shape, violates rule |
| 428 | `RECENT_AUTH_REQUIRED` | admin must re-enter password + TOTP (D-008) |
| 429 | `RATE_LIMITED` | includes `Retry-After` |
| 500 | `INTERNAL` | no stack traces or SQL in body |
| 503 | `UNAVAILABLE` | shutting down / DB busy beyond timeout |

## 3. Endpoints

Auth column: V=visitor, P=pending trader, A=approved trader, D=admin; R = recent auth (≤15 min) required.

| Method & path | Auth | Purpose | Stage |
|---|---|---|---|
| GET `/healthz` | V | `{status:"ok"}` + DB reachability; no versions/paths | 01 |
| GET `/api/v1/auth/csrf` | V | session-bound token, or signed 10-min pre-login challenge | 04 |
| POST `/api/v1/auth/register` | V | creates **pending trader only**; generic duplicate response | 04 |
| POST `/api/v1/auth/login` | V | `{username,password,totp?}`; rotates session; sets `__Host-alkhayr_session` | 04 |
| POST `/api/v1/auth/logout` | P/A/D | revoke session; 200 only if revocation committed | 04 |
| GET `/api/v1/auth/me` | P/A/D | `{user:{id,username,role}, merchant:{status,…}, session:{idleExpiresAt,recentAuthUntil}}` | 04 |
| POST `/api/v1/auth/password` | P/A/D | current pw (+TOTP admin) + new pw; revokes **all** sessions | 04 |
| POST `/api/v1/auth/reauth` | D | password + TOTP → refresh `auth_at` | 04 |
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

No backup, restore, admin-creation, password-reset or MFA-reset HTTP endpoints exist (CLI only).
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
