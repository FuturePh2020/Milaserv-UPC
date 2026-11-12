# ALKHAYR — Project State

| Field | Value |
|---|---|
| Last updated | 2026-11-12 |
| Current stage | **09 — Administrative order fulfillment & atomic reservations: COMPLETE** |
| Next stage | **10 — Premium Arabic RTL design system** (awaiting owner prompt) |
| Execution mode | BUILD_NEW (D-001) |
| Project root | `alkhayr-b2b/` (self-contained) in repo `FuturePh2020/Milaserv-UPC`, branch `ccr-b8f31a52-xk6wqg` |
| Runtime | Node.js 24.22.1 (`/opt/node24/bin` here; Node 22 refused) — SQLite 3.53.4 via `node:sqlite` |
| Schema | Migrations 0001–0004 + **0005** (fulfillment, per-order reservations) |
| Application | Foundation, database, security primitives, admin enrollment, authentication, merchant lifecycle, products and catalog, inventory adjustments and ledger, pending-order creation and own-order reads, **administrator order fulfillment with per-order reservations**. No UI screens yet. |

## Stage log

| Stage | Status | Evidence |
|---|---|---|
| 00 | ✅ Done (spec + capability probe) | Commit `2427e9e` |
| 01 | ✅ Done (foundation) | Commit `f6ac774` |
| 02 | ✅ Done (database) | Commit `fa2fe06` |
| 03 | ✅ Done (security primitives + setup-admin) | Commit `4894196` |
| 04 | ✅ Done (authentication) | Commit `50ed3fa` |
| 05 | ✅ Done (merchant lifecycle) | Commit `c2c5a31` |
| 06 | ✅ Done (products + catalog) | Commit `0437953` |
| 07 | ✅ Done (inventory + ledger) | Commit `105f672` |
| 08 | ✅ Done (order creation + own-order reads) | Commit `2849466` |
| 09 | ✅ Done (fulfillment + allocations) | 415/415 tests ×3 clean-copy runs, typecheck clean, 44 mutations with attribution, audit 0 — below |
| 10–18 | ⏳ Not started | — |

## Stage 09 — what was built
| Area | Files | Summary |
|---|---|---|
| Per-order reservations | `migrations/0005_order_fulfillment.sql` | `order_allocations` (order line → reserved / released / consumed, linked to its reserve and settle ledger rows); guards on ledger, allocations, products, events and orders; pack-size lock while stocked; transition events carry operation key, digest and resulting version |
| Admin endpoints | `src/server/services/fulfillment.ts`, `routes/admin-orders.ts` | `GET /api/v1/admin/orders` (state, merchant, search, demo, sort, signed cursors), `GET /api/v1/admin/orders/:id` (snapshots + allocations + current stock + events), `POST …/:id/transitions` |
| Transitions | `services/fulfillment.ts` | re-validate (recent admin) → idempotency (per admin, digest) → version → state machine → buyer approval → confirmation checks → per line ledger/allocation/product → event → order `WHERE version = expectedVersion` → audit; one transaction |
| Packaging integrity | `services/products.ts` + 0005 trigger | `PACKAGING_LOCKED` while stocked/reserved; `CONFIRM_PACKAGING_CHANGED` when the snapshot differs |
| Errors / audit | `shared/errors.ts`, `services/audit.ts` | `ORDER_STATE_CONFLICT`, `BUYER_NOT_APPROVED`, `CONFIRM_PRODUCT_UNAVAILABLE`, `CONFIRM_PACKAGING_CHANGED`, `CONFIRM_STOCK_INSUFFICIENT`, `ORDER_RESERVATION_MISMATCH`, `PACKAGING_LOCKED`; `order.transitioned` |
| Shared helpers | `services/orders.ts` | exported `OrderRow`, `FINALIZED`, `orderDetail` (no logic change; comment on trader events) |
| Fixtures | `tests/helpers/database.ts` | `fixtureReserve` = real confirmation; new `fixtureTransition` (same write sequence as the service); order items take a pack size |

Model, reconciliation equations and the exact database/service boundary: DATABASE.md §14.

## Checks run in stage 09 (2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ 0 errors |
| Full suite (stages 01–09) | `npm run check` (typecheck + build + `npm test`) | ✅ **415 tests, 104 suites, 415 pass, 0 fail** |
| — fulfillment (HTTP) / schema (+4 tests for 0005) / orders | `node --test <file>` | ✅ 20 / 41 / 28 |
| Regression tests adjusted | see below | No protection removed or weakened |
| Clean reproduction ×3 | tracked + new files → `npm ci` → typecheck + `npm test` ×3 | ✅ 0 type errors; 415/415 each run |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities; package.json/lockfile unchanged |
| Immutable migrations | `git diff` 0001–0004 | ✅ unchanged |
| Concurrency | concurrent HTTP requests against one server process (confirm vs cancel, 6 competing confirmations, two orders for the same stock, triple cancellation) | ✅ one commit each time; no overselling |
| Multi-process / load testing | — | NOT RUN (single-instance deployment by design) |
| Browser QA | — | NOT RUN (no UI) |
| Real proxy / TLS / Docker | — | ⛔ NOT RUN (stage 17) |

Regression tests adjusted (all required by the new rules, assertions preserved):
- Stage-08 snapshot test: pieces-per-carton is now changed after emptying the stock with a traceable
  `set_total` adjustment (previously changed on a stocked product); its snapshot assertions are unchanged.
- Schema tests: the state-transition and event tests drive legal steps through `fixtureTransition`
  (ledger/allocation/event sequence) and use an administrator actor for transition events; the 0004
  unfinished-order test accepts either the 0004 or the 0005 trigger message (both refuse; SQLite does not
  specify which reports first); table count 13 → 14.
- "Database newer than the release" tests: hard-coded `user_version` 5/7 replaced by latest + 1 (5 had
  become current).
- Stage boundary tests (auth-security, server, orders): administrator order routes now exist (403 for
  traders); refund/cancel/summary/reservation endpoints still absent.

### Mutation evidence (44 scripted edits, each restored; fulfillment or schema test file)
| Mutation | Result | Attribution |
|---|---|---|
| F01 no commit-time re-validation / F02 without recency | caught | slow-body logout and recency-expiry tests |
| F03 replay ignores digest / F28 digest omits expectedVersion | caught | changed-content tests |
| F04 no idempotency lookup | caught | replay-after-advance test (409 instead of 200) |
| F27 idempotency after the version check | caught | replay-after-advance test |
| F05 no version pre-check | caught (expected 409) | **data protected** by the 0005 event `order_version_after` check (500) |
| F06 `WHERE` binds the read version | **survived** | **blocked by the independent pre-check** (and the event version check) |
| F07 both service version layers removed (event version follows the order) | caught | concurrent-administrator tests (both commit) |
| F08 shipped → cancelled allowed | caught (expected 409) | **data protected** by the 0001 event transition CHECK (500) |
| F09 / F10 no buyer approval check (all / preparing) | caught (expected 409) | **data protected** by the 0005 buyer check (500) |
| X02 service AND database buyer checks removed | caught | suspended buyer's order confirmed |
| F11 no product/category activity check | caught | deactivation test (order confirmed) |
| F12 no packaging check at confirmation | caught (expected 409) | **data protected** by the 0005 reserve guard (500) |
| X01 service packaging check AND 0005 reserve guard removed | caught | repacked order confirmed |
| F13 no stock check / F14 stock check ignores reserved | caught (expected 409) | **data protected** by ledger/products CHECKs (500) |
| F15 ship moves only reserved / F16 release restocks | caught | **data protected** by the ledger kind CHECKs (500) |
| F17 preparation reserves again / F18 pending cancellation releases | caught | **data protected** by the 0005 reserve/settle guards (500) |
| F19 no own-allocation pre-check before settling | **survived** | **unreachable through the supported path**: 0005 guarantees allocations match the order state; the settle guard and `changes` check would refuse anyway |
| F20 cancellation reason optional | caught (expected 400) | **data protected** by the 0005 reason check (500) |
| F21 non-strict body / F22 no audit / F23 cursor ignores state / F29 no finalized filter | caught | schema, audit, cursor and unfinished-order tests |
| F24 / F25 list / detail without admin guard | caught | access-control tests |
| F26 no packaging lock in the product service | caught (expected 409) | **data protected** by the 0005 pack-size trigger (500) |
| X03 service lock AND pack-size trigger removed | caught | stocked product repacked |
| F30 event written but order not updated | caught | lifecycle tests |
| D01–D11 each 0005 trigger/check disabled (pack size, settle, reserve, allocation backing, allocation state, buyer, admin actor, event-required, allocation update, cancel reason, event chain) | caught (11/11) | SQL tests |

