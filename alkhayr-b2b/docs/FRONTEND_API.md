# ALKHAYR — Browser API client (stage 10)

Files: `src/web/api/client.ts` (transport), `src/web/api/contracts.ts` (types and guards transcribed
from `docs/API_CONTRACT.md` and the server code), `src/web/session/identity.tsx` (identity state).

## Rules
1. **Same-origin cookie authentication only.** `fetch` with `credentials: 'same-origin'`,
   `cache: 'no-store'`, `redirect: 'error'`; only relative `/api/v1/…`, `/healthz`, `/readyz` paths are
   accepted (anything else throws before a request is made).
2. **Nothing sensitive is persisted.** No session token, password, MFA code or CSRF token in
   `localStorage`, `sessionStorage` or `document.cookie` (enforced by tests on the source and bundles).
   The session CSRF token from `/auth/me` lives in React state only. Since stage 11 exactly one module,
   `src/web/cart/storage.ts`, stores the order **draft** (see "Drafts" below); tests forbid storage
   anywhere else and forbid token/password/code/buyer fields in that module.
3. **Two CSRF contracts, two types.** `SessionCsrfToken` (from `/auth/me` / login; sent with every
   authenticated mutation via `apiMutate`) and `PreLoginCsrfToken` (from `/auth/csrf`; only for
   `apiPreLogin` → `/auth/login`, `/auth/register`). The branded types make passing one where the other
   is required a compile error (asserted with `@ts-expect-error` in the tests).
4. **Distinct failure kinds** — `network` (no response; for a mutation the outcome is unknown and the
   message says so), `unauthenticated` 401, `forbidden` 403, `not_found` 404, `conflict` 409,
   `payload_too_large` 413, `reauth_required` 428, `validation` 400/415/422, `rate_limited` 429 (with
   `retryAfterSeconds`), `unavailable` 503, `server` 5xx, `invalid_response` (body missing or failing
   its guard). Each failure keeps `code`, the Arabic catalog message, `requestId`, server `fields`
   and `current` (conflict state).
5. **A failure is never empty data.** Lists are validated with `isPage(guard)`; a malformed body is
   `invalid_response`. The trader catalog guard rejects responses carrying stock counts.
6. **No automatic retries.** Exactly one `fetch` per call. Mutations carry the caller's idempotency
   key (`newRequestKey()` once per intended action); a manual retry re-sends the same request/key.
7. **No administrator data before identity.** The app requests only `/auth/me` until it knows the role;
   administrator screens (stage 12) mount only inside `AdminLayout`.
8. **Browser bundle hygiene.** No server configuration, crypto modules or secrets are imported by
   `src/web`; the build fails if `process.env` survives in browser output (stage 01 rule).

## Identity states (`useIdentity`)
`loading` → `authenticated {me, csrf}` | `signed_out` (401 on first load) | `expired` (401 after a
session existed in this page) | `network_error {failure}`. Shell kind: `admin` (role) → `merchant`
(approved) → `pending`. `logout()` calls `POST /auth/logout` and only clears the identity on success;
on failure the session is still valid and the error is shown.

## Merchant routes (stage 11)
Public: `#/login` (`?reason=expired|reauth|password-changed|logged-out`, `?admin=1`), `#/register`.
Approved trader (and administrator for the own company, via "مشتريات الشركة"): `#/catalog`
(`?q&category&brand&sort`), `#/catalog/<id>`, `#/cart`, `#/checkout`, `#/orders` (`?state`),
`#/orders/<id>` (`?received=new|replayed`), `#/account`, `#/account/password`.
Pending trader: `#/account`, `#/account/password`; everything else shows the pending screen without
requesting catalog/order data. Route parameters are validated (UUIDs, known values); there is no redirect
parameter, so no external navigation target can be injected.

## Endpoint functions (`api/endpoints.ts`)
`fetchPreLoginToken`, `login`, `register`, `changePassword`, `getProfile`, `patchProfile`,
`listProducts`, `getProduct`, `getCatalogFilters`, `quoteOrder`, `createOrder`, `listOrders`, `getOrder`
— one per real endpoint; no other endpoints exist.

## Loading
`useLoad` / `usePaged` abort the previous request when the query changes and ignore responses for an
outdated query, so an older search never replaces newer results (verified in the browser with a delayed
response). Failures go through `handleAuthFailure` (401 → expired; 403 ACCOUNT_PENDING/ACCESS_CHANGED →
identity re-read) and are rendered as errors, never as empty lists.

## Drafts (cart and pending submission)
- Key `alkhayr.v1.draft.<userId>.<merchantId>`; value `{v:1, savedAt, lines, pending}`.
- `lines`: product id, name, brand, category, **reviewed** carton price and pack size, minimum, cartons.
- `pending`: `{requestKey, payload (exact body sent), createdAt}` — written synchronously before the
  request leaves.
