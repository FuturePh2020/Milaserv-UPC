# ALKHAYR B2B — Product Specification (Stage 00 contract)

Status: **Contract established in stage 00. No feature code exists yet.**
Source of truth hierarchy: this file + DATABASE.md + API_CONTRACT.md + SECURITY.md override chat history.
The original Arabic blueprint is preserved verbatim in `docs/BLUEPRINT_AR.md`. Where this file is
more specific than the blueprint, the resolution is recorded in `DECISIONS.md`.

## 1. Product

ALKHAYR (الخير) is an independent Arabic (RTL) B2B wholesale ordering portal for an Egyptian
sweets and chocolate importer. Approved trader accounts browse a wholesale catalog priced per
carton and submit orders; administrators review merchants, manage products, inventory, orders and
business settings.

The portal **owns** its catalog, prices, inventory, merchant accounts and orders. It has no
dependency on ChatGPT, a POS, an ERP, another service's browser session or a vendor database.
Selling the same goods in another program does **not** change this portal's stock automatically.

Execution mode: **BUILD_NEW** (see DECISIONS.md D-001). No 2.0.1 source was supplied.

## 2. Release scope (core release)

| Area | Included |
|---|---|
| Trader registration & login | username + password; admin approval required before prices/orders |
| Administration | admin created locally via CLI only; TOTP mandatory; no default account/password |
| Catalog | products, HTTPS image URLs, brands, controlled categories, text barcodes, wholesale carton prices |
| Sales units | ordering in whole cartons; pieces-per-carton and per-piece price are informational |
| Inventory | on_hand, reserved, available; receipts/corrections with mandatory reason |
| Orders | cart → submit → review → confirm → prepare → ship → deliver; cancel before shipment |
| CSV import/export | UTF-8, full validation, spreadsheet-formula protection |
| Company settings | name, address, contact, fixed shipping, tax basis points, minimum order |
| Reports | order/inventory indicators computed from the whole DB; demo data separated |
| Print | order summary, explicitly **not** a tax invoice |
| Security | authorization, sessions/cookies, CSRF, rate limits, audit, admin MFA |
| Operations | Node/Docker, HTTPS via reverse proxy, health check, encrypted backup/restore, deploy guide |

### Out of scope (backlog only; **no UI control may suggest they work**)
Full accounting, supplier purchasing, merchant receivables, credit limits, cost/profit, certified
tax invoices, expiry batches, multiple warehouses, post-shipment returns, payment gateways, mobile
store apps, ERP/WhatsApp/SMS/email integration, partial fulfilment, public password reset by email.

## 3. Actors and roles

| Actor | Definition |
|---|---|
| Visitor | No session. May open login/registration pages only. |
| Trader – pending | `auth_users.role='trader'`, `merchants.status='pending'`. |
| Trader – approved | `merchants.status='approved'`. |
| Trader – suspended | `merchants.status='suspended'`; has no valid session. |
| Administrator | `auth_users.role='admin'`, TOTP enrolled. Created only by local CLI `setup-admin`, which also creates an approved merchant profile for the admin (used for admin test/operational orders). |
| Server operator | Person with shell access to the host; runs CLI (setup-admin, reset-password, reset-mfa, backup, restore). Not a web role. |

Role and status are **never** accepted from the browser; the server derives them from the session.

## 4. Permission matrix (server-enforced)

| Capability | Visitor | Pending | Approved | Admin |
|---|---|---|---|---|
| Register merchant | ✔ | — | — | — (admins are created by CLI) |
| Login / logout | ✔ | ✔ | ✔ | ✔ + TOTP |
| View own status & edit own profile | ✘ | ✔ | ✔ | ✔ (own) |
| Change own password | ✘ | ✔ | ✔ | ✔ (+ TOTP) |
| Catalog with prices | ✘ | ✘ | ✔ | ✔ |
| Submit order | ✘ | ✘ | ✔ own | ✔ via own merchant profile |
| View orders | ✘ | ✘ | own only | all |
| Order transitions | ✘ | ✘ | ✘ | ✔ (state machine + recent auth) |
| Products, inventory, merchants, settings | ✘ | ✘ | ✘ | ✔ (mutations need recent auth) |
| Reports, audit log, exports | ✘ | ✘ | ✘ | ✔ |
| Password/MFA recovery | ✘ | ✘ | ✘ | ✘ — **CLI operator only** |

Suspended accounts: all sessions revoked at suspension; login refused with a generic message.
Hiding a button in React is not authorization; every endpoint checks independently.

## 5. Business rules

### 5.1 Money
- All amounts are **integer piasters (قروش)**, 1 EGP = 100. Stored as SQLite INTEGER.
- No float arithmetic for money on the server; tax uses BigInt intermediates.
- Prices, totals, tax and shipping are computed **only on the server**.
- Limits: carton price 1 … 100,000,000 piasters (≤ 1,000,000 EGP); order total ≤ 10^13 piasters
  (well inside `Number.MAX_SAFE_INTEGER`); any overflow → `422 AMOUNT_LIMIT_EXCEEDED`.
