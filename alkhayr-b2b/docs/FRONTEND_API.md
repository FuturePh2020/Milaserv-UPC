# ALKHAYR — Browser API client (stage 10)

Files: `src/web/api/client.ts` (transport), `src/web/api/contracts.ts` (types and guards transcribed
from `docs/API_CONTRACT.md` and the server code), `src/web/session/identity.tsx` (identity state).

## Rules
1. **Same-origin cookie authentication only.** `fetch` with `credentials: 'same-origin'`,
   `cache: 'no-store'`, `redirect: 'error'`; only relative `/api/v1/…`, `/healthz`, `/readyz` paths are
   accepted (anything else throws before a request is made).
2. **Nothing sensitive is persisted.** No session token, password, MFA code or CSRF token in
   `localStorage`, `sessionStorage` or `document.cookie` (enforced by tests on the source and bundles).
   The session CSRF token from `/auth/me` lives in React state only.
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