### Required tests → evidence (real HTTP unless noted)
| Requirement | Test |
|---|---|
| Every allowed / forbidden transition | lifecycle; 6 states × every disallowed target → 409, nothing changed |
| Anonymous / trader / pending / suspended | 401 / 403 / 403 / 401 on list, detail, transition |
| Live admin, recency, CSRF/Origin/content type | reads after 16 min 200, transition 428, re-login works; 403/403/415 |
| Logout / suspension (session revocation) / recency expiry during body | slow body → 401 / 401 / 428, nothing written |
| Stale version, simultaneous administrators | confirm vs cancel concurrently → [201, 409]; 6 concurrent confirmations → one 201 |
| Identical / changed-content retries; retry after advance | 200 replay, no extra rows; 4 variants → 409; replay after shipped returns the original confirm operation and the current order |
| Failed attempt leaves key reusable | insufficient stock → receipt → same key 201 |
| Two competing orders | concurrent confirmations for 7 and 6 of 10 → one 201, one `CONFIRM_STOCK_INSUFFICIENT` |
| Multi-line later failure | 3rd line short → nothing reserved; 8 injected failures (ledger, allocation, product, event, order, audit, ship and release settlement) → full rollback |
| Per-order attribution / another order's reservation | shared product A 5, B 7, C 7; ship A leaves B's allocation; raw SQL release/ship under C, re-release of A, partial release of B, re-settle of B → refused |
| Preparation / shipment / delivery | no ledger or version change / on_hand and reserved −q once / no second deduction |
| Cancellation | pending: no stock change; confirmed and preparing: released once under 3 concurrent requests |
| Product/category deactivation | before: `CONFIRM_PRODUCT_UNAVAILABLE`; after reservation: prepare, ship, cancel still work |
| Packaging | PATCH while stocked/reserved → `PACKAGING_LOCKED`; raw SQL refused; name change allowed; after emptying → allowed; old pending order → `CONFIRM_PACKAGING_CHANGED`, can be cancelled |
| Buyer suspension | nothing cancelled or released; confirm/prepare/ship → `BUYER_NOT_APPROVED`; cancel and deliver work; returned-to-review buyer blocked too |
| Snapshots | price, tax, shipping, buyer, items unchanged after catalog/settings/profile changes and full lifecycle |
| Trader availability | normal → low → out of stock → back, no counts in responses |
| Continued protections | full stage 01–08 suites (database, static files, auth) pass |

## Limitations (known)
- **Username-lockout availability risk is still open** (SECURITY §7, T40) — stage 16 / release gate.
- No partial fulfillment, returns, post-shipment cancellation, payments or shipping integrations (out of scope).
- The database does not force an event to be followed by its state change, nor a reserve row by its
  allocation; the service writes them in one transaction and inconsistencies would block the order (DATABASE.md §14).
- Concurrency verified within the supported single-server deployment only; no multi-process or load testing.
- Traders do not see cancellation reasons (D-104); trader-facing messaging may be added deliberately later.
- No UI yet (stages 10–12); summary/print (14); reports (14); exports (13).

## Open questions
None.

## Remaining blockers
None for stage 10.

## Files changed in stage 09 (all under `alkhayr-b2b/`)
New: `migrations/0005_order_fulfillment.sql`, `src/server/services/fulfillment.ts`, `src/server/routes/admin-orders.ts`,
`tests/integration/fulfillment.test.ts`.
Modified: `src/server/app.ts`, `src/server/services/{audit,orders,products}.ts`, `src/shared/errors.ts`,
`tests/helpers/database.ts`, `tests/integration/{auth-security,database,orders,server}.test.ts`,
`tests/unit/{database-migrations,database-schema}.test.ts`, `migrations/README.md`, `README.md`,
`docs/{API_CONTRACT,DATABASE,SECURITY,THREAT_MODEL,DECISIONS,MIGRATION,PROJECT_STATE}.md`.
Not touched: migrations 0001–0004, dependencies/lockfile, web UI, repository-root files.

## How to continue
Next: send **PROMPT 10**. The UI must call these APIs only (no browser-side state of record), show
availability statuses to traders, and generate fresh request/operation keys per intended action (reusing
them only for retries of the same action).

---

## Stage 08 record (retained)

### What was built
| Area | Files | Summary |
|---|---|---|
| Finalization guards | `migrations/0004_order_finalization.sql` | Creation event (`NULL → pending`) accepted once, by the creator, for a pending v1 order with 1–100 items, `subtotal = Σ line totals` and uniform demo flag; no items after it; no transition/state change before it |
| Order endpoints | `src/server/services/orders.ts`, `routes/orders.ts` | `POST /api/v1/orders`, `GET /api/v1/orders`, `GET /api/v1/orders/:id` — own merchant only (administrators: own approved profile) |
| Atomic creation | `services/orders.ts` | re-validate (session, approval, `access_version`) → idempotency (per merchant, digest) → product rules → BigInt amounts → minimum order → header, items, creation event, audit — one transaction |
| Rules | `services/orders.ts` | strict schema (expected price + pack size per line), collection limit first, 32 KiB body; unavailable/demo/mixed/price/packaging/minimum/stock/amount/minimum-order errors; no stock counts disclosed; no stock/ledger/product change |
| Reads | `services/orders.ts` | finalized own orders only; newest first by `(created_at, id)`; HMAC cursors bound to user, merchant, state filter; identical 404 for foreign/unfinished/unknown; snapshots only; no digest |
| Errors / audit / limits | `shared/errors.ts`, `services/audit.ts`, `auth/rate-limit.ts` | `ACCESS_CHANGED`, `PRODUCT_UNAVAILABLE`, `PRICE_CHANGED`, `PACKAGING_CHANGED`, `INSUFFICIENT_STOCK`, `MINIMUM_QUANTITY_NOT_MET`, `MINIMUM_ORDER_NOT_MET`, `MIXED_DEMO_ITEMS`, `DEMO_NOT_ALLOWED`, `AMOUNT_LIMIT_EXCEEDED`; `order.created`; `order_create_account` 30 / 10 min |
| Fixtures | `tests/helpers/database.ts` | `insertOrder({ finalize })` writes the creation event under the same rules; default stays an unfinished (invisible) fixture |

