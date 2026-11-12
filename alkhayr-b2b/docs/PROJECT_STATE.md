# ALKHAYR — Project State

| Field | Value |
|---|---|
| Last updated | 2026-11-12 |
| Current stage | **01 — Project foundation & reproducible build: COMPLETE** |
| Next stage | **02 — Database, constraints & safe migrations** (awaiting owner prompt) |
| Execution mode | BUILD_NEW (D-001) |
| Project root | `alkhayr-b2b/` (self-contained) in repo `FuturePh2020/Milaserv-UPC`, branch `ccr-b8f31a52-xk6wqg` |
| Runtime | Node.js 24.22.1 (`/opt/node24/bin` in this container; default `node` here is 22 and is refused) |
| Application | Real Node HTTP server + React SPA shell. **No database, authentication, catalog, orders or business data yet.** |

## Stage log

| Stage | Status | Evidence |
|---|---|---|
| 00 | ✅ Done (spec + capability probe) | Commit `2427e9e` |
| 01 | ✅ Done | 98/98 tests, typecheck clean, clean `npm ci` reproduction, Chromium check, `npm audit` 0 — details below |
| 02–18 | ⏳ Not started | — |

## Owner decisions received for stage 01 (all applied)
| Topic | Decision | Where |
|---|---|---|
| Categories (Q-1) | `chocolate` شيكولاتة · `candy` كاندي · `wafers_biscuits` ويفر وبسكويت · `snacks_nuts` سناكس ومكسرات | D-020, `src/shared/categories.ts`, SPEC §5.8, DATABASE products.category |
| Tax & shipping (Q-3) | 0 bps default; tax base = goods subtotal; shipping untaxed by default; shipping 0; all configurable; snapshotted per order; not a legal tax statement | D-009, `src/shared/constants.ts`, SPEC §5.1, DATABASE business_settings/orders |
| Low stock (Q-4) | Based on available; 0 = out, 1–10 = low, >10 = normal; threshold configurable; no auto-replenishment | D-016, `src/shared/stock-status.ts`, SPEC §5.10 |
| Location (Q-2) | Self-contained `alkhayr-b2b/`, no nested repo, unrelated files preserved | D-021 |

## Stage 01 — what was built
- **Toolchain** (D-022): pinned exact versions, lockfile v3 with integrity. Runtime: react 19.3.1, react-dom 19.3.1, zod 4.6.7. Dev: typescript 7.0.2, esbuild 0.28.2, @types/node 24.19.2, @types/react(-dom) 19.3.0. No Next/Vinext/ChatGPT/Express.
- **Build** (D-023): `scripts/build.mjs` bundles `dist/server/main.js` and hashed SPA assets, generates `dist/web/index.html` and the static allow-list manifest; fails if browser output references `process.env` or contains a non-allow-listed file type.
- **Server**: `src/server/main.ts` (Node version guard, config, timeouts, graceful SIGTERM/SIGINT shutdown with grace period, fail-closed startup), `app.ts` (request id, security headers, request-target parsing, Host check, router, static, error envelope, access log), `config.ts` (zod-validated typed config), `logger.ts` (JSON lines, redaction), `http/*` (router, errors, response, request-target, streaming JSON body reader, security headers, static files), `routes/health.ts`.
- **Shared**: categories, limits & business defaults, stock status, Arabic error catalog.
- **Web**: Arabic RTL `index.html`, React 19 entry, hash router, typed API client with distinct failure states (no token storage), provisional tokens/styles, logo. The page states honestly that login/catalog/orders are not enabled and shows the **real** `/healthz` result. No fake login, metrics or persistence.
- **Repo hygiene**: `.gitignore`, `.dockerignore`, `.env.example` (empty secrets), `.npmrc` (engine-strict, save-exact), `.nvmrc`.

## Commands (run from `alkhayr-b2b/`, with Node 24 on PATH)
| Purpose | Command |
|---|---|
| Install (reproducible) | `npm ci` |
| Dev loop (watch + auto-restart; reads `.env` if present) | `npm run dev` → http://localhost:3000 |
| Production build | `npm run build` |
| Start built server | `npm start` (reads `.env` if present; production needs `NODE_ENV=production`, https `APP_ORIGIN`, `APP_SECRET`, `BACKUP_KEY`) |
| Type check | `npm run typecheck` |
| Tests (builds first) | `npm test` |
| All checks | `npm run check` |