- Tax: `tax = round_half_up(subtotal × tax_bps / 10000)`; tax base = goods subtotal only (D-009).
  `total = subtotal + tax + shipping`. `tax_bps` in 0…10000.
- Minimum order compares against the goods subtotal (before tax/shipping).
- Display: Egyptian pound, Arabic-Indic or Western digits per UI decision in stage 10, always 2 decimals, label «ج.م».

### 5.2 Quantities and units
- Orders are in **whole cartons** (integer ≥ `minimum_cartons`, ≥ 1, ≤ 100,000 per line).
- `pack_size` (pieces per carton) integer 1 … 10,000; per-piece price = carton price / pack_size, display only.
- ≤ 100 distinct products per order; duplicate product lines rejected.

### 5.3 Inventory equations
- `on_hand ≥ reserved ≥ 0`, enforced by DB CHECK constraints **and** guarded UPDATEs.
- `available = on_hand − reserved` (computed, never stored, never accepted from the browser).
- Units of on_hand/reserved are **cartons**.

| Event | on_hand | reserved | Notes |
|---|---:|---:|---|
| Order created (pending) | 0 | 0 | snapshot only; availability advisory |
| pending → confirmed | 0 | +qty | all lines or none; fails if any line lacks availability |
| confirmed → preparing | 0 | 0 | reservation retained |
| preparing → shipped | −qty | −qty | exactly once |
| shipped → delivered | 0 | 0 | |
| cancel from confirmed/preparing | 0 | −qty | exactly once |
| cancel from pending | 0 | 0 | event only |
| Receipt / opening stock | +n | 0 | reason + expectedVersion |
| Correction | ±n | 0 | result must be ≥ reserved and ≥ 0 |

Every movement writes `inventory_ledger`; every transition writes `order_events`; both in the same
transaction as the balance change. Concurrent confirmations competing for insufficient stock:
exactly one succeeds, no partial reservation, no negative balance.

### 5.4 Order state machine
```
pending ──► confirmed ──► preparing ──► shipped ──► delivered
   │            │             │
   └────────────┴─────────────┴──► cancelled
```
No skipped, backward or repeated transitions. `shipped`, `delivered`, `cancelled` are terminal for
cancellation. Only administrators transition orders (traders cannot cancel in the core release — D-010).

### 5.5 Order snapshots
At creation the order stores: merchant business name, phone, address; per item the product name,
brand, barcode, pack size, unit carton price, cartons, line total; and the settings used (tax_bps,
shipping, minimum). Later edits to products, profiles or settings never change existing orders.

### 5.6 Idempotency
`POST /orders` requires `requestKey` (UUID v4 generated by the client per submission attempt).
`UNIQUE(merchant_id, request_key)` + canonical content digest: same key + same content → same
order (200); same key + different content → `409 IDEMPOTENCY_KEY_REUSED`.

### 5.7 Deletion policy
No physical deletion of products, merchants or users that have orders or ledger rows; use
`active=0` / `status='suspended'`. Ledger, order events and audit rows are append-only.

### 5.8 Categories
The catalog uses a controlled list of **four** initial categories. The blueprint references
"the blueprint's four initial categories" but never names them — **open question Q-1** (see
PROJECT_STATE.md). Blocking for stage 06 only.

### 5.9 Demo data
`products.is_demo` / `orders.is_demo`. Demo seeding is disabled in production. An order may not mix
demo and real products; an order is demo iff its products are demo. Reports exclude demo and
cancelled orders from value metrics.

## 6. Product limits (not load-test results)
- ≤ 5,000 products in catalog.
- CSV import ≤ 1,000 rows and ≤ 1 MiB (file and JSON request).
- ≤ 100 distinct items per order.
- JSON body default limit 64 KiB; import endpoint 2 MiB (normalized JSON of a 1 MiB CSV).
- One application process + SQLite WAL on local persistent disk. **No capacity promise** without a
  real load test.

## 7. UI
- Arabic, `dir="rtl"`, `lang="ar"`; technical identifiers may be English.
- Brand: refined cream/off-white surfaces, deep warm red primary; the supplied logo (red «Khayr»
  wordmark with blue «AL» and «CO.») is the authentic brand mark (D-011). Blue is a secondary accent.
- Hash-based SPA routing (stage 01 decision).
- No auth tokens in browser storage. Cart drafts may use localStorage (validated, no credentials).
- Distinct UI states: loading, unauthenticated, pending, forbidden, conflict, network failure.
  A failed request must never render as an empty successful catalog.

## 8. Verification rule
A stage is complete only when its acceptance tests actually ran and passed in this repository.
Anything not executable here is recorded as **NOT RUN / UNVERIFIED** in PROJECT_STATE.md.