Financial rule: `line = price × cartons`; `subtotal = Σ`; `taxBase = subtotal (+ shipping if taxable)`;
`tax = ⌊(taxBase × bps + 5000) / 10000⌋` (half-up); `total = subtotal + shipping + tax`; subtotal/total
> 1e13 rejected (never clamped); minimum order on the subtotal. Exact enforcement boundary: DATABASE.md §13.

### Checks run in stage 08 (2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ 0 errors |
| Full suite (stages 01–08) | `npm run check` (typecheck + build + `npm test`) | ✅ **391 tests, 97 suites, 391 pass, 0 fail** |
| — orders (HTTP + unit) / schema (+4 tests for 0004) | `node --test <file>` | ✅ 28 / 37 |
| Regression tests adjusted | schema (state-transition test finalizes its fixture order first — required by 0004); auth-security and server (stage boundary: own-order routes now exist; admin order routes still 404) | No protection removed or weakened |
| Clean reproduction ×3 | tracked + new files → `npm ci` → typecheck + `npm test` ×3 | ✅ 0 type errors; 391/391 each run |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities; package.json/lockfile unchanged |
| Immutable migrations | `git diff` 0001–0003 | ✅ unchanged |
| Browser QA | — | NOT RUN (no UI) |
| Real proxy / TLS / Docker | — | ⛔ NOT RUN (stage 17) |
| Multi-process concurrent order creation | — | NOT RUN (single process by design (exclusive instance lock, T25); concurrency tested in-process on `BEGIN IMMEDIATE`; the `UNIQUE(merchant_id, request_key)` index is the cross-connection backstop, exercised by mutation M05) |

#### Mutation evidence (40 scripted edits, each restored; orders or schema test file)
| Mutation | Result | Attribution |
|---|---|---|
| M01 no approval re-check at commit | caught | **by another layer**: the access-version comparison (409 `ACCESS_CHANGED` instead of 403). Every status change advances `access_version` (0002), so this check cannot be isolated |
| M02 no access_version comparison | caught | ABA slow-body test |
| M03 no commit-time re-validation | caught | slow-body logout test (order was created) |
| M04 replay ignores digest | caught | changed-content 409 test |
| M05 no idempotency lookup | caught | retry/concurrency tests; **data protected** by `UNIQUE(merchant_id, request_key)` (500 instead of replay) |
| M06 digest not order-independent | caught | reordered-retry test |
| M07 / M08 inactive category / product accepted | caught | unavailable-product test |
| M09 production demo allowed | caught | production demo test |
| M10 no mixed-demo check | caught (expected 422) | **data protected** by the 0004 demo guard (500) |
| M37 mixed-demo removed in service AND 0004 | caught | mixed order was created |
| M11 / M12 no price / packaging check | caught | stale-terms test |
| M13 no minimum quantity | caught | minimum test |
| M14 / M15 stock ignores reserved / no stock check | caught | insufficient-stock tests (fixture reservation) |
| M16 tax truncates | caught | half-up test |
| M17 shipping always taxed | caught | financial test |
| M18 no amount-limit check | caught (expected 422) | **data protected** by the subtotal/total CHECKs (500) |
| M19 total limit only on subtotal | caught | shipping/tax pushing total over 1e13 |
| M20 minimum order on total | caught | minimum-order test |
| M21 pricing uses the client's expected price | **survived** | **equivalent while the price check holds**: an order is only accepted when the expected price equals the server price (M11 shows that check is tested) |
| M22 / M23 / M24 list without finalized / merchant filter, detail without merchant filter | caught | reads tests |
| M25 cursor scope ignores filter | caught | cursor-binding test |
| M26 no order rate limit | caught | abuse-limit test |
| M27 no collection pre-check | caught (after strengthening) | first run **survived** because zod 4 checks the array length before elements; test now asserts the limit is reported before any other invalid field |
| M28 duplicate lines accepted | caught | duplicate-line test |
| M29 / M30 non-strict line / body schema | caught | unexpected-field tests |
| M31 no creation event | caught | committed order unreadable (500) — the marker is what makes orders visible |
| M32 no audit | caught | audit test |
| M33 / M34 / M38 / M39 / M40 0004 subtotal / demo / once / creator-pending / transition guards off | caught | SQL tests (first attempt of M33/M34 was an invalid SQL edit and is not counted) |
| M35 / M36 0004 items-frozen / state-change guards off | caught | SQL tests |

#### Required tests → evidence (real HTTP unless noted)
| Requirement | Test |
|---|---|
| Own merchant only; ids in body/headers; admin own profile | ids rejected (400), headers ignored, foreign read 404, admin order uses admin profile |
| Anonymous / CSRF / pending / suspended | 401 / 403 / 403 / 401, nothing written |
| Strict schema | 12 server-owned top-level fields, 7 line fields, 15 type/range variants (strings, fractions, 2^53, unsafe, null), 1e400 and NaN raw bodies, duplicates, empty, uppercase/non-v4 key, note length/type/control/bidi |
| Collection limit before validation; body limit; 100 lines | 101 → single `items` error (also with other invalid fields); 33 KiB → 413; 100 lines accepted in order |
| Unavailable products | missing / inactive / inactive category: identical bodies |
| Price tampering / stale price / packaging | lower expected price → 409 with current terms; server price used |
| Minimum quantity; stock; reservations | 4 < 5 → 422; 8 > 7 → 409 status only (no counts); pending orders reserve nothing; fixture-reserved stock unavailable |
| No stock side effects | product row and ledger unchanged after creation |
| Demo | mixed 422, client `isDemo` 400, demo order flagged; production → `DEMO_NOT_ALLOWED` |
| Tax rounding / shipping / limits / minimum order | 6163.92→6164, 7213.92→7214, 0.5→1, 0.497→0; BigInt unit (> 2^53); exactly 1e13 accepted, +1 line/shipping/tax rejected; minimum on subtotal |
| Snapshots | product rename/price/pack, profile address, settings change → detail identical |
| Idempotency | identical retry after price/stock/profile/settings changes → 200 same order; reordered lines → replay; 5 changed variants → 409; failed attempts leave key usable; same key other merchant → new order; 8 concurrent identical → one 201, seven 200, one order |
| Eligibility at commit | slow body: logout 401, return to review 403, suspend→approve (ABA) 409 |
| Atomicity / audit | injected audit failure → 500, no header/items/events, key reusable; audit metadata minimal |
| Reads / IDOR / pagination | foreign/unknown/unfinished identical 404; strict query; 7 orders in 3 pages with tied timestamps; cursor refused for other user, other filter, tampered MAC; no PATCH/PUT/DELETE (405) |
| Rate limit | 31st attempt in 10 min → 429 with Retry-After; other merchant unaffected; window reset |
| Database (SQL) | 0004: once/creator, subtotal mismatch, demo mismatch, items frozen, no transition/state change before creation |

### Limitations at the end of stage 08
- **Username-lockout availability risk is still open** (SECURITY §7, T40) — stage 16 / release gate.
- Stock availability at creation is a check, not a reservation: a pending order can be confirmable later or not (stage 09 re-checks atomically).
- Exact availability can be bounded by repeated order attempts (T57); slowed by the per-merchant limit, not eliminated.
- The tax rounding rule, minimum order and price/stock checks are service-enforced; the database guarantees the arithmetic identities and finalization consistency (DATABASE.md §13).
- Order summary/print view deferred to stage 14 (D-097). No administrator order endpoints yet (stage 09). No UI yet (stages 10–12).
- Tax/shipping defaults are implementation defaults (0), not a legal tax determination; configure before production.