- Read back through strict validators (malformed entries dropped; corrupt JSON removed).
- Retention 7 days from last change; removed on logout, on successful submission (the cart only if it still
  equals what was sent), and other accounts' drafts are deleted when a different identity signs in.
  If storage is unavailable the cart lives in memory for the current page only.
- Limitation: logging out discards a pending (unclear) submission; its outcome is then checked in
  "طلباتي" after signing in again.

## Submission (checkout)
1. `POST /orders/quote` with the reviewed lines → server amounts (shipping, tax, minimum) shown as an
   estimate with its time; conflicts (price/packaging, unavailable, stock status, minimum) are explained
   and fixed only by an explicit user action (accept current terms, remove items, edit quantities).
2. "تأكيد وإرسال الطلب" creates `{requestKey, payload}`, stores it, sends `POST /orders` once.
3. Outcome: 201/200 → order page (`received=new|replayed`), draft cleared; no response / 5xx / malformed →
   **unknown**: panel with "إعادة إرسال نفس الطلب" (same key + exact payload) and "تجاهل" (confirmation,
   advises checking orders first); 429 → not processed, retry later with the same request; 401 → session
   ended, draft kept for the same account; 4xx/409 definite refusals → key released, conflict explained,
   a corrected cart becomes a new payload with a new key.
4. While a submission is unresolved, a different payload cannot be sent; the panel warns when the cart has
   changed since (the retry sends the original order).

## Administration (stage 12)
Routes (administrator shell only; a trader gets the forbidden view and the client never requests an
administration endpoint): `#/admin`, `#/admin/merchants` (`?status&q&sort`), `#/admin/merchants/<id>`,
`#/admin/products` (`?q&category&active&sort`), `#/admin/products/new`, `#/admin/products/<id>` (`?created=1`),
`#/admin/inventory` (`?q&status&active&sort`), `#/admin/inventory/<id>`, `#/admin/orders`
(`?state&q&sort&merchantId`), `#/admin/orders/<id>`. Ids must be UUIDs.

Functions: `api/admin.ts` — `listMerchants`, `getMerchant`, `changeMerchantStatus`, `listAdminProducts`,
`getAdminProduct`, `createProduct`, `updateProduct`, `listInventory`, `getLedger`, `adjustInventory`,
`listAdminOrders`, `getAdminOrder`, `transitionOrder`. Field names are the server's (`cartonPriceCents`,
`expectedVersion`, `operationKey`).

**Keys.** `newRequestKey()` uses `crypto.getRandomValues` only and throws `SecureRandomUnavailableError` when
it is missing; callers show `SECURE_RANDOM_MESSAGE` and send nothing (no `Math.random`, time or counter
fallback — enforced by a source rule). It works on plain HTTP (the browser test origin); this proves the key
source, not transport security: production still requires HTTPS (secure cookies, HSTS).

**`useOperation` (inventory adjustments, order transitions).** A new key is created only when the operator
confirms a new intention. States: `sending` (buttons disabled; a second tap is ignored), `unknown` (no
response, 5xx or malformed response: the exact payload and key are kept in memory, the form is locked, the
only actions are "retry the same operation" or "discard after checking the history"), `reauth` (428: nothing
executed), `rejected` (definite refusal: nothing applied; the record is re-read), `done` (result, possibly a
replay — shown as "already recorded / not repeated" with the original operation and the current record).
Refresh/close (`beforeunload`) and sign-out ask for confirmation while an operation is unresolved.

**Re-authentication (428).** `ReauthPanel` is a dedicated sign-in form (username from the session, password,
new authenticator code) posting to the real login endpoint with a fresh pre-login token; inputs are cleared;
then `identity.refresh()` loads the new session and CSRF token silently and the screen re-reads its record.
The prepared action stays unsent and must be confirmed again (a new key). It is never a generic confirmation
dialog and never stores credentials.

**Non-idempotent writes** (product create/edit, merchant status) are never retried automatically: an unclear
outcome tells the operator to look at the current record (or search before creating again). Conflicts
(`VERSION_CONFLICT`) keep the unsaved values and show the current record; the operator chooses to re-apply or
discard. `useStickyLoad` keeps the last record on screen while re-reading, so drafts are not unmounted.

## Unresolved operations and imports (stage 13)
**Coordinator.** `admin/coordinator.ts` (`OperationCoordinator`) + `admin/operations.tsx` (`OperationsProvider`,
mounted in the administrator shell, which is remounted per identity). `useOperation(slot, {label, href}, send)` keeps
each operation under a slot (`inventory:<productId>`, `order:<orderId>`, `import`) with its operation key, exact
payload, intended action (label), owning screen and status, so it **survives navigation between administration
screens**. While a slot is sending or its outcome is unknown, a new run in that slot is refused (no silent
replacement); the only actions are a same-key, same-payload retry (sent with the CURRENT CSRF token) or an explicit
discard. A late response for a discarded operation is ignored. Results finished while the operator was elsewhere
are handled once when the screen is reopened. `UnresolvedBanner` lists unresolved operations in the shell with a
link back. The state is cleared on identity change and confirmed sign-out; it is never written to browser storage.

