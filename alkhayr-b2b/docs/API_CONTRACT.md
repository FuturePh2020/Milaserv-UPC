# ALKHAYR — HTTP API Contract (v1)

Status: **Specified in stage 00. Implemented so far: `GET /healthz` (01), `GET /readyz` (02), the error envelope, 404/405, request-target/Host validation, the six `/api/v1/auth/*` endpoints with sessions, CSRF, Origin/Fetch-Metadata checks and rate limits (04), the merchant lifecycle endpoints (05), product administration plus the approved catalog (06), and inventory reads/adjustments with the ledger (07). No order endpoint exists yet.** Each feature stage updates the
"Implemented in" column only after its tests pass.

## 1. Conventions
- **Canonical paths.** Every business route is under the single prefix `/api/v1`. Shorthand such as
  "`/auth/login`" in reports or decision notes always means `/api/v1/auth/login`; no unprefixed aliases
  exist and none will be added (an alias could diverge from the protections tested on the canonical
  path). Unprefixed paths such as `/auth/login` return 404 (D-061).
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
| 409 | `VERSION_CONFLICT` | `expectedVersion` is stale; `details.current` holds the current safe state (own profile, or `{status, version}` for administrators) — UI: show it and let the user retry |
| 409 | `INVALID_STATE_TRANSITION` | merchant status change not allowed from the current state (incl. "no change"); `details.current` = `{status, version}` |
| 403 | `ADMIN_ACCOUNT_PROTECTED` | administrator accounts cannot be suspended/demoted through merchant controls |
| 409 | `CREDENTIALS_CHANGED` | password change lost a race with another credential change — UI: sign in again |
| 405 | `METHOD_NOT_ALLOWED` | known path, wrong method; `Allow` header set |
| 413 | `PAYLOAD_TOO_LARGE` | body limit exceeded while streaming (`Connection: close`) |
| 414 | `URI_TOO_LONG` | request target > 2048 bytes |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | |
| 422 | `BUSINESS_RULE`, `MINIMUM_ORDER_NOT_MET`, `AMOUNT_LIMIT_EXCEEDED`, `MIXED_DEMO_ITEMS`, `CATALOG_LIMIT` | valid shape, violates rule (`CATALOG_LIMIT`: 5000 products reached) |
| 409 | `IDEMPOTENCY_KEY_REUSED` | an operation key already used by this administrator for a DIFFERENT request (product, type, amount, reason, reference or expectedVersion) |
| 422 | `NO_CHANGE`, `INVENTORY_NEGATIVE`, `INVENTORY_BELOW_RESERVED`, `INVENTORY_LIMIT` | inventory adjustment would change nothing / make on_hand < 0 / make on_hand < reserved / exceed 1 000 000 000; `details.current.product` holds the current record |
| 409 | `DUPLICATE` | unique value already used (e.g. product barcode); `details.fields[0].path` names the field |
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

