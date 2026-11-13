# ALKHAYR — Project State

| Field | Value |
|---|---|
| Last updated | 2026-11-13 |
| Current stage | **14 — Business settings, reports, safe export and order printing: COMPLETE** |
| Next stage | **15** (awaiting owner prompt) |
| Execution mode | BUILD_NEW (D-001) |
| Project root | `alkhayr-b2b/` (self-contained) in repo `FuturePh2020/Milaserv-UPC`, branch `ccr-b8f31a52-xk6wqg` |
| Runtime | Node.js 24.22.1 (`/opt/node24/bin` here; Node 22 refused) — SQLite 3.53.4 via `node:sqlite` |
| Schema | Migrations 0001–0005 + **0006** (committed import batches) |
| Application | Foundation, database, security primitives, admin enrollment, authentication, merchant lifecycle, products and catalog, inventory adjustments and ledger, pending-order creation and own-order reads, administrator order fulfillment with per-order reservations, Arabic RTL design system and shells, the complete merchant experience in the browser, **and the administration screens (merchant review, products, inventory and ledger, order fulfillment) with safe re-authentication and idempotent retries, and CSV imports (four modes, preview, all-or-nothing confirmation, durable idempotency), and business settings, operational reports, spreadsheet-safe exports, pre-filled import templates and printable order summaries**. |

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
| 09 | ✅ Done (fulfillment + allocations) | Commit `6b5f592` |
| 10 | ✅ Done (design system + shells) | Commit `e8a7ce8` |
| 11 | ✅ Done (merchant experience) | Commit `8be8fbe` — 458/458 tests ×3 clean-copy runs, 87/87 end-to-end Chromium checks, axe 7 pages 0 violations, 19 mutants (21 runs) — below |
| 12 | ✅ Done (administration experience) | Commit `562b9f5` — 473/473 tests ×3 clean-copy runs, 125/125 administration lifecycle checks + 87/87 merchant journey, axe 21 states 0 violations, 16 mutants — below |
| 13 | ✅ Done (CSV imports) | Commit `9f9149e` — 513/513 tests ×3 clean-copy runs, 44/44 import lifecycle + 125/125 + 87/87 regression journeys, axe 0 violations, 30 mutants (final 27 caught / 3 survived; see stage-14 reconciliation) |
| 14 | ✅ Done (settings, reports, exports, printing) | 541/541 tests ×3 clean-copy runs, 67/67 browser run + 87/87, 125/125, 44/44 regressions, axe 0 violations, 24 mutants — below |
| 15–18 | ⏳ Not started | — |

## Stage 14 — known weaknesses first
- **Still open, owned by stage 16:** username lockout (T40), slow stock inference (T57/T73), stage-09 consistency gaps.
- **Import-record retention is open (stage 15/16).** Correction of the stage-13 report: the commit rate limit bounds
  the *growth rate* of `import_operations`/items, not lifetime storage. A retention/archive policy that preserves
  recovery and traceability is still to be designed; nothing is deleted in this stage.
- **Spreadsheet behaviour is untested.** The formula defence and CSV quoting were verified by tests and by re-parsing
  with the project's parser, not in Excel, LibreOffice or Google Sheets (NOT RUN). Spreadsheet programs may still
  drop leading zeros or reformat numbers when a file is opened or saved; that cannot be undone by this system.
- **Company details on printed summaries are the CURRENT settings** (orders never snapshotted them). They are labelled
  as current; historical issuer data is not invented. A summary is not a tax invoice, receipt or proof of payment.
- **Upgrade edge:** a browser holding an unclear order submission saved before this release drops it (it lacks the
  reviewed terms); the order may exist — the trader must check «طلباتي».
- **Minimum order is not bound to the reviewed quote** (a raised minimum is still refused at creation; a lowered one
  is harmless). Prices/packaging were already bound per line.
- **Exports:** an authorized administrator can still export everything within the caps (that is the feature); caps are
  per request, the rate limit per administrator. Browser-to-PDF was tested in Chromium only; no server-generated PDF.
- Browser verification: Chromium, plain HTTP test origin, automated axe rules only (no screen reader).