### Files changed in stage 08 (all under `alkhayr-b2b/`)
New: `migrations/0004_order_finalization.sql`, `src/server/services/orders.ts`, `src/server/routes/orders.ts`,
`tests/integration/orders.test.ts`.
Modified: `src/server/app.ts`, `src/server/auth/rate-limit.ts`, `src/server/services/audit.ts`, `src/shared/errors.ts`,
`tests/helpers/database.ts`, `tests/integration/{auth-security,server}.test.ts`, `tests/unit/database-schema.test.ts`,
`migrations/README.md`, `README.md`, `docs/{API_CONTRACT,DATABASE,SECURITY,THREAT_MODEL,DECISIONS,MIGRATION,PROJECT_STATE}.md`.
Not touched: migrations 0001–0003, dependencies/lockfile, web UI, repository-root files.

---

## Stage 07 record (retained)

### What was built
| Area | Files | Summary |
|---|---|---|
| Activation gap closed | `migrations/0003_inventory_integrity.sql` | INSERT trigger: products must be inserted inactive with zero stock; defaulted `active = 1` inserts are rejected (default unchanged, no table rebuild) |
| Database ledger pairing | `migrations/0003…` | `products.last_ledger_id` + triggers: every on_hand/reserved change needs a new, exactly matching ledger row; ledger gains `product_version_after`, `adjustment_type` |
| Inventory endpoints | `src/server/services/inventory.ts`, `routes/admin-inventory.ts` | `GET /api/v1/admin/inventory`, `GET …/:id/ledger`, `POST …/:id/adjustments` (receipt / correction_delta / set_total) |
| Atomic adjustment | `services/inventory.ts` | re-validate → idempotency (per admin, digest) → expectedVersion → balance rules → ledger → linked update (`WHERE version = expectedVersion`) → audit |
| Shared helpers | `services/products.ts` | exported `adminProduct`, `loadProduct`, `assertCategory`, `lowStockThreshold`, `SELECT_PRODUCT` (no logic change) |
| Errors / audit | `shared/errors.ts`, `services/audit.ts` | `IDEMPOTENCY_KEY_REUSED`, `NO_CHANGE`, `INVENTORY_NEGATIVE`, `INVENTORY_BELOW_RESERVED`, `INVENTORY_LIMIT`; `inventory.adjusted` |
| Fixtures | `tests/helpers/database.ts` | `insertProduct` follows the valid lifecycle; `fixtureAdjustStock`, `fixtureReserve` (test-only, ledger-linked, reservation against a fixture order) |

#### Inventory model (documented)
`on_hand` = physical cartons allocated to this portal; `reserved` = confirmed/preparing commitments
(stage 09 only); `available = on_hand − reserved` (computed). The portal does not know about sales in
other programs — the business must allocate and periodically reconcile portal stock (operator guide).
Traders still see only the status (0 → out of stock, 1–10 → limited, > 10 → available, threshold
configurable). Not purchasing, costing, warehouses, expiry batches or accounting.

#### Enforcement boundary
Database (every write path): stock CHECKs, 1:1 ledger pairing with matching deltas/balances/version,
append-only ledger, inactive zero-stock inserts, version +1 per update. Service (supported transaction):
authorization, reasons, idempotency, expectedVersion, no manual reservation changes (also blocked by the
ledger CHECK for receipt/correction rows), Arabic errors. Details: DATABASE.md §12.

#### Stage-09 boundary
Order confirm/cancel/ship will write `reserve`/`release`/`ship` ledger rows per order line and the linked
product updates inside the order-transition transaction, through the same module. No reservation endpoint
or placeholder exists.

### Checks run in stage 07 (2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ 0 errors |
| Full suite (stages 01–07) | `npm test` | ✅ **359 tests, 85 suites, 359 pass, 0 fail** |
| — inventory (HTTP) / schema (+0003) / products (fixtures updated) | `node --test <file>` | ✅ 14 / 33 / 22 |
| Migration probe | 0001–0003 on a scratch DB | ✅ defaulted/stocked inserts and raw stock updates refused; linked update accepted; reuse/mismatch refused |
| Regression tests adjusted | schema (4 tests now assert the layered ledger/products behaviour; products CHECKs asserted present in schema), transaction (rollback via valid fixture reservations), products (`setStock` via ledger fixtures), auth-security (stage boundary) | No protection removed or weakened |
| Clean reproduction ×3 | tracked files → `npm ci` → typecheck + `npm test` ×3 | ✅ 0 type errors; 359/359 each run |
| Dependency audit | `npm audit` | ✅ 0 findings (57 packages); lockfile unchanged |
| Immutable migrations | `git diff` 0001, 0002 | ✅ unchanged |
| Browser QA | — | NOT RUN (no UI) |
| Real proxy / TLS / Docker | — | ⛔ NOT RUN (stage 17) |

#### Mutation evidence (15 single + 1 double; inventory, schema and product test files)
| Mutation | Result | Detected by the changed control's test / blocked by another layer |
|---|---|---|
| No idempotency lookup | caught (2) | retry and lost-response tests (the per-admin unique index would also refuse the duplicate key → 500) |
| No digest comparison | caught (1) | changed-content 409 test |
| Version check before idempotency | caught (3) | lost-response and retry tests |
| No commit-time re-validation | caught (1) | slow-body logout/recency test |
| No reserved-floor check | caught (1) | test expects 422 `INVENTORY_BELOW_RESERVED`; **data was still protected** by the ledger CHECK (the API returned 500) |
| No negative check | caught (1) | expects 422 `INVENTORY_NEGATIVE`; data still protected by the ledger CHECK |
| No maximum check | caught (1) | expects 422 `INVENTORY_LIMIT`; data still protected by the products CHECK |
| No no-op check | caught (1) | expects 422 `NO_CHANGE`; data still protected by the ledger nonzero CHECK |
| No `expectedVersion` pre-check | **survived** | **blocked by the independent `WHERE version = expectedVersion` guard** |
| WHERE binds read version | **survived** | **blocked by the independent pre-check** |
| Both version layers removed | caught (3) | metadata-vs-inventory conflict and idempotency tests |
| No audit event | caught (3) | audit assertions |
| Receipt schema not strict | caught (1) | unexpected-field test |
| Product update without ledger link | caught (12) | refused by the 0003 trigger (database layer) |
| 0003 insert guard disabled | caught (2) | SQL and HTTP database-protection tests |
| 0003 ledger-pairing trigger disabled | caught (3) | SQL tests (raw stock update accepted) |