Limits (stated in the UI): a refresh, closing the tab, a session that expires (the shell unmounts) or sign-out lose
the in-memory key and payload. `beforeunload` is requested while something is unresolved, but browsers do not
guarantee the prompt; sign-out asks first. The operator must then reconcile the ledger / order history / product
list before repeating.

**Correction of the stage-12 note on `expectedVersion`:** the expected version blocks a duplicate that is sent
*with the old version* (e.g. a lost-response retry rebuilt with a new key from the same form). It does **not**
prevent an operator from deliberately repeating the same business action after loading the new version (e.g.
receiving the same delivery twice): only the same-key retry is protected against that, which is why the key and
payload are now kept across navigation.

**Imports.** `#/admin/imports` (`pages/admin/Imports.tsx`), functions `previewImport`, `commitImport`,
`importTemplateUrl` in `api/admin.ts`. The browser reads the chosen `.csv` (≤ 1 MiB checked before sending) as
bytes and sends them base64 — it never parses or edits the plan; the server validates. The preview shows mode, file
summary, record counts, file errors, per-record errors (also as a plain list for phones), warnings and proposed
changes/balances. Confirmation (dialog) creates one new key and sends the SAME bytes with the preview token through
the coordinator. 428 → dedicated re-authentication panel → identity refresh → the same file is previewed again
with the new token → a new explicit confirmation (new key). `IMPORT_REJECTED` / stale responses show the failing
records; expired/invalid previews offer "re-preview". Success shows the import id, mode, record count, committed
status and product/ledger links; a replay says "already recorded — not repeated".

## Stage 14: settings, checkout terms, reports, exports, printing
- **Checkout terms:** `newSubmission(cart, note, quote.amounts)` stores `expectedTerms` (shipping, taxable, tax rate)
  with the key and exact payload; a retry re-sends them unchanged. `TERMS_CHANGED` is a definite refusal: the key is
  released, the quote is recomputed and the trader must press «تأكيد وإرسال الطلب» again (new key). A stored pending
  submission without valid terms (e.g. from before this release) is dropped on load; the cart is kept.
- **Settings** (`#/admin/settings`, `pages/admin/Settings.tsx`): EGP → piastres with `parseMoneyInput(raw, max,
  allowZero)`, percent → basis points with `parsePercentToBps` (≤ 2 decimals, refused otherwise, never rounded).
  Financial/threshold changes open a confirmation listing from → to and the future-only effect. Conflicts keep typed
  values and show the current record (re-apply or discard); 428 opens the re-authentication panel and nothing is saved
  until confirmed again; an unclear outcome is never resent.
- **Reports** (`#/admin/reports?tab=orders|products|inventory|movements&from&to…`): definitions shown above each
  table; money strings formatted with BigInt (`MoneyText`). Date inputs are Cairo calendar dates.
- **Exports** (`ExportButton`, `apiDownload`, `download.ts`): POST → Blob → object URL → `a.download`. The UI says the
  file was *offered* to the browser, never that it was saved. 428 shows the re-authentication panel; the export is NOT
  repeated automatically. `EXPORT_TOO_LARGE` asks for narrower filters. Buyer contact data only via an explicit checkbox.
- **Pre-filled templates** on the import page (non-create modes), with optional name/brand/barcode filter.
- **Import history:** `#/admin/imports/history`, `#/admin/imports/<id>` (read-only; no "run again").
- **Order summaries:** `#/orders/<id>/print` (own) and `#/admin/orders/<id>/print` render without the shell; the
  «طباعة» button calls `window.print()` only after the authorized summary loaded; `styles/print.css` (A4, repeated
  table heading, no navigation/toasts in print).

## Stage 16: recovery epoch, write status and notices
- **Page epoch.** The client takes it from the first `GET /auth/me` or `POST /auth/login` (`system.recoveryEpoch`)
  and never changes it for that page. Every authenticated mutation sends `X-Recovery-Epoch: <page epoch>`; GETs
  never do.
- **Restore detected.** If a later identity response reports a different epoch, the server was restored while
  the page was open. `SystemNotice` then asks for a reload, and operations prepared on the page are never
  re-sent under the new epoch.
- **Stored submissions.** A pending order submission in localStorage records the epoch it was prepared under
  (older stored submissions count as 0), and a retry re-sends THAT epoch. After a restore the server answers:
  - 409 `RECOVERY_EPOCH_STALE` → classified as a definite refusal: the submission is discarded and a new
    review with a new key is required; the refusal stays visible even when the cart is empty;
  - 503 `WRITES_SUSPENDED` → "not processed": the submission is kept for a later retry.
- **Notices.** `SystemNotice` (all shells) explains recovery or maintenance without claiming that earlier orders
  failed. `LegacySubmissionNotice` (stage 15) is browser-verified in stage 16.