## Stage 14 — reconciliation of the stage-13 report
- **Mutation count, final and unambiguous:** 30 mutants. First run: 25 caught, 5 survived (M08, M11, M12, C02,
  C03). Two survivors exposed weak tests and were caught after adding tests (M12 in-flight recency expiry; C02 balanced
  quote inside a cell). Final: **27 caught, 3 survived** — M08 redundant (the in-transaction evaluation enforces the
  catalog cap before the removed re-check: equivalent in the current code), M11 blocked by another layer (in-transaction
  re-validation), C03 blocked by another layer (streaming row bound). The stage-13 chat summary ("26 caught, 4
  survived") was wrong; the stage-13 table below was right.
- **Storage claim corrected** (DATABASE §15, T95): rate limits bound growth rate only.

## Stage 14 — what was built
| Capability | Server | Browser |
|---|---|---|
| Business settings | `services/settings.ts`: GET (live admin) / PATCH (recent auth, CSRF, Origin, strict ≤ 8 KiB, version, commit-time checks, atomic audit with financial before/after) | `#/admin/settings`: exact EGP → piastres, % → basis points (≤ 2 decimals, refused otherwise), confirmation of financial changes, conflict keeps typed values, re-auth panel |
| Quote terms binding | `orders.ts`: required `expectedTerms` compared after idempotency → `TERMS_CHANGED` | checkout stores the reviewed terms with the key/payload; on `TERMS_CHANGED` re-quotes and requires a new explicit submission |
| Reports | `services/reports.ts`, `reports/time.ts` (Cairo days, DST-aware), exact BigInt sums, overflow error | `#/admin/reports` 4 tabs with visible definitions |
| Exports | `services/exports.ts`, `reports/csv-out.ts` (view vs canonical) | `ExportButton` (blob download, no automatic retry after re-auth) on reports and products |
| Pre-filled templates | `POST /admin/imports/templates/prefilled` | import page (non-create modes, optional filter) |
| Import history | `GET /admin/imports`, `/admin/imports/:id` (signed cursor) | `#/admin/imports/history`, `#/admin/imports/<id>` |
| Order summaries | `GET /orders/:id/summary`, `/admin/orders/:id/summary` | `#/orders/<id>/print`, `#/admin/orders/<id>/print`, `styles/print.css` |
No migration. New error codes: `TERMS_CHANGED`, `AGGREGATE_OVERFLOW`, `EXPORT_TOO_LARGE` (and the busy message now
covers exports). New rate limit `export_account` (20/10 min). New audit actions `settings.updated`, `export.created`.

## Checks run in stage 14 (2026-11-13 UTC, this container, Node 24.22.1)
| Check | Command | Result |
|---|---|---|
| Type check, build | `npm run typecheck`, `npm run build` | ✅ |
| Full suite | `npm run check` | ✅ **541 tests, 541 pass, 0 fail** (+28: business HTTP 17, report/CSV/time units 7, settings inputs 3, stored terms 1) |
| Clean reproduction ×3 | tracked + new files → `npm ci` → typecheck + `npm test` ×3 | ✅ 541/541 each run |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities; no dependency added; migrations and package files unchanged |
| Known dataset | `tests/integration/business.test.ts` | hand-calculated values: orders by state (34 314 / 2 997 / 3 996 / 19 307 piastres; not-cancelled 41 307), Cairo boundaries at both ends (00:00 inclusive, 23:59:59.999 included, next 00:00 excluded), merchant and demo filters, products (7 and 2 cartons), movements on DST-free days at 23:59/00:00 Cairo, export rows reproducing the total |
| **Stage-14 browser run** | Chromium, production build, real server, disposable DB, admin from real `setup-admin` | ✅ **67/67**: settings UI (precision refused, confirmation, saved exactly); new quote uses new settings; **tax changed during review → order refused, totals recomputed, explicit resubmission uses 10%**; earlier order unchanged; report total = independent SQL sum; exported report total matches; product export neutralizes `=HYPERLINK` and keeps `000777`; movement report; **pre-filled template → edit → preview → confirm** (+9 each, once); import history; summaries (disclaimer, current company label, no navigation, trader privacy after an internal cancellation reason); **Chromium print-to-PDF: 2-line order 1 page, 45-line order 5 A4 pages with repeated table heading (rendered and inspected)**; trader exclusion (UI and server); expired recent auth → re-auth → no automatic export → explicit export; 360/375/768/1366 px on 6 pages; keyboard tabs |
| Regression journeys | stage 11 / 12 / 13 harness | ✅ 87/87, 125/125, 44/44 |
| Automated accessibility | axe-core 4.10.2 (scratch), WCAG 2.0/2.1 A+AA | ✅ 0 violations on 10 states (settings, reports, import history, summary at 1366; six pages at 360) |
| Spreadsheet applications, screen readers, other browsers, HTTPS, hosting, load, server-side PDF | — | NOT RUN (no server PDF exists) |

**Defects found and fixed during the run:** printed column headings broke inside words (print-only `nowrap`; a first
attempt widened the phone preview and was caught by the width checks); `client.ts` is shared with the server type
check, so the DOM download helper moved to `web/download.ts`.

### Mutation evidence (24 mutants, each restored)
| Mutation | Result | Caught by |
|---|---|---|
| S01 terms not compared · S02 `expectedTerms` optional · S03 committed retry re-checks terms | caught | business HTTP tests (S02 also by the type checker) |
| S04 settings commit without recency (in-transaction) | **survived first**, then caught | added test: recency expires while the PATCH is in flight |
| S05 settings version pre-check removed | **survived** | **blocked by another layer**: the `WHERE version = ?` update guard returns the same 409 |
| S06 settings audit missing · S07 inclusive end bound · S08 cancelled in total · S09 demo included · S10 cancelled in product default | caught | business HTTP tests |
| S11 overflow not mapped · S12 whitespace/control bypass · S13 full-width bypass · S21 UTC-midnight day boundary | caught | report unit tests (S12/S13 were not applied on the first run because the pattern did not match the literal full-width characters; re-run after fixing the pattern) |
| S14 export without recent auth · S15 row cap removed · S16 contact data always · S17 formula name in template · S18 quantity pre-filled · S19 summary exposes internals · S20 summary not merchant-scoped · S22 cursor not bound to admin | caught | business HTTP tests (S14 also by the type checker) |
| S23 percent rounds a third decimal · S24 stored submission without terms | caught | web unit tests (S24 also by the type checker) |
Final: **23 caught, 1 survived (S05, protected by an independent layer)**. Not mutation-tested (browser-verified
only): the checkout re-quote on `TERMS_CHANGED`, print CSS, no automatic export after re-authentication.

## Limitations (known)
See weaknesses above. Not in this stage by design: accounting, payments, tax-authority integration, shipping
integrations, backups/recovery, deployment, category management.

## Open questions
None.

## Remaining blockers
None for stage 15. Stage 15 (backup/recovery) should include the import-record retention/archive design.

## Files changed in stage 14 (all under `alkhayr-b2b/`)
New: `src/server/services/{settings,reports,exports}.ts`, `src/server/reports/{time,csv-out}.ts`,
`src/server/routes/admin-business.ts`, `src/web/pages/admin/{Settings,Reports,ExportButton,ImportHistory}.tsx`,
`src/web/pages/OrderSummaryPrint.tsx`, `src/web/download.ts`, `src/web/styles/print.css`,
`tests/integration/business.test.ts`, `tests/unit/reports.test.ts`.
Modified: `src/server/{app.ts}`, `src/server/auth/rate-limit.ts`, `src/server/services/{audit,fulfillment,imports,orders}.ts`,
`src/server/routes/{admin-imports,admin-orders,orders}.ts`, `src/shared/errors.ts`, `src/web/{App.tsx,main.tsx,main.dev.tsx}`,
`src/web/api/{admin,client,endpoints}.ts`, `src/web/admin/logic.ts`, `src/web/cart/storage.ts`, `src/web/checkout/submission.ts`,
`src/web/components/Icon.tsx`, `src/web/layouts/Shells.tsx`, `src/web/pages/admin/{AdminOrders,Imports,Products}.tsx`,
`src/web/pages/{cart/Checkout,orders/Orders}.tsx`, `src/web/styles/components.css`,
tests `helpers/database.ts`, `integration/{orders,fulfillment}.test.ts`, `unit/{web-admin,web-cart}.test.ts`, docs.

## How to continue
Next: send **PROMPT 15**. No migration is needed for stage 14.

---

## Stage 13 record (retained)

### Stage 13 — known weaknesses first
- **Username-lockout availability risk is still open** (SECURITY §7, T40); **stock inference** (T57, T73) is slowed,
  not eliminated; **stage-09 consistency gaps** remain service-enforced only. All three are carried to stage 16.
- **An unresolved administrator operation (import, adjustment, transition) lives in memory only.** It now survives
  navigation between administration screens, but a refresh, closing the tab, a session that expires or sign-out loses
  the key and payload. `beforeunload` is requested but browsers do not guarantee the prompt. The operator must then
  check the product list / ledger / order history before repeating.
- **Correction of the stage-12 report:** `expectedVersion` refuses a duplicate sent *with the old version*; it does
  **not** stop an operator from deliberately repeating the same business action (e.g. importing the same receipt file
  again with a new key after the product version moved on). Only the same-key retry is protected against that.
- A deliberate re-import of the same file with a NEW key after a lost response creates the effect twice (new products,
  a second receipt) if the first one committed; the UI warns, the server cannot know the intent.
- Leading zeros already removed from barcodes by a spreadsheet program cannot be recovered (documented, warned).
- No prefilled update/stock templates (product ids and versions must be copied from the product/inventory pages);
  safe spreadsheet export is stage 14.
- Import records (`import_operations`, items) are retained indefinitely like the ledger (**corrected in stage 14:** the commit rate limit bounds the growth rate, not storage;
  limit); no purge policy yet.
- The 2-concurrent-job bound is per process (one process per SQLite file is already the deployment model).
- Browser verification: Chromium only, plain HTTP test origin, automated axe rules only; no screen reader, other
  browsers, HTTPS, hosting or load test.

### Stage 13 — supported modes and columns
| Mode | Required | Optional | Effect |
|---|---|---|---|
| `create_products` | `name, brand, category, cartonPriceEgp, packSize, minimumCartons` | `barcode, imageUrl` | new products, inactive, zero stock, not demo |
| `update_products` | `productId, expectedVersion` + ≥ 1 changeable column | `currentName, name, brand, category, cartonPriceEgp, packSize, minimumCartons, barcode, imageUrl` | empty = unchanged, `__CLEAR__` clears barcode/image; packaging lock; no stock/activation/demo change |
| `receive_stock` | `productId, expectedVersion, quantity, reason` | `currentName, reference` | one receipt ledger row per record |
| `set_stock_total` | `productId, expectedVersion, total, reason` | `currentName, reference` | one set-total ledger row per record; replaces the physical total; never below reserved; no no-ops |
Exact contract and grammar: API_CONTRACT §6; operator guide in Arabic: `docs/IMPORT_GUIDE_AR.md`.

### Stage 13 — server and schema changes
| Area | Files | Summary |
|---|---|---|
| Migration 0006 | `migrations/0006_import_operations.sql` | `import_operations` (per admin + key unique; hash/size/count, no file body), `import_operation_items` (links to products and ledger rows), append-only, consistency trigger |
| Parser | `src/server/import/csv.ts` | strict bounded RFC-4180 parser (UTF-8 fatal, BOM, LF/CRLF, quotes, multiline, record line numbers), whole-number and EGP grammars; no dependency |
| Import service | `src/server/services/imports.ts`, `routes/admin-imports.ts` | templates, preview (no writes, signed binding), commit (re-validate → idempotency → binding → re-evaluate → apply → record → audit) |
| Shared cores | `services/products.ts`, `services/inventory.ts` | `insertProductRecord`, `applyProductUpdate`, `assertCatalogCapacity`, `planStockAdjustment`, `applyStockAdjustment` used by the endpoints AND imports |
| Security plumbing | `auth/keys.ts`, `auth/encryption.ts`, `auth/rate-limit.ts`, `services/audit.ts`, `shared/errors.ts` | `import_preview` key purpose; `import_preview_account` 30/10 min, `import_commit_account` 20/10 min; `import.committed` audit; `IMPORT_*` error codes |
| Browser | `admin/coordinator.ts`, `admin/operations.tsx`, `hooks/useOperation.ts`, `pages/admin/{Imports,UnresolvedBanner,OperationNotice,Inventory,AdminOrders,Products}.tsx`, `App.tsx`, `layouts/Shells.tsx`, `api/admin.ts`, CSS, icons | account-scoped unresolved-operation coordinator surviving navigation; shell banner; import page |

### Checks run in stage 13 (2026-11-13 UTC, this container, Node 24.22.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ 0 errors |
| Production build | `npm run build` | ✅ |
| Full suite | `npm run check` | ✅ **513 tests, 513 pass, 0 fail** (+40: CSV parser 14, import HTTP 21 incl. failure injection, restart recovery 1, migration 0006 2, coordinator 3; minus 1 obsolete counter test) |
| Clean reproduction ×3 | tracked + new files → `npm ci` → typecheck + `npm test` ×3 | ✅ 513/513 each run |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities; no dependency added; package files and migrations 0001–0005 unchanged |
| **Import lifecycle (browser)** | Chromium, production build, real server process, disposable database, administrator from the real `setup-admin` (PTY), real trader session | ✅ **44/44**: template download (BOM, attachment); invalid Arabic file reviewed (extra decimals, unknown category) with no confirm button; hostile `<img onerror>` / `=HYPERLINK(...)` text rendered as text with no effect; preview writes nothing; fixed file (BOM, CRLF, quoted comma/quotes) → 3 products exactly (12550/29 piastres, `000123`, `AbC-09`, NULL), inactive, zero stock; receipt import → one ledger row per record with actor/reason/reference; reservation → set-total below reserved refused; stale confirmation (price edited after preview) → whole batch refused, errors shown, nothing applied; **committed confirmation with the response cut** → "outcome unknown", file/mode locked → navigate to products → shell banner → back → same-key retry → "already recorded — not repeated", stock applied once; inventory adjustment also kept across navigation and replayed once; expired re-authentication → dedicated sign-in → preview re-validated, nothing executed → explicit re-confirmation; trader forbidden view and server 403, no admin request from the trader UI; 360/375/768/1366 px without page-wide horizontal scroll; arrow keys move between modes; file input focusable |
| Regression journeys | same harness | ✅ stage-12 administration lifecycle 125/125; stage-11 merchant journey 87/87 |
| Automated accessibility | axe-core 4.10.2 (scratch install), WCAG 2.0/2.1 A+AA | ✅ 0 violations: import page with preview at 360 and 1366 px, empty import page at 1366 px (plus the 21 states of the stage-12 rerun) |
| Screen readers, other browsers, real HTTPS, hosting, load | — | NOT RUN |

Test-only setup outside the UI: trader approval and order placement/confirmation through the real API, moving one
session's sign-in time back 16 minutes, and (HTTP tests) failure-injection triggers created and dropped in the
disposable database. **Defects found and fixed:** post-reauthentication revalidation used the stale CSRF token
(deferred until the identity refresh re-rendered); fieldsets widened the page on phones; per-record errors were
off-screen on phones (plain error list added).

### Mutation evidence (30 mutants, each restored)
| Mutation | Result | Caught by |
|---|---|---|
| M01 idempotency after the binding · M02 different content replays · M03 binding not verified · M04 content digest ignored · M05 never expires · M06 admin ignored | caught | import HTTP tests |
| M07 invalid records skipped (partial import) | caught | stale test — reported 500 because the independent intent/record count guard also refused it |
| M08 commit-time cap re-check removed | **survived** | **equivalent here**: the in-transaction evaluation enforces the cap first (M09 removing that one too → caught) |
| M10 batch audit missing · M13 preview without CSRF · M14 duplicate ids · M15 empty clears · M16 packaging lock · M17 reserved floor · M18 version not compared · M19 barcode zeros · M20 barcode in use | caught | import HTTP tests (M10/M18 also rejected by the type checker) |
| M11 recent-auth pre-check removed | **survived** | **blocked by the in-transaction re-validation** (428) |
| M12 in-transaction re-validation accepts any admin session | **survived first**, then caught | added test: authentication expires while the commit is in flight |
| C01 UTF-8 replacement · C04 money third decimal · C05 leading zeros · C06 NUL · C07 unterminated quote | caught | parser tests |
| C02 quote inside an unquoted cell | **survived first**, then caught | the test only checked the line number; added the balanced `ab"c"` case |
| C03 final row check off by one | **survived** | **blocked by the streaming row bound** (the parser stops at 1 001 records) |
| W01 coordinator replaces an unresolved operation · W02 retry with a new key · W03 late response resurrects a discarded one | caught | coordinator unit tests |

Not mutation-tested (browser-verified only): navigation persistence wiring in the shell, the banner, post-reauth
revalidation.

### Limitations (known)
See "known weaknesses" above. Not in this stage by design: export/reporting, settings administration,
backup/recovery, deployment, synchronization with other sales systems, merchant/order/category/accounting imports.

### Open questions
None.

### Remaining blockers
None for stage 14. Stage 14 should add spreadsheet-safe export (formula neutralization) and may add prefilled
import templates built on it.

### Files changed in stage 13 (all under `alkhayr-b2b/`)
New: `migrations/0006_import_operations.sql`, `src/server/import/csv.ts`, `src/server/services/imports.ts`,
`src/server/routes/admin-imports.ts`, `src/web/admin/{coordinator.ts,operations.tsx}`,
`src/web/pages/admin/{Imports,UnresolvedBanner}.tsx`, `docs/IMPORT_GUIDE_AR.md`,
`tests/unit/csv.test.ts`, `tests/integration/{imports,imports-restart}.test.ts`.
Modified: `src/server/{app.ts}`, `src/server/auth/{encryption,keys,rate-limit}.ts`, `src/server/services/{audit,inventory,products}.ts`,
`src/shared/errors.ts`, `src/web/{App.tsx}`, `src/web/admin/unresolved.ts`, `src/web/api/admin.ts`, `src/web/components/Icon.tsx`,
`src/web/hooks/useOperation.ts`, `src/web/layouts/Shells.tsx`, `src/web/pages/admin/{AdminOrders,Inventory,OperationNotice,Products}.tsx`,
`src/web/styles/components.css`, `migrations/README.md`, tests `unit/{database-migrations,database-schema,web-admin}.test.ts`, docs.
Not touched: migrations 0001–0005, package files.

### How to continue
Next: send **PROMPT 14**. Upgrading an existing database requires `db:migrate --confirm-backup` for 0006.

---

## Stage 12 record (retained)

### Stage 12 — known weaknesses first
- **Username-lockout availability risk is still open** (SECURITY §7, T40): anyone can lock a username's sign-in
  for 15 minutes, including an administrator's. Stage 16 / release gate.
- **Stock inference** through repeated order or quote attempts (T57, T73) is slowed by per-merchant limits, not
  eliminated.
- **Stage-09 database consistency gaps** (event without state change; reserve row without allocation) remain
  service-enforced only and are carried to stage 16. The administration UI shows what the server returns and
  offers **no repair control** (nothing deletes history, edits allocations or changes stock silently).
- **An unresolved administrator operation lives in memory only.** Refresh/close and sign-out ask for
  confirmation, but navigating to another screen inside the app, or a session that expires, discards the kept
  key and payload. The operator must then check the inventory ledger or the order history before acting again
  (the server never applies a second movement for the same key, and a new attempt carries the old expected
  version, so it is refused if the first one was applied — verified by mutation).
- **Product create/edit and merchant status changes have no idempotency key** (server design since stages
  05–06). An unclear outcome is never retried automatically: the UI tells the operator to look at the current
  record (edit, status) or to search the list before creating again (create). A duplicate product after a lost
  create response is therefore possible if the operator ignores that instruction; barcodes, when present, are
  unique and stop exact duplicates.
- Re-authentication needs a **new** authenticator code: a code already used in the same 30-second step is
  refused (replay protection), so the operator may wait up to 30 seconds.
- Product images are third-party https URLs loaded by the administrator's and traders' browsers
  (`referrerPolicy=no-referrer`, CSP `img-src https:`); the image host learns viewers' IP addresses. Unchanged
  from stage 06.
- No category administration exists; category choices list active categories only. The inactive-category
  fix (below) is preventive: categories can currently only change through the database.
- The second test administrator in the browser run is a test-only database fixture (no administrator-creation
  feature exists; `setup-admin` refuses a second bootstrap, verified in the same run).
- Browser verification: Chromium only, plain HTTP test origin; axe-core automated rules only (no manual
  screen-reader test). Toast messages stay visible briefly after navigating to another screen.

### Stage 12 — what works end to end (verified in Chromium against the production build)
Administrator 1 created with the real `setup-admin` in a pseudo-terminal (TOTP proof); a second bootstrap is
refused → two merchants register in the UI → both administrators sign in with password + OTP → landing page
(links only, no figures) → merchant review: pending filter, approval, a **stale second administrator** gets
`VERSION_CONFLICT` with the current record and only currently valid choices; suspension requires a reason and
explains that sessions end and orders/reservations are not cancelled → products: price with three decimals and
an http image refused before any request; exact creation (12550 piastres, barcode `000123`, inactive, zero
stock, no image); empty barcode stored as NULL; Arabic-Indic price; duplicate barcode shown on the field;
**concurrent edit** keeps the unsaved value and shows the current record; no delete/demo control → inventory:
preview, receipt recorded **once despite a double click**, packaging lock explained; activation → two orders
confirmed (reservations 5 + 3) → total below reserved and no-op refused in the form → **adjustment response
lost after commit**: "outcome unknown" with the key, form locked, same-key retry returns the original
(applied once) → **transition response lost**: same-key retry shows the original operation and the current
order → **expired re-authentication**: dedicated sign-in panel, nothing executed, new code, action still
unsent, explicit re-confirmation with the kept reason → cancellation releases only that order's reservation →
**suspension while an administrator has the order open**: shipping refused by the server, page re-read,
shipping disabled with the explanation, cancellation still possible; trader sessions ended; order and
reservation untouched → re-approval, shipping (stock consumed), delivery (terminal) → ledger sums equal
balances → 429 (Retry-After) and 5xx (request reference) shown as errors, never empty lists → a slower older
filter response never replaces a newer one → sign-out with an unresolved operation asks first → traders get
the forbidden view on `#/admin/*` and **made no `/api/v1/admin` request**.

### Stage 12 — what was built
| Area | Files | Summary |
|---|---|---|
| **Catalog consistency (server)** | `src/server/services/products.ts` | Trader list, detail, brand filter and counts exclude products of **inactive categories** (detail → identical 404; `?category=<inactive>` → existing 400). Administrator views unchanged; snapshots/reservations untouched |
| **Secure keys** | `src/web/api/client.ts`, `pages/cart/Checkout.tsx` | `newRequestKey` throws `SecureRandomUnavailableError` without `crypto.getRandomValues` (no fallback); checkout and admin screens show an explicit message and send nothing |
| Admin API | `src/web/api/admin.ts` | one function per real endpoint (merchants, products, inventory, ledger, adjustments, orders, transitions) with response guards |
| Admin logic | `src/web/admin/logic.ts`, `admin/unresolved.ts` | exact money parsing (no rounding), whole numbers, adjustment preview, merchant transition table (presentation), barcode/image rules; in-memory count of unresolved operations |
| Safe operations | `hooks/useOperation.ts`, `pages/admin/{OperationNotice,Reauth}.tsx`, `session/identity.tsx` (`refresh`) | sending/unknown/reauth/rejected/done; one key per confirmed intention; same-key retry of the exact payload; real sign-in panel for 428, then identity refresh, record re-read, explicit re-confirmation |
| Screens | `pages/admin/{AdminHome,Merchants,Products,Inventory,AdminOrders}.tsx` | landing, merchant list/detail/status, product list/create/edit/activation, inventory list/ledger/adjustment, order list/detail/transitions |
| App | `App.tsx`, `layouts/Shells.tsx`, `hooks/useLoad.ts` (`useStickyLoad`), CSS | admin routes mounted only in the administrator shell; landing nav entry; record kept on screen while re-reading so drafts survive |

### Checks run in stage 12 (2026-11-12 UTC, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ 0 errors |
| Production build | `npm run build` | ✅ |
| Full suite | `npm run check` | ✅ **473 tests, 473 pass, 0 fail** (+15: inactive categories 1 block, secure key 1, admin logic/markup 13) |
| Clean reproduction ×3 | tracked + new files → `npm ci` → typecheck + `npm test` ×3 | ✅ 473/473 each run |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities; package.json/lockfile and migrations unchanged |
| **Administration lifecycle** | Chromium (Playwright), production build, real server process, disposable database, real sessions, 2 administrators + 2 merchants | ✅ **125/125 checks** (flow above); widths 360, 375, 768, 1366 on 10 administration pages without page-wide horizontal scroll; drawer opens/closes (Escape); collapsed filters on phones; no CSP violations or unexpected console errors |
| Stage-11 merchant journey (regression) | same harness | ✅ 87/87 |
| Automated accessibility | axe-core 4.10.2 (scratch install), WCAG 2.0/2.1 A+AA rules | ✅ 0 violations on 21 states: 10 administration pages at 360 px and 1366 px + drawer open. Automated rules only |
| Screen readers, other browsers, real HTTPS | — | NOT RUN |

Test-only setup outside the UI (disposable database): the second administrator row (see weaknesses), minimum
order 0 (settings are stage 14), and moving one session's sign-in time back 16 minutes to expire recent
authentication. Orders were placed by the merchants' own sessions through the real API; everything else went
through the screens. Each browser context used its own client address via `TRUST_PROXY`.

**Defects found by the browser run and fixed:** the re-authentication panel stayed on screen after a
successful sign-in (operation state not cleared) → cleared, with an explicit "prepared action not executed"
notice and a re-confirm button; the terminal-state message was missing after the final transition.

### Mutation evidence (16 mutants, each restored)
| Mutation | Result | Caught by |
|---|---|---|
| Trader list / detail / brand counts include inactive categories (3) | caught | products integration tests |
| Weak `Math.random` fallback for keys | caught | client unit test + source rule |
| Money: 3 decimals accepted / float multiplication | caught | admin logic tests (0.29, 1.15 cases) |
| Barcode: empty string kept / trimmed or zeros stripped | caught | admin logic tests |
| Preview: total equal to reserved refused / no-op not flagged | caught | admin logic tests |
| Image: non-https allowed | caught | admin logic tests |
| Merchant table: approved→pending without reason | caught | admin logic tests |
| Unresolved counter released twice | caught | admin logic tests |
| Cancellation explanation loses "this order only" | caught | markup test |
| **Same-key retry sends a NEW key** (browser) | caught | lifecycle run — and **also blocked by another layer**: the new request carried the old expected version and the server refused it, so no second movement was written |

Not mutation-tested (verified by the browser run only): no automatic execution after re-authentication, the
sign-out guard, stale admin filter responses.

### Limitations (known)
See "known weaknesses" above. Not in this stage by design: CSV import, settings administration, reports,
print/export, backup/recovery, password/MFA recovery, payments, deployment, category and administrator
management.

### Open questions
None.

### Remaining blockers
None for stage 13.

### Files changed in stage 12 (all under `alkhayr-b2b/`)
Server: `src/server/services/products.ts`.
Web new: `src/web/api/admin.ts`, `src/web/admin/{logic,unresolved}.ts`, `src/web/hooks/useOperation.ts`,
`src/web/pages/admin/{AdminHome,AdminOrders,Inventory,Merchants,OperationNotice,Products,Reauth}.tsx`.
Web modified: `src/web/{App.tsx}`, `src/web/api/client.ts`, `src/web/hooks/useLoad.ts`, `src/web/layouts/Shells.tsx`,
`src/web/pages/cart/Checkout.tsx`, `src/web/session/identity.tsx`, `src/web/styles/components.css`.
Tests: new `tests/unit/web-admin.test.ts`; modified `tests/integration/{products,web-build}.test.ts`, `tests/unit/web-client.test.ts`.
Docs: `README.md`, `docs/{API_CONTRACT,FRONTEND_API,DESIGN_SYSTEM,SECURITY,THREAT_MODEL,DECISIONS,MIGRATION,PROJECT_STATE}.md`.
Not touched: migrations, package files, other server services.

### How to continue
Next: send **PROMPT 13**. The administration screens are in place on the existing endpoints; later stages
(import, settings, reports/print, backup, recovery, deployment) plug into the same shell, `useOperation`
and the re-authentication panel.

---

## Stage 11 record (retained)

### Stage 11 — known weaknesses first
- **Username-lockout availability risk is still open** (SECURITY §7, T40): anyone can lock a username's
  sign-in for 15 minutes. Stage 16 / release gate.
- **Stock inference** through repeated order or quote attempts (T57, T73) is slowed by per-merchant limits,
  not eliminated.
- **Stage-09 database consistency gaps** (event without state change; reserve row without allocation) remain
  service-enforced only and are carried to stage 16; the UI neither hides nor repairs them.
- Logging out discards a pending (unclear) order submission from this browser; its outcome must then be
  checked in "طلباتي" (the server never creates a second order for the same key, but a new submission after
  logout gets a new key).
- No password reset or MFA recovery exists in the portal (documented on the sign-in page).
- Products in an inactive category still appear in the trader catalog (stage-06 behaviour); ordering them is
  refused by the server with `PRODUCT_UNAVAILABLE` and the UI explains it. **Fixed in stage 12** (hidden from
  the trader catalog).
- Browser verification: Chromium only, plain HTTP test origin; axe-core automated rules only (no manual
  screen-reader test).

### Stage 11 — what works end to end (verified in Chromium against the production build)
Register (generic response, no auto sign-in) → pending account (profile correction only; no catalog/order
requests) → administrator approval through the real API → explicit status refresh → catalog (server
categories/brands, search, sort, load more, stale-search protection, filters kept when returning from a
product) → product detail → cart (exact subtotal, quantities, remove, confirmed clear) → checkout quote with
the configured shipping (50.00) and tax (14%) → price change shown as a conflict and accepted explicitly →
submission with a deliberately interrupted response → "outcome unknown" → page refresh keeps key + payload →
cart edited meanwhile → retry sends the ORIGINAL payload with the same key → server replays the existing
order (exactly one order) → order page with snapshot data → product renamed/repriced and profile changed →
order unchanged → order list/filter → profile version conflict resolved by re-applying → second merchant on
the same browser (draft of the first removed, foreign order 404) → session expiry and suspension remove the
UI → logout (server revocation verified, draft cleared, back button shows nothing) → password change (all
sessions ended, old password refused, new accepted) → administrator sign-in with the explicit OTP option
(missing/wrong OTP and missing option all generic).

### Stage 11 — what was built
| Area | Files | Summary |
|---|---|---|
| **Server (minimal addition)** | `src/server/services/orders.ts`, `routes/orders.ts`, `auth/rate-limit.ts` | `evaluateOrderLines` extracted unchanged from order creation (stage 08/09 tests pass unchanged); new read-only `POST /api/v1/orders/quote` (approved, CSRF/Origin/JSON, strict body, read transaction, no writes, `order_quote_account` 60/10 min) |
| Endpoints and contracts | `src/web/api/{endpoints,contracts,client}.ts` | one function per real endpoint; guards for login, registration, password, profile, filters, product, order, quote; request keys from `getRandomValues` |
| Identity | `session/identity.tsx` | `handleAuthFailure` (401 → expired; 403 ACCOUNT_PENDING/ACCESS_CHANGED → re-read), `signedOut`, bfcache re-check, drafts cleared on logout |
| Auth screens | `pages/auth/{Login,Register,PasswordChange}.tsx` | generic failures, explicit administrator option with OTP, fresh pre-login token, exact credentials, password managers, error summary focus |
| Catalog | `pages/catalog/*`, `hooks/{useLoad,usePaged}.ts` | filters from the server, search, sort, load more, stale-request protection, product detail, safe unavailable state |
| Cart and drafts | `cart/{model,storage,CartContext}.ts(x)`, `pages/cart/CartPage.tsx` | reviewed price/pack kept as expected values; limits; exact subtotal; the only storage module (scoped, validated, 7-day expiry) |
| Checkout | `pages/cart/Checkout.tsx`, `checkout/submission.ts` | quote review, conflict handling with explicit acceptance, one key per intended submission, unknown-outcome recovery with same-request retry, deliberate discard |
| Orders | `pages/orders/Orders.tsx` | list with state filter and load more; snapshot detail, timeline (no admin names/reasons), reorder into a new cart from current products |
| Profile | `pages/Account.tsx` | GET/PATCH own profile with expected version; conflict keeps unsaved values and shows the current record; status refresh |
| App | `App.tsx`, `router.tsx`, `layouts/Shells.tsx` | routes per identity (pending / merchant / admin incl. own-company purchasing), UI keyed by user+merchant, internal-only navigation |
| Components | `ErrorSummary.tsx`, `Form.tsx`, `QuantityStepper.tsx`, `Summary.tsx`, `Toast.tsx`, CSS | error summary, stable field ids, accessible label suffix, LTR-isolated rates, top-positioned toasts, cart/filter styles |

### Checks run in stage 11 (2026-11-12 UTC, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ 0 errors |
| Production build | `npm run build` | ✅ (via `npm test` and the clean copies) |
| Full suite | `npm run check` | ✅ **458 tests, 115 suites, 458 pass, 0 fail** (+16: quote HTTP 4, cart/draft/submission 10, client 2) |
| Clean reproduction ×3 | tracked + new files → `npm ci` → typecheck + `npm test` ×3 | ✅ 458/458 each run |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities; package.json/lockfile and migrations unchanged |
| **End-to-end browser journey** | Chromium (Playwright), production build, real server process, disposable database, real sessions | ✅ **87/87 checks** (flow above); widths 360, 375, 768, 1366 without page-wide horizontal scroll on catalog, order, orders, account, cart; bottom tab bar does not cover cart actions; skip link and focus checks; no CSP violations |
| Automated accessibility | axe-core 4.10.2 (scratch install, not a project dependency), WCAG 2.0/2.1 A+AA rules | ✅ 0 violations on 7 states: registration with errors (375), catalog (375), cart (375), order detail (375), catalog (1366), account (1366), sign-in (1366). Automated rules only: they do not prove screen-reader usability |
| Screen readers, other browsers, real HTTPS | — | NOT RUN |

Test setup used outside the UI (disposable, test-only): the administrator row (equivalent to `setup-admin`),
26 filler products via the ledger-compliant fixtures (for "load more"), and tax/shipping values in
`business_settings` (the settings API is stage 14). Approval, products, stock, prices and suspensions went
through the real administrator API. Each browser context used its own client address via `TRUST_PROXY`, so
production rate limits applied unchanged.

**Defects found by the browser journey and fixed:** `crypto.randomUUID` is unavailable outside secure contexts
(submit silently failed on plain HTTP) → request keys from `getRandomValues` (+ unit test); the "outcome unknown"
panel appeared while the request was still being sent → sending state shown instead; toasts covered cart actions
on phones → moved to the top; catalog filters filled the first phone screen → collapsible; long product names
repeated in cart labels → accessible-only suffix; «14%» rendered as «%14» → LTR isolation.

Regression tests adjusted: the stage-10 "no browser storage anywhere" source/bundle tests now allow storage only in
`src/web/cart/storage.ts` and additionally assert that module contains no token/password/code/buyer fields and that
`sessionStorage` is never used (reconciliation with SPEC §7, D-115); the totals markup test expects the
LTR-isolated rate. No protection removed.

### Mutation evidence (19 mutants in 21 runs, each restored)
| Mutation | Result | Caught by |
|---|---|---|
| S01–S04 quote without approval / without CSRF / without rate limit / non-strict body | caught | quote HTTP tests |
| S05 shared evaluation drops the stock check | caught | order AND quote tests (shared code) |
| S06 quote always reports the minimum met | caught | quote amounts test |
| C01 same key for every submission / C02 lost response treated as definite failure | caught | submission unit tests |
| C03 draft key not scoped / C04 no purge on switch / C05 stored lines not validated | caught | draft storage unit tests |
| C06 expected price not the reviewed one | caught (second attempt) | first attempt was an **invalid, equivalent mutant** (`price + 0 … \|\| 1` equals the price); replaced by a constant price → caught |
| C07 sign-in trims the password / C08 reuses a session token instead of a fresh pre-login token | caught | client request test |
| C09 storage used outside the draft module | caught | source and bundle tests |
| J01 logout keeps drafts | caught | browser journey |
| J02 retry sends the current (edited) cart under the old key | caught | browser journey — **by another layer**: the server refused the changed payload (`IDEMPOTENCY_KEY_REUSED`), so no wrong order was created; the first run of this mutant **survived** because the journey did not yet edit the cart (scenario fixed) |
| J03 stale-search check and loop abort removed | **survived** | **blocked by the independent effect-cleanup abort** (the old request is cancelled on query change) |
| J04 all three stale-search layers removed | caught | browser journey (older results replaced newer ones) |

### Limitations (known)
See "known weaknesses" above. Additionally: no print/export (stage 14), no administration screens (stage 12),
no trader cancellation (no such endpoint), Chromium-only verification.

### Open questions
None.

### Remaining blockers
None for stage 12.

### Files changed in stage 11 (all under `alkhayr-b2b/`)
Server: `src/server/services/orders.ts` (evaluation extracted + quote handler), `src/server/routes/orders.ts`,
`src/server/auth/rate-limit.ts`.
Web new: `src/web/api/endpoints.ts`, `src/web/cart/{model.ts,storage.ts,CartContext.tsx}`, `src/web/checkout/submission.ts`,
`src/web/hooks/{useLoad,usePaged}.ts`, `src/web/components/ErrorSummary.tsx`, `src/web/pages/auth/{Login,Register,PasswordChange}.tsx`,
`src/web/pages/catalog/{Catalog,ProductDetail}.tsx`, `src/web/pages/catalog/cartMessages.ts`, `src/web/pages/cart/{CartPage,Checkout}.tsx`,
`src/web/pages/orders/Orders.tsx`.
Web modified: `src/web/{App.tsx,router.tsx}`, `src/web/api/{client,contracts}.ts`, `src/web/session/identity.tsx`, `src/web/pages/Account.tsx`,
`src/web/layouts/Shells.tsx`, `src/web/components/{Form,QuantityStepper,Summary,Toast}.tsx`, `src/web/styles/{components,layouts}.css`.
Tests: new `tests/unit/web-cart.test.ts`; modified `tests/integration/{orders,web-build}.test.ts`, `tests/unit/{web-client,web-components}.test.ts`.
Docs: `README.md`, `docs/{API_CONTRACT,FRONTEND_API,DESIGN_SYSTEM,SECURITY,THREAT_MODEL,DECISIONS,MIGRATION,PROJECT_STATE}.md`.
Not touched: migrations, package files, other server services.

### How to continue
Next: send **PROMPT 12** (administration screens) on the existing admin endpoints (merchants, products,
inventory, orders/transitions), reusing these components, the `usePaged`/`useLoad` hooks, per-administrator
operation keys and the 428 re-authentication flow (`#/login?admin=1&reason=reauth`).

---

## Stage 10 record (retained)

### What was built
| Area | Files | Summary |
|---|---|---|
| Tokens and styles | `src/web/styles/{tokens,fonts,base,components,layouts}.css` | owner palette with computed contrast; IBM Plex Sans Arabic (OFL 1.1) bundled locally; logical properties; visible offset focus ring; reduced-motion support |
| Formatting | `src/web/format.ts`, `labels.ts` | exact integer EGP formatting (`1,255.50 ج.م`), informational per-piece price, Arabic plural forms for cartons/pieces/lines, basis points, Cairo dates; shared Arabic status labels |
| Components | `src/web/components/*` | buttons/icon buttons (busy state), form fields (password, OTP, errors), search/filter bar, status/availability/merchant/allocation/category badges, spinner/skeleton, empty/error/conflict states, data table + keyset "load more", modal dialog/confirm/drawer, product card + image fallback, quantity control, order timeline, totals, toasts, LTR/money primitives, icons |
| Shells and states | `src/web/layouts/{Shells,States}.tsx`, `pages/Account.tsx` | AuthLayout, MerchantLayout (bottom tabs on phones), AdminLayout (sidebar / drawer); loading, signed out, expired, pending, reauthentication, forbidden, not found, network failure; read-only account page |
| API client and identity | `src/web/api/{client,contracts}.ts`, `session/identity.tsx` | typed contracts from the real responses, distinct failure kinds, branded session vs pre-login CSRF tokens, no storage, no auto-retry; identity → shell; real logout |
| App and entries | `App.tsx`, `main.tsx` (production), `main.dev.tsx` (development + gallery), `router.tsx` | honest placeholders for stage 11/12 areas; no administrator data before identity |
| Development gallery | `src/web/gallery/*` | every component and identity state with synthetic fixtures; dev builds only |
| Build | `scripts/build.mjs` | entry chosen by mode (gallery never in production); UTF-8 output |
| Font licence | `licenses/IBM-Plex-Sans-Arabic-OFL-1.1.txt`, preserved CSS notice | |
| Dependency | `@fontsource/ibm-plex-sans-arabic@5.3.0` (devDependency, exact) | fonts only; `npm audit` 0 |

Design rules, contrast table and component catalogue: `docs/DESIGN_SYSTEM.md`; client rules: `docs/FRONTEND_API.md`.
**No server code, migration, business rule, price calculation or stock logic changed** (`git diff src/server migrations src/shared` empty).

### Checks run in stage 10 (2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check (server, tests, web) | `npm run typecheck` | ✅ 0 errors (includes the compile-time CSRF-type separation assertions) |
| Production build | `npm run build` | ✅ 1 JS (≈ 257 KB minified, UTF-8), 1 CSS (≈ 25 KB), 8 woff2 (≈ 257 KB), logo; all in the manifest with their types |
| Full suite | `npm run check` | ✅ **442 tests, 109 suites, 442 pass, 0 fail** (+27: format 4, client 8, components 9, build/preview/source 6) |
| Clean reproduction ×3 | tracked + new files → `npm ci` → typecheck + `npm test` ×3 | ✅ 442/442 each run |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities (one new exact-pinned font package) |
| Static-file / CSP regressions | existing server tests + new build tests | ✅ manifest allow-list, traversal, canary and integrity tests pass; CSP string unchanged |
| Contrast | WCAG formula script over every token pair | ✅ all text pairs ≥ 5.76:1 (table in DESIGN_SYSTEM.md); two non-text pairs documented |
| **Real browser (Chromium, Playwright)** | real server processes (production and development builds), temporary database, real accounts signed in through the API | ✅ **119/119 checks** at 375×812, 768×1024, 1366×900 |
| Automated accessibility audit (axe or similar) | — | NOT RUN (no tool installed; keyboard, focus, labels and contrast checked as listed) |
| Screen reader (NVDA/VoiceOver/TalkBack) | — | NOT RUN |
| Other browsers (Firefox, Safari/iOS, Android Chrome) | — | NOT RUN (Chromium only) |
| Real HTTPS / proxy | — | NOT RUN (stage 17); over plain HTTP Chrome reports COOP as ignored (expected) |

**What the browser checks cover — component previews vs real workflows.**
- *Real (production build, real sessions):* signed-out shell; `lang="ar" dir="rtl"`; bundled font loaded;
  approved trader shell (no admin links, catalog/orders links, logout reachable) on all widths; trader
  on an admin path → forbidden view; account page; **real logout** back to signed-out; pending
  merchant (no catalog/orders/admin links); administrator shell with sidebar (desktop) and drawer
  (phone/tablet: keyboard open, focus inside, logout inside, Escape closes, focus restored); skip link is
  the first Tab stop; `/auth/me` network failure → network error state (not "signed out"); no
  horizontal page overflow; **no CSP violations**; `#/__gallery` in production shows the normal app.
- *Component previews only (development build, synthetic data):* product cards show status text and
  no stock numbers; barcode in an isolated LTR run; missing/broken images → placeholder; modal dialog
  initial focus, Tab wrap, Escape, focus restoration; busy confirm dialog ignores Escape; tables scroll
  inside their region on phone/tablet; every layout preview without page overflow; reduced motion
  disables animations; the gallery makes no API calls and no external requests.
- **Not verified, because it does not exist yet:** sign-in/registration screens, catalog browsing,
  cart and order submission, order history screens, administrator business screens. A gallery
  screenshot is not evidence that registration, ordering or fulfillment works end-to-end in the UI.

Console output in the real-shell runs contained only explained, expected messages (COOP ignored over
plain HTTP; the 401 of `/auth/me` while signed out; the request the network-failure check aborts); the
script lists them separately and fails on anything else.

**Defects found and fixed during visual review:** Arabic words split mid-word («العنوا/ن»;
`overflow-wrap: anywhere` → `break-word`); Tab could leave a modal dialog for the browser UI (focus
wrap added); logout arrow not mirrored in the drawer button (directional icons mirror by default);
tables squeezed columns on phones instead of scrolling (minimum table width + `wide` columns);
product placeholder too tall on phones; sticky gallery banner hid the shell header in previews.

#### Mutation evidence (14 scripted edits, each restored)
| Mutation | Result | Caught by |
|---|---|---|
| W01 production entry imports the gallery | caught | bundle test (gallery/fixture strings in production) |
| W02 client stores the CSRF token in localStorage / W03 bundle uses sessionStorage | caught | client test (storage access fails) / bundle scan |
| W04 catalog guard accepts stock counts | caught | client contract test |
| W05 428 mapped to forbidden / W12 automatic retry after network failure | caught | client tests |
| W06 merchant shell shows admin links / W07 pending merchant gets catalog/orders | caught | shell markup test |
| W08 identifiers not LTR-isolated / W09 piece price labelled as the selling price | caught | product card test |
| W10 CSP gains `unsafe-inline` | caught | CSP test |
| W11 retry offered for 403 | caught | error-state test |
| W13 remote `@import` font in CSS | **survived first**, then caught | the test only rejected `@import url(http…)`; esbuild emits `@import "https://…"`. Test tightened to reject any `@import` (a real gap, not score padding) |
| W14 trader timeline shows an actor | caught | timeline test |
Interaction behaviours (focus trap, Escape, drawer) are covered by the Chromium checks, not by mutants.

### Limitations at the end of stage 10
- **Username-lockout availability risk is still open** (SECURITY §7, T40) — stage 16 / release gate.
- Stage 09 database/service boundary limitations stay as recorded (DATABASE.md §14) for stage 16; the UI does not repair or hide them.
- Sign-in, registration and all business screens are not built yet (stages 11–12); in stage 10 accounts sign in through the API only.
- Browser verification: Chromium only; no screen-reader or automated axe audit; no real HTTPS.
- Product photos depend on administrator-supplied https URLs; none exist yet (placeholder shown).
- Logo derivative is a PNG (76 KB); an SVG or smaller WebP derivative could be produced later from the original.

### Files changed in stage 10 (all under `alkhayr-b2b/`)
New: `src/web/{format.ts,labels.ts,main.dev.tsx}`, `src/web/components/*` (14 files), `src/web/layouts/{Shells,States}.tsx`,
`src/web/pages/Account.tsx`, `src/web/session/identity.tsx`, `src/web/gallery/{Gallery.tsx,fixtures.ts,types.ts,gallery.css}`,
`src/web/styles/{fonts,base,components,layouts}.css`, `licenses/IBM-Plex-Sans-Arabic-OFL-1.1.txt`, `docs/{DESIGN_SYSTEM,FRONTEND_API}.md`,
`tests/helpers/web.ts`, `tests/unit/{web-format,web-client,web-components}.test.ts`, `tests/integration/web-build.test.ts`.
Modified: `scripts/build.mjs`, `src/web/{App.tsx,main.tsx,router.tsx}`, `src/web/api/{client,contracts}.ts`, `src/web/styles/tokens.css`,
`package.json`, `package-lock.json`, `README.md`, `docs/{SECURITY,THREAT_MODEL,DECISIONS,MIGRATION,PROJECT_STATE}.md`.
Deleted: `src/web/styles/globals.css` (replaced). Not touched: server code, migrations, shared business rules.

---

## Stage 09 record (retained)

### What was built
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

### Checks run in stage 09 (2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
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

#### Mutation evidence (44 scripted edits, each restored; fulfillment or schema test file)
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

#### Required tests → evidence (real HTTP unless noted)
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

### Limitations at the end of stage 09
- **Username-lockout availability risk is still open** (SECURITY §7, T40) — stage 16 / release gate.
- No partial fulfillment, returns, post-shipment cancellation, payments or shipping integrations (out of scope).
- The database does not force an event to be followed by its state change, nor a reserve row by its
  allocation; the service writes them in one transaction and inconsistencies would block the order (DATABASE.md §14).
- Concurrency verified within the supported single-server deployment only; no multi-process or load testing.
- Traders do not see cancellation reasons (D-104); trader-facing messaging may be added deliberately later.
- No UI yet (stages 10–12); summary/print (14); reports (14); exports (13).

### Files changed in stage 09 (all under `alkhayr-b2b/`)
New: `migrations/0005_order_fulfillment.sql`, `src/server/services/fulfillment.ts`, `src/server/routes/admin-orders.ts`,
`tests/integration/fulfillment.test.ts`.
Modified: `src/server/app.ts`, `src/server/services/{audit,orders,products}.ts`, `src/shared/errors.ts`,
`tests/helpers/database.ts`, `tests/integration/{auth-security,database,orders,server}.test.ts`,
`tests/unit/{database-migrations,database-schema}.test.ts`, `migrations/README.md`, `README.md`,
`docs/{API_CONTRACT,DATABASE,SECURITY,THREAT_MODEL,DECISIONS,MIGRATION,PROJECT_STATE}.md`.
Not touched: migrations 0001–0004, dependencies/lockfile, web UI, repository-root files.

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