#### Required tests → evidence (real HTTP unless noted)
| Requirement | Test |
|---|---|
| Anonymous/trader/pending/suspended denied | list, ledger, adjustment → 401/403/403/401 |
| Admin reads vs recent-auth mutations | reads after 16 min 200; adjustment 428; re-login 201 |
| Logout / recency expiry during body | slow-body → 401 / 428, no movement |
| Receipt, ±correction, set_total | balances 24 → 29 → 26 → 10, computed delta −16, ledger fields, version, audit |
| Integer/type/overflow bounds | 30 invalid bodies incl. strings, fractions, 2^53, 1e400, wrong amount field, unknown type; 1e9 + 1 → `INVENTORY_LIMIT` |
| Missing reason, unexpected/reservation fields | reason/key/version missing, reserved/available/orderId/actorUserId/onHandAfter/productId/reservedDelta → 400 |
| Zero/no-op | `delta: 0` → 400; `set_total` = current → `NO_CHANGE` |
| Below reserved / below zero | fixture reservation 8: total 7 and −3 → `INVENTORY_BELOW_RESERVED`; −11 → `INVENTORY_NEGATIVE`; total 8 OK; reserved unchanged |
| Inactive product receipt | stays inactive |
| DB rejects active/defaulted inserts | SQL (unit + HTTP-suite fixture connection) |
| Metadata endpoints reject stock | PATCH/POST with `onHand` → 400 |
| Version advances per movement | versions 2…5; ledger `productVersionAfter`; `last_ledger_id` |
| Metadata vs inventory conflicts | both directions → 409 with current record |
| Concurrent adjustments | [201, 409], one ledger row |
| Identical / concurrent identical / changed-content retries | 200 replay same operation; [201, 200, 200] one row; 5 changed variants → 409 |
| Lost-response retry | replay after later movement (stale version) → original result, no double movement; requires current eligibility (401/428); other admin's same key → new op |
| Rollback on ledger/balance/audit failure | three injected triggers → 500, product/ledger/audit unchanged, key reusable |
| Ledger immutability, compensating correction | SQL update/delete refused; HTTP PATCH/DELETE 405; −27 correction restores 3 |
| Inventory/ledger pagination & authorization | 4 sorts paginate fully; status filters; ledger newest-first pages; cursor bound to product and admin |
| Trader status, thresholds 0/1/10/11 | out_of_stock / low_stock / low_stock / normal / out_of_stock; no counts in catalog |
| Existing protections | full stage 01–06 suites pass |

### Limitations at the end of stage 07
- **Username-lockout availability risk is still open** (SECURITY §7, T40) — stage 16 / release gate.
- Portal stock must be allocated/reconciled by the business; no automatic synchronization with other sales channels.
- Database pairing does not prove the history of products stocked before 0003 (none in a fresh pilot) and does not check that the ledger actor is an administrator (service-enforced).
- No bulk/CSV stock import yet (stage 13); no inventory UI yet (stage 12).
- Reservations exist only as test fixtures until stage 09.
- Not purchasing, costing, multiple warehouses, expiry batches or accounting.

### Files changed in stage 07 (all under `alkhayr-b2b/`)
New: `migrations/0003_inventory_integrity.sql`, `src/server/services/inventory.ts`, `src/server/routes/admin-inventory.ts`,
`tests/integration/inventory.test.ts`.
Modified: `src/server/app.ts`, `src/server/services/{audit,products}.ts`, `src/shared/errors.ts`, `tests/helpers/database.ts`,
`tests/integration/{auth-security,products}.test.ts`, `tests/unit/{database-schema,database-transaction}.test.ts`,
`migrations/README.md`, `README.md`, `docs/{API_CONTRACT,DATABASE,SECURITY,THREAT_MODEL,DECISIONS,MIGRATION,PROJECT_STATE}.md`.
Not touched: migrations 0001/0002, dependencies/lockfile, web UI, repository-root files.

---

## Stage 06 record (retained)

### What was built
| Area | Files | Summary |
|---|---|---|
| Admin endpoints | `src/server/services/products.ts`, `routes/admin-products.ts` | `GET/POST /api/v1/admin/products`, `GET/PATCH /api/v1/admin/products/:id`; no DELETE (405) |
| Catalog | `services/products.ts`, `routes/products.ts` | `GET /api/v1/products`, `GET /api/v1/products/:id`, `GET /api/v1/catalog/filters` for approved merchants/admins |
| Validation | `services/products.ts` | Strict create/update schemas; integers checked before SQLite; barcode null/exact/unique; DB category check; image URL policy; demo rules |
| Inventory separation | `services/products.ts` | Create forces inactive + zero stock; no stock/reservation fields accepted; availability computed; trader sees status only |
| Concurrency | `services/products.ts`, `services/merchants.ts` | Cap counted inside the serialized transaction; barcode pre-check + unique index; `expectedVersion` pre-check + `WHERE version = expectedVersion` (also applied to stage-05 merchant updates, D-077) |
| Search | `src/server/http/search.ts` | Shared literal LIKE escaping (merchant search refactored to use it) |
| Audit / errors | `services/audit.ts`, `shared/errors.ts` | `product.created`, `product.updated` (field names, version, price/activation transitions); `DUPLICATE`, `CATALOG_LIMIT` |

#### Defects found and fixed during this stage
- `https://@host/…` image URLs were accepted (URL parser silently dropped an empty userinfo) → now refused (D-076).
- Optimistic-concurrency WHERE clauses bound the just-read version instead of the client's `expectedVersion`, so they were not an independent second check (products and the stage-05 merchant updates) → fixed (D-077).

### Checks run in stage 06 (2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ 0 errors |
| Full suite (stages 01–06) | `npm test` | ✅ **344 tests, 80 suites, 344 pass, 0 fail** |
| — products (HTTP) | `node --test tests/integration/products.test.ts` | ✅ 22 |
| Regression tests adjusted | server (DELETE on a product path now 405 → asserted explicitly; 404 case moved to an inventory path), auth-security (stage-boundary list) | Intended behaviour of new routes only |
| Clean reproduction ×3 | tracked files → `npm ci` → typecheck + `npm test` ×3 | ✅ 0 type errors; 344/344 each run |
| Dependency audit | `npm audit` | ✅ 0 findings (57 packages); lockfile unchanged |
| Migrations | `git diff` of `migrations/` | ✅ unchanged (none added) |
| Browser QA | — | NOT RUN (no UI change) |
| Real proxy / TLS / Docker | — | ⛔ NOT RUN (stage 17) |

#### Mutation evidence (accurate attribution)
Single mutations against `tests/integration/products.test.ts` (13 real; 2 script placeholders not counted):

| Mutation | Result | Detected by / blocked by |
|---|---|---|
| Catalog list includes inactive products | caught (1 fail) | visibility test |
| Catalog detail ignores `active` | caught (2) | non-disclosure + deactivation tests |
| Catalog returns admin record (stock numbers) | caught (1) | field allow-list test |
| Catalog list without approval check | caught (1) | pending-access test |
| No 5000 cap check | caught (1) | concurrent cap test |
| No `expectedVersion` pre-check (before D-077) | caught (2) | stale-form/conflict tests — WHERE then bound the read version, so it did not block it |
| Create schema not strict | caught (1) | mass-assignment test |
| Create trusts start-of-request identity | caught (2) | slow-body logout / recency tests |
| No category check on create | caught (1) | category test (FK would turn unknown ids into 500) |
| No image URL validation | caught (1) | image policy test |
| Demo allowed in production | caught (1) | production demo test |
| No LIKE escaping | caught (1) | literal wildcard test |
| **No barcode pre-check on create** | **survived** | **blocked by the independent database unique index `products_barcode_uq` + 409 mapping**; the pre-check itself was not detected |

After D-077 (client version bound in WHERE):

| Mutation | Result | Blocked by |
|---|---|---|
| Product: no `expectedVersion` pre-check | survived | independent `WHERE version = expectedVersion` guard |
| Product: WHERE binds read version | survived | independent pre-check |
| Merchant profile: no pre-check | survived | independent WHERE guard |
| Merchant status: no pre-check | survived | independent WHERE guard |
| Product: **both** layers removed | caught (2) | conflict/stale-form tests |
| Merchant profile: **both** layers removed | caught (1) | stale-version test |
| Barcode: pre-check **and** 409 mapping removed | caught (2) | duplicate/race tests (index still prevents the duplicate row; API answers 500) |