| GET `/api/v1/merchant/profile` | P/A/D | `{profile:{id,status,businessName,contactName,email,phone,governorate,address,version,updatedAt}}` of the session's own merchant. **No query parameters accepted** (400); no id in the path. | **05 ✅** |
| PATCH `/api/v1/merchant/profile` | P/A/D (session token) | `{expectedVersion, businessName?, contactName?, email? (""/null clears), phone?, governorate?, address?}` (strict; at least one field). Same normalization as registration. Never changes status, role, credentials or access. 200 → `{profile}`; stale → `409 VERSION_CONFLICT` with `details.current.profile`. | **05 ✅** |
| GET `/api/v1/products` | A/D (approved merchant or admin) | Active products **in active categories** only (stage 12). Query (strict): `q` (1–80; literal substring of name/brand, or exact barcode), `category` (id from the database), `brand` (exact), `sort∈{name,newest,price_asc,price_desc}` (default name), `limit` 1–100 (25), `cursor`. → `{items:[CatalogProduct], nextCursor}` | **06 ✅** |
| GET `/api/v1/products/:id` | A/D | `{product: CatalogProduct}`; inactive product, product in an inactive category (stage 12), unknown and malformed ids → identical 404 | **06 ✅** |
| GET `/api/v1/catalog/filters` | A/D | `{categories:[{id,labelAr,productCount}], brands:[{name,productCount}]}` — categories from `product_categories` (active), counts and brands only from active products in active categories (≤ 500 brands; stage 12) | **06 ✅** |
| POST `/api/v1/orders` | A/D (session token) | Strict: `{requestKey (UUID v4), note? (≤ 500, NFC-trimmed; blank → null), items:[1–100 × {productId, cartons 1–100000, expectedCartonPriceCents, expectedPackSize}]}`. For the session's **own** merchant only (administrators: their own approved profile). → **201** `{replayed:false, order:Order}`; identical retry → **200** `{replayed:true, order:<original>}`. Details §3c. Limit 30 attempts / 10 min / merchant. | **08 ✅** |
| POST `/api/v1/orders/quote` | A/D (session token) | **Read-only checkout preview (stage 11).** Strict `{items:[1–100 × {productId, cartons, expectedCartonPriceCents, expectedPackSize}]}` (no key, note, ids or amounts; 100-line limit first; 32 KiB). Same rules and errors as order creation (shared `evaluateOrderLines`). → `200 {quote:{items:[{lineNo, productId, name, brand, packSize, cartonPriceCents, cartons, lineTotalCents}], amounts:{…as Order.amounts}, minimumOrderMet, isDemo, quotedAt}}`. Writes nothing, reserves nothing, is not a price lock. Limit 60 / 10 min / merchant (`order_quote_account`). | **11 ✅** |
| GET `/api/v1/orders` | A/D | Own finalized orders, newest first. Query (strict): `state∈{pending,confirmed,preparing,shipped,delivered,cancelled}`, `limit` 1–100 (25), `cursor` (bound to user, merchant and `state`). → `{items:[{id, displayNumber, state, isDemo, lineCount, cartonCount, totalCents, createdAt, updatedAt}], nextCursor}` | **08 ✅** |
| GET `/api/v1/orders/:id` | A/D | `{order:Order}`; foreign, unfinished, unknown and malformed ids → identical 404 | **08 ✅** |
| GET `/api/v1/orders/:id/summary` | A/D(own) | print data; labeled not a tax invoice — **deferred to stage 14** (no route yet) | 14 |
| GET `/api/v1/admin/merchants` | D (live admin session; recency not required, D-063) | Query (strict, each at most once): `status∈{pending,approved,suspended}`, `q` (1–80 chars; literal match on business/contact name, username, email, phone), `sort∈{newest,oldest,name}` (default newest), `limit` 1–100 (default 25), `cursor`. → `{items:[{…profile, username, role, createdAt, statusChangedAt}], nextCursor}`. Keyset pagination on (sort key, id); cursor HMAC-bound to admin, sort and filters. | **05 ✅** |
| GET `/api/v1/admin/merchants/:id` | D | `{merchant, statusHistory:[{from,to,reason,at,actor}]}` (last 20). Unknown/malformed id → 404. | **05 ✅** |
| PATCH `/api/v1/admin/merchants/:id` | D R (session token) | `{status, expectedVersion, reason?}` (strict). Transitions in §4a. → `{merchant, sessionsRevoked}`. Approval creates no session and sends nothing. Administrator targets → `403 ADMIN_ACCOUNT_PROTECTED`. | **05 ✅** |
| GET `/api/v1/admin/products` | D | All products. Query as the catalog plus `active∈{true,false}`, `demo∈{true,false}`, `sort` also `oldest` (default newest). → `{items:[AdminProduct], nextCursor}` | **06 ✅** |
| GET `/api/v1/admin/products/:id` | D | `{product: AdminProduct}` | **06 ✅** |
| POST `/api/v1/admin/products` | D R (session token) | Strict: `{name, brand, category, barcode?, imageUrl?, cartonPriceCents, packSize, minimumCartons, isDemo?}`. Server sets id, `active=false`, `on_hand=reserved=0`, version 1, timestamps. → `201 {product}`. Errors: `DUPLICATE` (barcode), `CATALOG_LIMIT`, `VALIDATION_FAILED` (incl. unknown/inactive category, `isDemo` in production). Opening stock is a stage-07 inventory operation. | **06 ✅** |
| PATCH `/api/v1/admin/products/:id` | D R (session token) | Strict: `{expectedVersion, name?, brand?, category?, barcode? (null clears), imageUrl? (null clears), cartonPriceCents?, packSize?, minimumCartons?, active?}`. **No stock, reservation, demo, id, version or timestamp fields.** Changed fields only; version +1; nothing changed → 200 with the same version. Stale → `409 VERSION_CONFLICT` with `details.current.product`. No DELETE exists (405). | **06 ✅** |
| POST `/api/v1/admin/products/import` | D R | normalized rows, mode, operationKey, stockPolicy | 13 |
| GET `/api/v1/admin/inventory` | D (live admin session) | All products incl. inactive. Query (strict): `q` (literal name/brand or exact barcode), `category`, `active∈{true,false}`, `status∈{out_of_stock,low_stock,normal}`, `sort∈{name,available_asc,available_desc,updated}` (default name), `limit` 1–100, `cursor` (bound to admin, sort, filters and the current threshold). → `{items:[{product:{id,name,brand,category,barcode,active,isDemo}, onHand, reserved, available, status, statusLabelAr, version, updatedAt}], nextCursor}` | **07 ✅** |
| POST `/api/v1/admin/inventory/:id/adjustments` | D R (session token) | One of (strict): `{type:"receipt", quantity≥1}` · `{type:"correction_delta", delta≠0}` · `{type:"set_total", total≥0}`, each with `expectedVersion`, `operationKey` (UUID v4), `reason` (3–300), `reference?` (1–100). No reserved/available/balances/order/actor fields. → **201** `{replayed:false, operation:LedgerEntry, product:InventoryItem}`; identical retry → **200** `{replayed:true, operation:<original>, product:<current>}`; never activates a product. | **07 ✅** |
| GET `/api/v1/admin/inventory/:id/ledger` | D | `{product:InventoryItem, items:[LedgerEntry], nextCursor}`, newest first; `limit` 1–100, `cursor` bound to admin and product. LedgerEntry = `{id, productId, kind, adjustmentType, onHandDelta, reservedDelta, onHandAfter, reservedAfter, availableAfter, reason, reference, orderId, actor, productVersionAfter, createdAt}`. No update/delete routes (405). | **07 ✅** |
| GET `/api/v1/admin/orders` | D (live admin session) | All finalized orders. Query (strict): `state`, `merchantId`, `q` (exact display number, case-insensitive, or literal substring of the buyer business name), `demo∈{true,false}`, `sort∈{newest,oldest}`, `limit` 1–100, `cursor` (bound to admin, sort, filters). → `{items:[{id, displayNumber, merchantId, buyerBusinessName, buyerGovernorate, state, version, isDemo, lineCount, totalCents, createdAt, updatedAt}], nextCursor}` | **09 ✅** |
| GET `/api/v1/admin/orders/:id` | D | `{order: AdminOrder}` (§4) | **09 ✅** |
| POST `/api/v1/admin/orders/:id/transitions` | D R (session token) | Strict `{to, expectedVersion, operationKey (UUID v4), reason? (3–300; required for cancelled)}`; 4 KiB. → **201** `{replayed:false, operation, order}`; identical retry → **200** `{replayed:true, operation:<original>, order:<current>}` (§4) | **09 ✅** |
| GET/PATCH `/api/v1/admin/settings` | D, PATCH R | settings with version | 14 |
| GET `/api/v1/admin/reports/overview` | D | DB-wide metrics (demo/cancelled excluded from value) | 14 |
| GET `/api/v1/admin/exports/orders.csv` | D R | formula-safe CSV, bounded (≤ 10,000 rows per request, date range) | 13 |
| GET `/api/v1/admin/audit` | D | audit log, cursor | 12 |