Reproducible startup: `cp .env.example .env` → `npm ci` → `npm run build` → `npm start`. Generate secrets locally with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` (twice, different values).

## Checks run in stage 01 (exact results, 2026-11-12, this container, Node 24.22.1 / npm 11.19.1)
| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | ✅ no errors (server+shared+tests project; web+shared project) |
| Build | `npm run build` | ✅ ~140 ms; outputs: `/` (index.html), `main-*.js` 230,884 B, `main-*.css` 1,698 B, logo 76,528 B |
| Tests | `npm test` | ✅ **98 tests, 13 suites, 98 pass, 0 fail** (~4 s) |
| Mutation sanity | Disabled Host check + added SPA fallback, ran integration tests | ✅ 24 tests failed as expected; restored → 62/62 integration pass |
| Clean reproduction | Copied tracked files only (no `.git`, no `node_modules`), `npm ci`, typecheck, `npm test` | ✅ 98/98 (first run exposed 2 tests depending on a git checkout; fixed to be self-contained, then 98/98) |
| Engine guard | `npm ci` with Node 22.23.4 | ✅ refused: `EBADENGINE` |
| Dependency audit | `npm audit` (registry.npmjs.org; sends dependency metadata to the registry) | ✅ 0 vulnerabilities, 57 packages (5 prod, 53 dev, 46 optional) — point in time, not a guarantee, no OS/container scan |
| Browser QA | Playwright Chromium, 360×740 and 1366×860 against built server | ✅ `dir=rtl`, `lang=ar`, logo loaded, health status «الخادم يعمل.», no horizontal scroll, 0 console errors/CSP violations/failed requests, 0 storage keys, no cookies; `#/unknown-route` shows «الصفحة غير موجودة». Screenshots inspected (not committed). |
| Dev loop | `npm run dev` | ✅ health 200; editing `App.tsx` triggered web rebuild; page 200 |
| Manual smoke | curl `/healthz`, `/`, `/api/v1/nope`, `--path-as-is /assets/../.env`, foreign Host | ✅ 200 / 200 / 404 JSON / 400 / 400 |
| Docker image build/run | — | ⛔ **NOT RUN** (stage 17; Docker Hub pulls returned 429 in stage 00) |
| Production behind HTTPS proxy / real host | — | ⛔ **NOT RUN** (no hosting in this environment) |

### Acceptance criteria → evidence
| Criterion | Evidence |
|---|---|
| Builds and starts | build + server start in every integration test; dev loop; production-mode start test |
| Real page and health respond | `GET /` serves built Arabic RTL page; every manifest asset served with type/ETag/304; `/healthz` = `{"status":"ok"}`, `no-store`, HEAD ok |
| Unknown endpoints → appropriate errors | `/api`, `/api/v1`, unknown API (GET/POST/DELETE) → JSON 404; `/catalog`, `/index.html`, `/favicon.ico`, `/assets/missing.js` → 404 (no SPA fallback); wrong method → 405 + `Allow`; >2048-byte URL → 414 |
| `.env`, source, database paths rejected | 29 attempts against a temp app root containing canary `.env`, `data/alkhayr.db`, `src/server/main.ts`, `package.json` and an unlisted file inside `dist/web` (plain, `..`, `%2e%2e`, `%2f`, `%5c`, backslash, `%00`, `//`, absolute-form, `.git`, `node_modules`, manifest, server bundle and map) → 400/404 JSON, canary never returned |
| No fake auth / metrics / mock persistence | no auth endpoints exist (POST `/api/v1/auth/login` → 404); page shows only real health; source scan test for ChatGPT/OpenAI/preview stack and token storage |
| Secrets out of source/bundle | `.gitignore`/`.dockerignore` tests; `.env.example` placeholder test; bundle canary + `process.env` checks; config errors and logs never echo secret values |
| Timeouts & graceful shutdown | header timeout 1 s → `408` and close; SIGTERM → `shutdown_complete`, exit 0, including with a keep-alive connection open |