#### Required tests → evidence (real HTTP)
| Requirement | Test |
|---|---|
| Anonymous/pending/suspended catalog access | 401/403/401 on list, detail and filters; no prices or names in pending responses |
| Approved visibility, inactive non-disclosure | active only; field allow-list; identical 404 for inactive and unknown ids; inactive barcode not searchable |
| Traders denied admin product operations | list, detail, create (with forged role header), patch → 403; anonymous → 401 |
| Admin eligibility and recency | reads 200 after 16 min; create/patch 428; re-login → 200 |
| Logout / recency lapse during parsing | slow-body create and patch after session deletion → 401; recency lapse mid-request → 428 |
| Strict fields / mass assignment | 10 create and 8 update forbidden fields → 400, nothing written |
| Integer cents, limits, coercion | numeric strings, fractions, booleans, null, 2^53, 1e400 (Infinity), bounds; stored typeof integer |
| Barcode rules | null/omitted, `""`, leading space, number, 33 chars, `000123` vs `00123`, `ABC-1` vs `abc-1`, duplicates, update/clear |
| Category references | unknown, wrong case, Arabic label, injection-like, inactive category |
| Image URLs | http, javascript:, data:, credentials, empty userinfo, scheme-relative, ftp, spaces, backslash trick, file:, non-string; canonical storage |
| Malicious names/search | script/SQL text stored and returned verbatim; injection search returns nothing; table intact |
| Literal wildcards | `%`, `_`, `Choco_`, Latin case-insensitive, Arabic exact, exact barcode |
| Filter/sort/cursor scope | 12 invalid params; brand/category filters; 4 sorts paginate to the full ordering; cursor bound to sort, filter, endpoint and user |
| Concurrent duplicate barcode | [201, 409, 409] |
| Concurrent creates at cap | 4998 + 3 concurrent → [201, 201, 422], total 5000 |
| Conflicting edits | [200, 409] with current record; no-op keeps version |
| Activation versions | price/activation audits with transitions; deactivation hides from catalog |
| Atomic audit rollback | injected audit failure → 500, product unchanged, no product created |
| Stock via metadata endpoints | rejected; creation starts at 0/0/0; test-only stock update makes admin forms stale (409) |
| Demo/admin bypasses | demo refused in production, not convertible; no DELETE; no stock path |
| Existing protections | full stage 01–05 suites pass |

### Limitations (known)
- **Username-lockout availability risk is still open** (SECURITY §7, T40) — stage 16 / release gate.
- Inventory movements (opening stock, receipts, corrections) do not exist yet: every product has 0 stock and shows "غير متوفر" until stage 07.
- Product images are hosted by the business; the server neither validates that the URL resolves nor stores images.
- The 0001 column default `active = 1` remains; only the API's explicit `active = 0` makes new products inactive (any future insert path must do the same).
- End-to-end proof that product edits leave order snapshots unchanged waits for stages 08–09.
- Brand filter matches exact text; there is no brand normalization or merging.

### Files changed in stage 06 (all under `alkhayr-b2b/`)
New: `src/server/services/products.ts`, `src/server/routes/{products,admin-products}.ts`, `src/server/http/search.ts`,
`tests/integration/products.test.ts`.
Modified: `src/server/app.ts`, `src/server/services/{audit,merchants}.ts` (shared search helper; WHERE binds client version),
`src/shared/errors.ts`, `tests/integration/{server,auth-security}.test.ts`, `README.md`,
`docs/{API_CONTRACT,DATABASE,SECURITY,THREAT_MODEL,DECISIONS,PROJECT_STATE}.md`.
Not touched: migrations, dependencies/lockfile, web UI, repository-root files.

## Stage 05 record (retained)

> **Correction (stage 06):** the stage-05 text below calls the merchant profile's `WHERE version = ?`
> an "independent layer". At that time it bound the version just read in the transaction, not the
> client's `expectedVersion`, so it only guarded against changes between read and write; the stale-version
> protection rested on the pre-check alone. The reported stage-05 mutation outcomes themselves were
> correct. Since stage 06 (D-077) the WHERE clause binds the client's `expectedVersion` and is a genuine
> second layer (verified by single and double mutations).

### Clarifications requested
| Topic | Answer | Where |
|---|---|---|
| `/auth/*` paths | Shorthand for the canonical `/api/v1/auth/*`. No unprefixed aliases exist or will be added; unprefixed paths are 404. | API_CONTRACT §1, D-061 |
| Rate-limit persistence | Counters are SQLite rows and survive restarts — tested with the real bundled server (5 failures → restart → 429). Only the hashing concurrency limiter is in memory. No distributed store. | SECURITY §7, D-062 |
| Pseudonym keys | Keyed HMAC-SHA256 under HKDF(APP_SECRET) purpose keys (`rate_limit`, `ip`) since stage 04 — not enumerable plain hashes; no key transition needed. APP_SECRET rotation resets counters (documented). | SECURITY §7 |
| Username-lockout availability risk | **Still open, not solved.** Carried to stage 16 and the release gate (stage 18). | SECURITY §7, THREAT_MODEL T40 |

### Stage 05 — what was built
| Area | Files | Summary |
|---|---|---|
| Own profile | `src/server/services/merchants.ts`, `routes/merchant.ts` | `GET`/`PATCH /api/v1/merchant/profile`; session-only identity, no query params, strict editable fields, registration normalization, `expectedVersion` (409 with newer data), commit-time re-validation, audit with field names only |
| Admin review | `services/merchants.ts`, `routes/admin-merchants.ts`, `http/query.ts`, `http/cursor.ts` | List (status filter, escaped search, allow-listed sorts, keyset pagination with HMAC cursors), detail with status history |
| State changes | `services/merchants.ts` | Transition table, reasons, `expectedVersion`, admin recency at commit, atomic update + session revocation + audit, admin accounts protected |
| ABA defence | `migrations/0002_merchant_access_version.sql`, `services/authentication.ts` | Monotonic `access_version` (+1 per status change, trigger-enforced); login commit compares it |
| Guards | `auth/authorization.ts` | `revalidateAtCommit` (session, account state, admin role/recency) |
| Errors | `shared/errors.ts`, `http/errors.ts`, `http/response.ts` | `VERSION_CONFLICT`, `INVALID_STATE_TRANSITION`, `ADMIN_ACCOUNT_PROTECTED`; `details.current` |
| Audit | `services/audit.ts` | `merchant.profile_updated` (field names, version), `merchant.status_changed` (from/to/reason/revoked/version) |

### Checks run in stage 05 (2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ 0 errors |
| Full suite (stages 01–05) | `npm test` | ✅ **321 tests, 75 suites, 321 pass, 0 fail** |
| — merchant lifecycle (HTTP) / auth units (+ persistence) / auth process (+ restart) / schema (+ 0002) | `node --test <file>` | ✅ 21 / 13 / 2 / 32 |
| Regression tests adjusted | migration, database, connection, setup-admin, auth-security tests | Version numbers now derived from the shipped migrations (`LATEST_VERSION`, `nextMigrationFile`) instead of hardcoded 1/2; status fixtures advance `access_version`; stage-boundary list no longer expects the new merchant routes to be 404. No protection removed. |
| Mutation checks | 13 run | ✅ 10 caught: ABA check, session revocation, profile commit re-validation, admin commit re-validation, admin protection, profile version precheck, strict profile schema, LIKE escaping, cursor MAC, commit-time admin recency (the last one initially **survived**; a test for recency lapsing mid-request was added, then it was caught). 2 survived by design because a second independent layer catches them (profile WHERE-version guard; recency precheck vs commit check). 1 was a malformed placeholder (not counted). |
| Clean reproduction ×3 | tracked files → `npm ci` → typecheck + `npm test` ×3 | ✅ 0 type errors; 321/321 each run |
| Dependency audit | `npm audit` | ✅ 0 findings (57 packages); lockfile unchanged |
| Immutability | `git diff` of `0001_initial.sql` | ✅ unchanged |
| Browser QA | — | NOT RUN (no UI change) |
| Real proxy / TLS / Docker | — | ⛔ NOT RUN (stage 17) |