No database-maintenance (init/migrate/status), backup, restore, admin-creation, password-reset or MFA-reset HTTP endpoints exist; these are operator CLI commands (`dist/server/cli.js`). HTTP requests never create or alter schema (runtime connection authorizer, DATABASE.md §1).
No legacy `action`-style endpoint (BUILD_NEW, no old client).

## 3a. Product representations (stage 06)
- **CatalogProduct** (traders): `{id, name, brand, category:{id,labelAr}, barcode, imageUrl, cartonPriceCents, packSize, minimumCartons, availability:{status: out_of_stock|low_stock|normal, labelAr}, isDemo}`. No physical/reserved/available numbers, versions, timestamps or audit data. Status = `available` (on_hand − reserved, computed) against `business_settings.low_stock_threshold_cartons`.
- **AdminProduct**: CatalogProduct fields minus `availability`, plus `active`, `stock:{onHand, reserved, available}` (available computed), `version`, `createdAt`, `updatedAt`.
- Money is the integer **carton** price in piasters (`cartonPriceCents`). Per-piece price is not returned: it is informational, computed by the UI for display only (`cartonPriceCents / packSize`); orders are always in whole cartons.
- `barcode`: `null` = none; `""` invalid; exact text (case and leading zeros kept). `imageUrl`: `null` or an https URL without credentials, stored canonically; the server never fetches it.

## 3b. Inventory adjustments (stage 07)
Processing order inside ONE write transaction: re-validate administrator (session, role, recent auth) →
look up `(administrator, operationKey)`: same digest → replay the committed operation (no new movement,
ledger or audit row; works even if the product version moved on since), different digest → 409
`IDEMPOTENCY_KEY_REUSED` → load product, compare `expectedVersion` (409 `VERSION_CONFLICT` with
`details.current.product`) → compute delta (`set_total`: target − on_hand) → reject 0 / < 0 / < reserved /
> 1e9 → insert ledger row → update product (`on_hand`, `version`+1, `last_ledger_id`) `WHERE version =
expectedVersion` → audit `inventory.adjusted`. Any failure rolls back all of it, and the key stays unused.
Digest = SHA-256 of `["inventory.adjustment.v1", productId, type, amount, reason, reference|null, expectedVersion]`.

## 3c. Orders (stage 08)
**Order** = `{id, displayNumber (AK-YYMMDD-XXXXXX), state, version, isDemo, note, requestKey,
buyer:{businessName, contactName, phone, governorate, address}, items:[{lineNo, productId, name, brand,
barcode, packSize, cartonPriceCents, cartons, lineTotalCents}], amounts:{subtotalCents, shippingCents,
shippingTaxable, taxBps, taxBaseCents, taxCents, totalCents, minimumOrderCents}, events:[{fromState,
toState, at}], createdAt, updatedAt}` — built **only from the order's snapshots**, never from current
product, profile or settings rows. No request digest, merchant/user ids, stock numbers or revenue figures.

