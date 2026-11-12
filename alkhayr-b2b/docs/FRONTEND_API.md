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