### Required tests → evidence (real HTTP, in-process app unless noted)
| Requirement | Test |
|---|---|
| Anonymous denied | profile GET/PATCH → 401; admin list → 401 |
| Own profile only; ids/headers cannot redirect | two traders; `X-Merchant-Id`/`X-User-Id`, `?merchantId=`, `/profile/<id>`, body `merchantId`/`id`/`userId` |
| Role/status/security fields rejected | 8 fields → 400, nothing written |
| Pending edit does not approve | status pending, `access_version` 1, role trader |
| Validation and stale versions | phone/email/address, empty patch, missing version, 409 with newer data, email clearing |
| Traders blocked from admin endpoints | list/search/detail/patch (incl. forged role header) → 403 |
| Stale admin authentication | reads 200, change 428, re-login → 200; recency lapsing mid-request → 428 at commit |
| Search/filter/pagination | status filter, `%` literal, Arabic, username, SQL-ish input, 10 invalid params, 3 pages = full ordering, cursor bound to sort/filter/admin, forged cursor |
| Approval | no session created, no notification field, audit from/to, live effect on trader |
| Suspension | 3 sessions revoked, reason required, login refused |
| Approved → pending | access removed, re-login as pending |
| Concurrent changes | [200, 409 `VERSION_CONFLICT` with current version], one audit row |
| Revocation/audit failure rollback | injected trigger failures → 500, merchant row identical, sessions intact |
| In-flight login/password vs suspension | gated password change → 401, password unchanged; gated login (stage 04) |
| ABA | gated login + suspend + reapprove → 401 (`access_changed`), fresh login works; schema test for triggers |
| Admin accounts protected | 4 attempts → 403; role field → 400; counts unchanged |
| Secret-free responses/audit | regex scan of profile/list/detail bodies; audit has no passwords, tokens, CSRF, email/phone values |
| Rate limits survive restart | unit reopen; bundled process restart → 429 |
| Existing protections | full stage 01–04 suites pass |

### Limitations (known)
- **Username-lockout availability risk is open** (SECURITY §7, T40) — for stage 16 and the release gate.
- Administrator reads do not require recent authentication (D-063); only changes do.
- No email/SMS notification of approval or suspension (none configured; nothing claims otherwise).
- Merchant search uses LIKE (case-insensitive only for ASCII; Arabic matches literally).
- End-to-end proof that profile edits leave order snapshots unchanged waits for stages 08–09 (DB-level guarantee exists since 0001).
- Existing pre-stage-05 databases must run `db:migrate` for 0002.

### Files changed in stage 05 (all under `alkhayr-b2b/`)
New: `migrations/0002_merchant_access_version.sql`, `src/server/services/merchants.ts`, `src/server/routes/{merchant,admin-merchants}.ts`,
`src/server/http/{query,cursor}.ts`, `tests/integration/merchants.test.ts`.
Modified: `src/server/{app.ts,auth/authorization.ts,http/errors.ts,http/response.ts,services/audit.ts,services/authentication.ts}`, `src/shared/errors.ts`,
`tests/helpers/{app,database}.ts`, `tests/integration/{auth-process,auth-security,database}.test.ts`,
`tests/unit/{auth-units,database-connection,database-migrations,database-schema,setup-admin}.test.ts`,
`migrations/README.md`, `README.md`, `docs/{API_CONTRACT,DATABASE,DECISIONS,MIGRATION,SECURITY,THREAT_MODEL,PROJECT_STATE}.md`.
Not touched: `migrations/0001_initial.sql`, dependencies/lockfile, web UI, repository-root files.

## Stage 04 record (retained)