Rejected in the body (400): any merchant/user/actor/buyer, state, amount, tax, shipping, reservation, demo,
display-number or version field; unknown line fields; numeric strings, fractions, values beyond the
ranges, non-finite numbers; duplicate `productId` lines (`items.N.productId`); more than 100 lines (checked
before any other validation: single error `items`). Body limit 32 KiB.

Processing (ONE write transaction): re-validate session and approval at commit and compare the merchant's
`access_version` with the value read at request start (`409 ACCESS_CHANGED`) → idempotency lookup by
`(merchant, requestKey)`: same digest → replay original order (even if prices, stock, profile or settings
have since changed); different → `409 IDEMPOTENCY_KEY_REUSED` → product rules → amounts → minimum order →
insert header, items (client line order = `lineNo`), creation event, audit `order.created`. Any failure
rolls back everything and leaves the key unused. Digest = SHA-256 of `["order.create.v1", note|null,
lines sorted by productId: [productId, cartons, expectedCartonPriceCents, expectedPackSize]]`; line order
alone does not make a request different.

| Rule (in this order) | Error |
|---|---|
| Product missing, inactive, or its category inactive (indistinguishable) | `409 PRODUCT_UNAVAILABLE`, `fields: items.N.productId`, `current.items:[{productId}]` |
| Demo products in production | `422 DEMO_NOT_ALLOWED` |
| Demo and real products mixed | `422 MIXED_DEMO_ITEMS` (an order is demo iff its products are) |
| Expected carton price differs | `409 PRICE_CHANGED`, `current.items:[{productId, cartonPriceCents, packSize}]` |
| Expected pack size differs (price equal) | `409 PACKAGING_CHANGED`, same `current` |
| Cartons below the product minimum | `422 MINIMUM_QUANTITY_NOT_MET`, `current.items:[{productId, minimumCartons}]` |
| Cartons above available (`on_hand − reserved`) | `409 INSUFFICIENT_STOCK`, `current.items:[{productId, availability:{status, labelAr}}]` — **no counts** |
| Subtotal or total above 1e13 piasters | `422 AMOUNT_LIMIT_EXCEEDED` (never clamped) |
| Subtotal below `minimum_order_cents` | `422 MINIMUM_ORDER_NOT_MET`, `current:{minimumOrderCents, subtotalCents}` |

Amounts (BigInt): `line = cartonPrice × cartons`; `subtotal = Σ lines`; `taxBase = subtotal + (shippingTaxable ?
shipping : 0)`; `tax = ⌊(taxBase × taxBps + 5000) / 10000⌋` (half-up; amounts are non-negative);
`total = subtotal + shipping + tax`. Settings and buyer data are snapshotted at creation. Creating a
pending order changes no stock, reservation, ledger row or product version.

## 3d. Checkout quote vs order (stage 11)
- The quote evaluates the proposed lines with the **same function** as `POST /orders`
  (`evaluateOrderLines`: product/category availability, demo rules, expected price and packaging, minimum
  quantity, available stock as status only, settings, BigInt amounts and limits). It differs only in
  reporting `minimumOrderMet` instead of refusing, and in writing nothing.
- A quote is evidence of the terms at `quotedAt` only. Prices, settings and stock can change afterwards;
  `POST /orders` re-checks everything and stores its own snapshots. No price is reserved and no stock is
  held by a quote.
- Gap closed: before stage 11 a merchant had no way to see the configured shipping, tax and minimum
  order before submitting (only after, in the order snapshot). The settings themselves are still not
  exposed through any broad configuration endpoint.

## 4a. Merchant status transitions (PATCH /api/v1/admin/merchants/:id)
| from \ to | pending | approved | suspended |
|---|---|---|---|
| pending | ✘ (no change) | ✔ reason optional | ✔ reason required · sessions revoked |
| approved | ✔ reason required · sessions revoked (access removed) | ✘ | ✔ reason required · sessions revoked |
| suspended | ✔ reason required | ✔ reason required | ✘ |

Every accepted change: one transaction re-validates the administrator (session, role, recent auth),
re-reads the target, checks `expectedVersion`, updates `status`, `version`+1, `access_version`+1 and
`status_changed_at`, deletes the target's sessions when access is removed, and writes
`merchant.status_changed` `{from, to, reason?, sessions_revoked, version}`. Any failure rolls back all of it.
Reason: 3–200 characters, stored in the audit log and shown in the merchant's status history.