## Limitations (known, intentional at this stage)
- No database: `/healthz` reports process liveness only; DB reachability is added in stage 02. `DATA_DIR`/`BACKUP_DIR` are validated but unused.
- `readJsonBody` is implemented and unit-tested, but no route accepts a body yet.
- `APP_SECRET`/`BACKUP_KEY` are validated but not used yet (key derivation in stage 03). Optional outside production.
- Server timeouts are checked every 1 s (`connectionsCheckingInterval`), so timeouts fire up to ~1 s late.
- Styling and fonts are provisional (system Arabic font stack); the design system is stage 10.
- `npm run dev` rebuilds and restarts but does not live-reload the browser.
- The esbuild `postinstall` script is not run (D-027); the platform binary package is used directly.
- Container image, HTTPS proxy, real hosting: NOT RUN (stage 17).

## Open questions
None blocking. (Q-1…Q-4 answered by the owner — see table above.)

## Remaining blockers
None for stage 02.

## Files changed in stage 01 (all under `alkhayr-b2b/`)
New: `package.json`, `package-lock.json`, `.npmrc`, `.nvmrc`, `.gitignore`, `.dockerignore`, `.env.example`,
`tsconfig.json`, `tsconfig.server.json`, `tsconfig.web.json`, `scripts/build.mjs`, `scripts/dev.mjs`,
`migrations/README.md`, `public/index.html`, `public/assets/brand/alkhayr-logo-480.png`,
`src/server/{main,app,config,logger}.ts`, `src/server/http/{errors,request-body,request-target,response,router,security-headers,static-files}.ts`,
`src/server/routes/health.ts`, `src/shared/{categories,constants,errors,stock-status}.ts`,
`src/web/{main.tsx,App.tsx,router.tsx,assets.d.ts}`, `src/web/api/{client,contracts}.ts`, `src/web/styles/{tokens,globals}.css`,
`tests/helpers/server.ts`, `tests/integration/server.test.ts`, `tests/security/repository-hygiene.test.ts`,
`tests/unit/{config,logger,request-body,request-target,router,shared}.test.ts`.
Updated: `README.md`, `docs/SPEC.md`, `docs/DATABASE.md`, `docs/API_CONTRACT.md`, `docs/SECURITY.md`, `docs/DECISIONS.md` (D-003/006/009/016 accepted; D-020…D-028 added), `docs/PROJECT_STATE.md`.
Not touched: repository-root `README.md`, `Dashboard.jsx`, other branches.

## How to continue
Next: send **PROMPT 02** (database). A resumed session should read this file, SPEC.md, DATABASE.md,
API_CONTRACT.md, SECURITY.md and DECISIONS.md, run `npm ci && npm run check` with Node 24, then take
the stage prompt from `docs/BLUEPRINT_AR.md`. Stage 02 must make the products.category CHECK match
`src/shared/categories.ts` and seed business_settings from `BUSINESS_SETTING_DEFAULTS`.

---

## Stage 00 record (retained)
- Blueprint read in full (742 lines), preserved verbatim as `docs/BLUEPRINT_AR.md` (SHA-256 `e6333a36…f8d5`).
- Supplied source: repo `main` had only `README.md` and `Dashboard.jsx` (an unrelated HR/tasks dashboard with mock data); other branches had no ALKHAYR code → BUILD_NEW.
- Logo stored unchanged: `assets/brand/alkhayr-logo-original.png` (1890×832 RGBA, SHA-256 `289a177d…f794`).
- Capability probe: Node 22.23.4 default + Node 24.22.1 available; real HTTP server OK; `node:sqlite` WAL persisted across processes (SQLite 3.53.4); better-sqlite3 also works; scrypt N=2^17 ≈ 342 ms; AES-256-GCM OK; `node --test` OK; npm registry and git push OK; Docker CLI present, daemon startable, Docker Hub pulls 429 → image builds unverified; Chromium/Playwright available; 4 vCPU / 16 GB RAM.
- **Hosting for end users is not available here** — deliverables are portable source + Node/Docker release for external hosting.