### What was built
| Area | Files | Summary |
|---|---|---|
| Endpoints | `src/server/routes/auth.ts`, `src/server/services/authentication.ts` | `GET /auth/csrf`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` (contract: API_CONTRACT.md §3) |
| Sessions | `src/server/auth/sessions.ts`, `cookies.ts` | 256-bit tokens, SHA-256 storage, `__Host-` Secure/HttpOnly/SameSite=Strict cookies, idle 15/30 min, absolute 8 h, cap 5, rotation, conditional touch (no revival), duplicate-cookie rejection |
| CSRF | `src/server/auth/csrf.ts` | Session-bound `s1.` HMAC tokens; pre-login `p1.` tokens bound to a 10-min pre-session cookie, login/register only |
| Boundaries | `src/server/http/request-guards.ts`, `app.ts` | Exact Origin for mutations, Fetch Metadata for all `/api`, JSON-only, 8 KiB auth bodies, Host check (stage 01) |
| Abuse limits | `src/server/auth/rate-limit.ts`, `src/server/http/client-ip.ts` | Durable HMAC-keyed counters (login per IP/account, registration, password change, general API), 100 000-row cap + overflow + 60-s sweeper; TRUST_PROXY right-to-left XFF; IPv6 /64 |
| Concurrency | `authentication.ts` | Hashing/TOTP outside transactions; commit re-checks hash, `password_changed_at`, status, session; atomic `last_otp_step` |
| Guards | `src/server/auth/authorization.ts` | `authenticate`, `requireSession`, `requireSessionCsrf`, `requireApproved`, `requireAdmin`, `requireRecentAdminAuth` (428), `requireOwnMerchant` (404) — ready for stage 05+ |
| Audit | `src/server/services/audit.ts` | Allow-listed metadata per action; IP as HMAC |
| Wiring | `src/server/main.ts`, `context.ts`, `auth/keys.ts`, `router.ts`, `shared/errors.ts` | APP_SECRET required in every mode; shared hasher/limiter/keys; new error codes (INVALID_CREDENTIALS, ACCOUNT_PENDING, CSRF_FAILED, ORIGIN_REJECTED, REAUTH_FAILED, CREDENTIALS_CHANGED, RECENT_AUTH_REQUIRED) |
| Schema | — | **No migration** (D-060); 0001 untouched; runtime authorizer unchanged (the app's connection still cannot run DDL/ATTACH/PRAGMA writes/VACUUM INTO) |

### Defects found and fixed during this stage
- `GET /auth/csrf` gave a signed-in browser only its session token, so it could not log in again (switch account / re-authenticate after 428) — found by the fixation and recency tests; fixed (D-054).
- `setup-admin` still said web login was unavailable; it now explains that the enrollment code cannot be reused and the next 30-second code is needed.

### Checks run in stage 04 (2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ 0 errors |
| Full suite (stages 01–04) | `npm test` | ✅ **297 tests, 69 suites, 297 pass, 0 fail** |
| — new: auth units / auth flows (HTTP) / auth security (HTTP) / bundled-process E2E | `node --test <file>` | ✅ 12 / 13 / 23 / 1 |
| Regression tests adjusted | server, setup-admin (unit + PTY), repository hygiene | Intended behaviour changes only: Origin needed before an API mutation can 404; login route exists; APP_SECRET required; hygiene scan ignores comments |
| Mutation checks (13) | no atomic OTP check; no stale-credential check; no suspension re-check; no per-account limit; password change keeps sessions; no session re-check in password commit; logout swallows failure; no Origin check; CSRF always valid; ignore idle; ignore suspension in lookup; no session cap; trust XFF from anyone | ✅ each caught (1–2 failing tests); restored → 48/48 |
| Clean reproduction ×5 | tracked files only → `npm ci` → typecheck + `npm test` five times | ✅ 0 type errors; 297/297 on all 5 runs |
| Dependency audit | `npm audit` | ✅ 0 findings (57 packages); lockfile unchanged |
| Browser QA | — | NOT RUN (no UI change; sign-in UI is stage 11) |
| Real reverse proxy / TLS / Docker | — | ⛔ NOT RUN (stage 17) — TRUST_PROXY verified only with simulated headers from 127.0.0.1 |

### Required tests → evidence (HTTP unless noted)
| Requirement | Where |
|---|---|
| Pending-only registration; mass assignment | flows: pending trader + profile + audit; 7 forbidden fields rejected, no admin created |
| Generic duplicate registration and login failures | flows: identical 202 bodies; one identical 401 body for 6 failure causes |
| Trader/admin login | flows: trader (hash-only session, /me), pending trader, admin password + TOTP |
| Unknown-user verification; hashing overload | security: dummy verification counted; reference-cost hasher (1 running/1 queued) → 503 + Retry-After |
| Rate limits before hashing; bounded counters | security: 6th attempt → 429 with zero extra scrypt calls, unknown usernames too, per-IP, registration, general API; units: 50 identities with maxRows 10 → ≤ 11 rows |
| Proxy trust | units: right-to-left, spoofed/malformed entries; security: audit ip_hmac with/without TRUST_PROXY, spoofed XFF cannot dodge the IP limit |
| TOTP replay incl. concurrent | security: reuse refused, enrollment baseline, two gated concurrent logins → [200, 401] and 1 session |
| Credential-change / suspension races during login | security: gated verify + operator reset / suspension → 401, no session |
| Fixation and rotation | security: planted token destroyed, new token issued, forged token refused, duplicate cookies refused |
| Hash-only storage; cookie attributes | flows + process: token absent from DB/JSON; `__Host-`, Secure, HttpOnly, SameSite=Strict, Path=/, no Domain |
| Idle/absolute expiry, cap, concurrent creation | security: admin 15 min, trader 30 min with activity up to 8 h, no revival, 7 concurrent logins → 5 sessions |
| CSRF misuse | security: missing, other-browser pre-login, expired pre-login, pre-login after login, other-session token |
| Cross-origin, Host, content type | security: missing/foreign/lookalike/null Origin, cross-site & same-site Fetch Metadata, Host, form/text bodies, 413 |
| Forged identity/role headers | security: 6 headers ignored before and after login |
| Pending/suspended guards | security (test-only routes): ACCOUNT_PENDING, live approval, live suspension → 401 + sessions deleted, FORBIDDEN, 428, ownership 404 |
| Logout revocation and DB failure | flows: revoked + cookie expired; security: injected storage failure → 500, cookie kept, session still valid, retry succeeds |
| Password change revokes every session | flows: 3 devices → all 401; admin needs fresh, non-replayed TOTP |
| Concurrent password changes / stale verification | security: one winner, loser 401/409, loser's password not applied; logout during change → password unchanged |
| Secret-free responses and logs | flows: password, hash, token, CSRF, TOTP code, MFA secret, APP_SECRET, raw IP absent from logs and audit rows; process E2E logs |
| Continued DB/static protections | stage 01–03 suites unchanged and passing |

### Limitations (known)
- Per-username limit allows targeted temporary login delay (accepted trade-off, SECURITY.md §7).
- Rate limiting and hashing limits are per process (single-instance design).
- Suspension is enforced on the next request; deleting the suspended account's session rows at suspension time is part of stage 05's status endpoint.
- No sign-in UI yet; the API is complete for stages 10–12.
- No password/MFA recovery, operator password reset or additional administrators until stage 15.
- TRUST_PROXY behaviour behind a real proxy and TLS are not tested here (stage 17).

### Files changed in stage 04 (all under `alkhayr-b2b/`)
New: `src/server/auth/{authorization,cookies,csrf,keys,rate-limit,sessions}.ts`, `src/server/context.ts`,
`src/server/http/{client-ip,request-guards}.ts`, `src/server/routes/auth.ts`, `src/server/services/{audit,authentication}.ts`,
`tests/helpers/app.ts`, `tests/unit/auth-units.test.ts`, `tests/integration/auth-{flows,security,process}.test.ts`.
Modified: `src/server/{app,main}.ts`, `src/server/http/router.ts`, `src/server/cli/setup-admin.ts`, `src/shared/errors.ts`,
`tests/helpers/server.ts`, `tests/integration/{server,setup-admin}.test.ts`, `tests/unit/setup-admin.test.ts`,
`tests/security/repository-hygiene.test.ts`, `.env.example`, `README.md`,
`docs/{API_CONTRACT,SECURITY,THREAT_MODEL,DECISIONS,DATABASE,MIGRATION,PROJECT_STATE}.md`.
Not touched: migrations, dependencies/lockfile, web UI, repository-root files.

## Stage 03 record (retained)

### Documentation clarifications (requested)
- `DATABASE.md` §3 now lists all **13 tables** (12 blueprint + `product_categories`) and explains the addition.
- **Absent barcode = `NULL`.** `''` is invalid; uniqueness applies to non-NULL barcodes as exact text (DATABASE.md §3, D-036).
- **Audit retention: at least 365 days**; younger rows undeletable (trigger), older rows only by an explicit operator purge, never automatic — stated identically in DATABASE.md §4, SECURITY.md §10 and D-014 (now Accepted).

### Stage 03 — what was built
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

### Checks run in stage 03 (2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
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

### Limitations (known)
- Web login/sessions/CSRF/rate limiting are stage 04; `POST /api/v1/auth/login` is a 404 (tested), nothing claims otherwise.
- The hashing limiter is per process (fine for the single-instance design); stage 04 adds request rate limits in front of it.
- `setup-admin` enrolls only the first administrator; adding further admins, password reset and MFA reset are later stages (15). If APP_SECRET is lost, admin MFA cannot be decrypted until that procedure exists.
- APP_SECRET rotation is not implemented (envelope is versioned for it).
- Interactive behaviour was verified through a pseudo-terminal, not by a person at a real terminal.
- Passwords are not checked against breached-password lists (no external calls by design).
- JavaScript strings holding passwords cannot be wiped from memory; they are short-lived and never logged.

### Files changed in stage 03 (all under `alkhayr-b2b/`)
New: `src/server/auth/{passwords,totp,encryption,mfa-key-check}.ts`, `src/server/services/admin-bootstrap.ts`,
`src/server/cli/{prompt,setup-admin}.ts`, `src/shared/schemas.ts`,
`tests/unit/{passwords,totp,encryption,schemas,setup-admin}.test.ts`, `tests/integration/setup-admin.test.ts`, `tests/helpers/pty_driver.py`.
Modified: `src/server/cli/index.ts` (async, `setup-admin`), `src/server/database/runtime.ts` (MFA key check, admin count),
`src/server/main.ts` (`no_administrator` warning), `scripts/build.mjs` (`dist/server/package.json`), `package.json` (`setup-admin` script),
`tests/integration/server.test.ts` (warning-free start), `.env.example` (APP_SECRET note), `README.md`,
`docs/{DATABASE,SECURITY,THREAT_MODEL,DECISIONS,MIGRATION,PROJECT_STATE}.md`.
Not touched: migrations (0001 unchanged), dependencies/lockfile, web UI, repository-root files.

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