## 4. Order status transitions (POST /api/v1/admin/orders/:id/transitions)
| from \ to | confirmed | preparing | shipped | delivered | cancelled |
|---|---|---|---|---|---|
| pending | ✔ reserve all lines (approved buyer) | ✘ | ✘ | ✘ | ✔ no stock effect |
| confirmed | ✘ | ✔ no movement (approved buyer) | ✘ | ✘ | ✔ release this order's allocations |
| preparing | ✘ | ✘ | ✔ deduct on_hand and reserved, consume allocations (approved buyer) | ✘ | ✔ release |
| shipped | ✘ | ✘ | ✘ | ✔ no movement (any buyer status) | ✘ |
| delivered / cancelled | ✘ | ✘ | ✘ | ✘ | ✘ |

Body: strict `{to, expectedVersion, operationKey, reason?}`; actor, merchant, prices, totals, stock,
quantities, source state and any other field → 400. `reason` required for `cancelled`.

Processing (ONE write transaction, no awaits): re-validate administrator (session, role, recent auth) →
look up `(administrator, operationKey)` in `order_events`: same digest → **200 replay** of the original
operation (works even if the order advanced since; nothing reapplied), different digest or order → `409
IDEMPOTENCY_KEY_REUSED` → order (404 if unknown/unfinished) → `expectedVersion` (`409 VERSION_CONFLICT`,
`details.current.order {state, version}`) → state machine (`409 ORDER_STATE_CONFLICT`, same details) →
buyer approved for confirm/prepare/ship (`409 BUYER_NOT_APPROVED`, `details.current.buyerStatus`) →
confirmation checks: product and category active (`409 CONFIRM_PRODUCT_UNAVAILABLE`), pack size equal to
the snapshot (`409 CONFIRM_PACKAGING_CHANGED`, `{productId, lineNo, orderedPackSize, currentPackSize}` —
cancel and let the trader re-order; quantities are never reinterpreted), availability (`409
CONFIRM_STOCK_INSUFFICIENT`, `{productId, lineNo, requested, available}` — counts shown to administrators
only) → per line ledger row + allocation + product update → event (reason, key, digest, version after) →
order update `WHERE version = expectedVersion` → audit `order.transitioned`. Any failure rolls back
everything; the key stays unused.
Digest = SHA-256 of `["order.transition.v1", orderId, to, expectedVersion, reason|null]`. Operation-key
namespace: per administrator, separate from inventory adjustment keys.

**operation** = `{eventId, fromState, toState, orderVersionAfter, reason, actor, at}` (the committed
operation). **order** = AdminOrder as it is now: the trader Order fields (§3c, snapshots unchanged) plus
`merchant {id, username, currentStatus, currentBusinessName}`, per item `allocation {status, quantity,
outstanding} | null` and `currentProduct {active, packSize, onHand, reserved, available}`, `events [{id,
fromState, toState, reason, versionAfter, actor, at}]`, `allowedTransitions`. No digests.
Traders' own-order views keep `events [{fromState, toState, at}]` (no administrator names or reasons).

Product PATCH: `packSize` while the product has stock or reservations → `409 PACKAGING_LOCKED` with
`details.current.product` (empty it with a traceable adjustment first; other fields stay editable).

## 5. Stage 12 note: inactive categories in the trader catalog
Before stage 12 a product whose category was inactive stayed visible in the trader catalog while ordering it
was refused (`PRODUCT_UNAVAILABLE`). Now the trader list, search, brand filter, counts and detail exclude such
products (detail answers the same 404 as a missing product; `?category=<inactive id>` keeps the existing 400
`VALIDATION_FAILED`). Administrator product and inventory views still include them. Order snapshots,
reservations and fulfillment are unchanged (confirmation of an order containing such a product is still
refused with `CONFIRM_PRODUCT_UNAVAILABLE`). Covered by `tests/integration/products.test.ts` ("inactive categories").

## 6. CSV imports (stage 13)
Administrator only. Four separate modes; a mode is never inferred from which columns are filled. Product
changes and stock movements are never mixed in one file.

| Route | Auth | Contract |
|---|---|---|
| GET `/api/v1/admin/imports/templates/{mode}.csv` | D (live admin session) | Header-only template: UTF-8 with BOM, CRLF, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control: no-store`. No example rows (they would be imported by mistake). Unknown names → 404 |
| POST `/api/v1/admin/imports/preview` | D + session CSRF + exact Origin; `import_preview_account` 30/10 min | Strict JSON ≤ 2 MiB: `{mode, file}` (`file` = the exact file bytes, base64, ≤ 1 MiB decoded; more → 413). **Writes nothing** (no product, ledger, audit or import row). → 200 `{mode, file:{bytes, sha256}, summary:{records, valid, invalid}, fileErrors:[{field,message}], rows:[RowReport], previewToken, expiresAt}`. `previewToken`/`expiresAt` are null unless there are no errors at all |
| POST `/api/v1/admin/imports/commit` | R (recent admin) + session CSRF + exact Origin; `import_commit_account` 20/10 min | Strict JSON ≤ 2 MiB: `{mode, file, previewToken, operationKey}` (UUID v4). → 201 `{replayed:false, import}` or 200 `{replayed:true, import}` (identical retry). `import = {id, mode, status:'committed', recordCount, fileBytes, contentSha256, createdAt, items:[{recordNo, line, productId, productName, ledgerId, productVersionAfter}]}` |

At most two uploads are decoded/parsed/evaluated at once per process; a third gets 503 `IMPORT_BUSY`
(`Retry-After: 5`). No database transaction is open while a body is read or parsed.

**RowReport**: `{recordNo, line, status:'ok'|'error', productId, productName, errors:[{field, message}], warnings:[…], change}`.
`line` is the physical line where the record starts (multiline records keep their first line). `productName` is the
CURRENT name from the database (update/stock modes) — informational, never an identifier. `change`:
create `{product:{…, cartonPriceCents, category:{id,labelAr}}, active:false, onHand:0}`; update
`{version, changes:[{field, from, to}]}`; stock `{version, onHandBefore, delta, onHandAfter, reserved, availableAfter}`.

### 6a. Header contract (exact, case-sensitive; order free; no other columns)
| Mode | Required columns | Optional columns |
|---|---|---|
| `create_products` | `name, brand, category, cartonPriceEgp, packSize, minimumCartons` | `barcode, imageUrl` |
| `update_products` | `productId, expectedVersion` (+ at least one changeable column) | `currentName, name, brand, category, cartonPriceEgp, packSize, minimumCartons, barcode, imageUrl` |
| `receive_stock` | `productId, expectedVersion, quantity, reason` | `currentName, reference` |
| `set_stock_total` | `productId, expectedVersion, total, reason` | `currentName, reference` |

There are no stock, reserved, active, demo, version-to-set, actor or role columns: any such header is an
unknown header (file error). Field names are the API's except `cartonPriceEgp` (decimal pounds, see below) and
`quantity`/`total` (the adjustment amounts).

- `category`: the stable category id (e.g. `chocolate`), never the Arabic label; must exist and be active. No
  fuzzy matching of categories or brands.
- `productId`: the product UUID; products are never matched by name. A product id may appear once per file.
- `expectedVersion`: the product's current version. A different version is a record error ("changed since").
- `currentName` (optional): if non-empty and different from the current name, the record gets a WARNING only.
- **Update convention:** an empty cell = unchanged; the exact token `__CLEAR__` clears an optional field
  (`barcode`, `imageUrl`) to null; `__CLEAR__` in a required field is an error. A row that changes nothing is an
  error. `packSize` cannot change while the product has stock or reservations (`PACKAGING_LOCKED` rule). Demo
  classification and activation cannot be changed by import.
- `barcode`: kept exactly (case, leading zeros); empty (create) = null; same rules as the API (1–32 of `0-9A-Za-z-`).
  Unique in the file and in the database (a barcode currently held by another product is refused even if that
  product changes it in the same file).
- Create: products are created **inactive with zero stock**, not demo, with all API validation and the 5,000
  catalog cap (counted inside the commit transaction).
- `receive_stock`: `quantity` whole cartons ≥ 1. `set_stock_total`: `total` whole cartons ≥ 0 that REPLACES the
  physical total; refused if below reserved or equal to the current total; reserved never changes. `reason` 3–300
  characters, `reference` optional 1–100.

### 6b. Parsing conventions
UTF-8 only (one leading BOM allowed and removed); invalid UTF-8 and NUL bytes are rejected, never replaced. LF or
CRLF record ends; a bare CR is an error. RFC-4180 quoting: a quoted field starts with `"`, `""` is a literal quote,
quoted fields may contain commas and line breaks; a quote inside an unquoted field, text after a closing quote
and an unterminated quote are errors. Completely empty lines (anywhere, including trailing) are ignored; a line of
commas is a record (and an "empty row" error). Cells are kept exactly (no trimming of barcodes; text fields are
normalized like the API: NFC + trim). Limits: 1 MiB file, 1,000 data rows, 4,096 characters per cell; every
record must have exactly as many cells as the header.
Numbers: whole numbers `^(0|[1-9][0-9]{0,9})$` (ASCII digits only — no sign, spaces, separators, decimals,
exponents, leading zeros, Arabic-Indic digits, `Infinity`/`NaN`). Money `cartonPriceEgp`: decimal Egyptian pounds
`^(0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?$`, converted to integer piastres with integer arithmetic; a third decimal,
thousands separators or a decimal comma are refused, never rounded or reinterpreted. Leading zeros already removed
by a spreadsheet program cannot be recovered.

### 6c. Confirmation, all-or-nothing and idempotency
The preview token is an HMAC (key derived from `APP_SECRET`, purpose `import_preview`) over
`{administrator, mode, SHA-256 of the exact file bytes, digest of the target products' versions seen, expiry}`;
it is valid 20 minutes. A checksum alone is not trusted: the confirmation re-sends the exact file, the server
re-parses it and checks the token's signature, administrator, mode, content digest and expiry.

Commit order (one `BEGIN IMMEDIATE` transaction): re-validate session, administrator role and recent
authentication → **idempotency** (`import_operations` by administrator + key: same request digest → the original
committed result, 200 `replayed:true`, even after the preview expired or versions moved on; different digest →
409 `IDEMPOTENCY_KEY_REUSED`) → preview binding (`IMPORT_PREVIEW_INVALID` 409 / `IMPORT_PREVIEW_EXPIRED` 409) → full
re-evaluation against the current data (any error → 422 `IMPORT_REJECTED` with `details.current = {fileErrors,
rows}` of the failing records; nothing written) → version digest (409 `IMPORT_PREVIEW_STALE`) → catalog cap → apply
every record with the SAME product/inventory cores as the single-record endpoints (product audit events per record;
one ledger row per stock record, with the administrator, reason, reference and resulting version; reserved never
changed) → import record and items → `import.committed` audit event. Any failure rolls everything back and does not
consume the key. The request digest is `SHA-256(["import.commit.v1", mode, fileSha256])`; the token is not part of it.

| Situation | Response |
|---|---|
| Preview expired, never confirmed | 409 `IMPORT_PREVIEW_EXPIRED` — nothing written; preview again |
| Confirmation definitely refused | 4xx (`IMPORT_REJECTED`, `IMPORT_PREVIEW_*`, `RECENT_AUTH_REQUIRED`, `VALIDATION_FAILED`, `RATE_LIMITED`…) — nothing written, key not consumed |
| Outcome unknown (no response, 5xx, malformed) | the client keeps key + exact body for a same-key retry; never retried automatically |
| Committed | 201 `replayed:false` |
| Identical committed retry | 200 `replayed:true` with the original result |

## 7. Business settings, quote terms and order summaries (stage 14)
| Route | Auth | Contract |
|---|---|---|
| GET `/api/v1/admin/settings` | D | `{settings:{company:{name,phone,email,address}, shippingCents, shippingTaxable, taxBps, minimumOrderCents, lowStockThresholdCartons, version, updatedAt, updatedBy}}` — business fields only (no secrets, cookies, auth policy, paths or deployment data). Absent company fields are `null`. |
| PATCH `/api/v1/admin/settings` | R + CSRF + Origin | Strict JSON ≤ 8 KiB: `{expectedVersion, companyName?, companyPhone?, companyEmail?, companyAddress?, shippingCents?, shippingTaxable?, taxBps?, minimumOrderCents?, lowStockThresholdCartons?}` (`null` clears a company field; integers only; unknown fields 400). One transaction: re-validate session/role/recency → version (409 `VERSION_CONFLICT` with current settings) → update (+1 version) → `settings.updated` audit (field names; before/after for shipping, taxable, tax, minimum, threshold; never free text). No change → no version bump. → `{settings, changedFields}` |
| GET `/api/v1/orders/:id/summary` | A (own merchant) | `{summary:{kind:'order_summary', order:{id, displayNumber, state, isDemo, note, createdAt, buyer, items, amounts}, company, companyIsCurrent:true, generatedAt}}` — snapshot data only; no administrator identities, reasons, stock, allocations, request key or version. Foreign/unknown → 404 |
| GET `/api/v1/admin/orders/:id/summary` | D | the same trader-safe document for any order |

**Financial settings apply to future quotes and orders only.** Orders keep their snapshot (`shipping_cents`,
`shipping_taxable`, `tax_bps`, `minimum_order_cents`, amounts). The tax rate is the operator's business choice.

**Quote → order terms binding.** `POST /api/v1/orders` now REQUIRES `expectedTerms: {shippingCents, shippingTaxable,
taxBps}` — the values the trader reviewed in the quote (`quote.amounts`). After the per-merchant idempotency check, a
mismatch with the current settings refuses the order with 409 `TERMS_CHANGED` (`details.current = {terms,
minimumOrderCents}`); the client re-quotes and the trader must submit again (new key). Amounts are always computed by
the server; client totals are never trusted; the quote is not a reservation or a price lock. A raised minimum is
still enforced (`MINIMUM_ORDER_NOT_MET`). `expectedTerms` is NOT part of the request digest: a committed identical
retry returns the original order (200 `replayed`) even after settings changed. Missing `expectedTerms` → 400.

## 8. Operational reports (stage 14)
GET, administrator only (D), strict query, one read transaction each. Money is returned as **decimal strings of
integer piastres** (exact beyond 2^53); counts as numbers.

**Dates:** `from`/`to` are calendar dates `YYYY-MM-DD` in **Africa/Cairo** (DST-aware). Range = first instant of
`from` (inclusive) to first instant of the day after `to` (exclusive), so `to` includes the whole day; ≤ 3 660 days.
The response echoes `range:{from, to, timeZone, startMs, endMsExclusive}`.

| Route | Definition |
|---|---|
| `/api/v1/admin/reports/orders?from&to[&merchantId][&demo=exclude|include|only]` | Orders whose **creation time** is in range, grouped by **current state** (all six states listed, zeros included; every order counts in exactly one state). Per state: `orders, subtotalCents, shippingCents, taxCents, totalCents` from the order snapshot. `notCancelled` = sum of the five non-cancelled states; cancelled orders are shown separately and never added to it. Demo orders excluded by default. These are ORDER VALUES — not collected revenue, paid sales, profit or receivables. |
| `/api/v1/admin/reports/products?from&to[&states=a,b][&demo]` | Order lines of orders created in range with the selected **current** states (default: all except cancelled): per product `orders` (distinct), `cartons` (ORDERED cartons, not shipped), `valueCents` (sum of historical line totals, no shipping/tax). Names are current product names. |
| `/api/v1/admin/reports/inventory[?status][&active]` | Current balances now: `onHand, reserved, available (= onHand − reserved), status` by the CURRENT low-stock threshold (0 → out_of_stock; 1..threshold → low_stock; above → normal); totals and counts per status. |
| `/api/v1/admin/reports/movements?from&to[&productId]` | Ledger rows whose **recording time** is in range, grouped by exact ledger type: `opening, receipt, correction:correction_delta, correction:set_total, correction, reserve, release, ship, import` (the last is an allowed kind, unused). Per type: `movements, products, onHandDelta, reservedDelta` (net cartons). |

`AGGREGATE_OVERFLOW` (422) if a sum exceeds 64-bit integers; never a rounded or wrapped value.

## 9. Exports and pre-filled templates (stage 14)
| Route | Auth | Contract |
|---|---|---|
| POST `/api/v1/admin/exports` | R + CSRF + Origin; `export_account` 20/10 min; ≤ 2 concurrent | Strict JSON ≤ 4 KiB: `{type, filters, includeBuyerContact?}`. Types: `products` (filters q/category/active, as the product list), `inventory` (status/active), `orders` (from/to required, state, merchantId, demo; summary columns; buyer contact name/phone/address ONLY with `includeBuyerContact: true`), `report_orders`, `report_products`, `report_movements` (same filters as the reports). → `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="alkhayr-<type>-<YYYYMMDD-HHmm>.csv"` (fixed ASCII pattern), `Cache-Control: no-store, private`. |
| POST `/api/v1/admin/imports/templates/prefilled` | same | `{mode: update_products|receive_stock|set_stock_total, filters:{q?, category?, active?, status?}}` → canonical stage-13 CSV (see below); header `X-Omitted-Display-Names` = number of `currentName` values left empty. |

Limits: at most **10 000 rows** and **8 MiB** per export (templates: 1 MiB, the import limit; ≤ 5 000 products by the
catalog cap). A request above a cap is refused with 422 `EXPORT_TOO_LARGE` (`details.current.rows/maxRows` or
`maxBytes`) — never truncated; narrow the range or filters. Rows and totals come from one read transaction; the
audit event `export.created` (`type`, a ≤ 400-character JSON of the filters, `rows`, `bytes`, `contact_data`) is
written after re-checking the session, role and recent authentication, before the file is sent. No content is logged.

**Two formats:**
- **View exports** (all of `/admin/exports`): every cell quoted (RFC 4180), UTF-8 BOM, CRLF, Arabic headers, money as
  decimal pounds `1234.50`, Cairo times `YYYY-MM-DD HH:mm`. Text cells that a spreadsheet could treat as a formula
  — first character after any leading whitespace/control characters is `= + - @` or full-width `＝ ＋ － ＠`, or the cell
  starts with a tab or carriage return — are prefixed with `'` in the FILE only (stored data unchanged). Server-generated
  numeric cells are never prefixed. **Not a re-import format**; the importer never strips apostrophes (they may be
  legitimate data).
- **Canonical templates** (pre-filled): exact stage-13 headers (`IMPORT_COLUMNS`), values written exactly (quoted, no
  prefix): `productId`, `expectedVersion` (current), `currentName` (or EMPTY when formula-like — an optional display
  field is omitted rather than altered). Quantity, total, reason, reference and all update-change columns are EMPTY
  (nothing that looks like an approved quantity or count). Rows the operator does not fill must be deleted (a row
  without values is an import error). Templates become stale when a product or its stock changes.

## 10. Import history (stage 14)
| Route | Auth | Contract |
|---|---|---|
| GET `/api/v1/admin/imports?[mode][&limit][&cursor]` | D | committed batches newest first, signed keyset cursor bound to the administrator and filters: `{items:[{id, mode, recordCount, fileBytes, createdAt, actor}], nextCursor}` |
| GET `/api/v1/admin/imports/:id` | D | `{import:{id, mode, recordCount, fileBytes, createdAt, actor, items:[{recordNo, line, productId, productName, ledgerId, productVersionAfter}]}}` |
No operation keys, digests, content hashes, preview tokens or file content are returned. There is no "run again".
