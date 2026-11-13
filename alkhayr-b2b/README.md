# ALKHAYR B2B — بوابة الخير للتجار

Independent Arabic (RTL) B2B wholesale ordering portal for an Egyptian sweets & chocolate importer.

**Status:** Stage 13 complete — foundation, SQLite schema/migrations, security primitives, local
administrator enrollment, and the authentication API (register, login with admin TOTP, sessions,
CSRF, rate limits, logout, password change) and the merchant lifecycle (own profile, administrator
review/approval/suspension), product administration, the approved catalog, inventory
adjustments with an append-only ledger, pending-order creation with own-order reads, and
administrator order fulfillment with per-order stock reservations, and the Arabic RTL design system
with application shells, and the complete merchant experience in the browser (registration, sign-in,
catalog, cart, checkout preview, ordering with safe retries, order tracking, profile and password),
and the administration screens (merchant review, products, inventory and ledger, order fulfillment),
and safe CSV imports (create/update products, receive stock, set physical totals) with preview, all-or-nothing
confirmation and durable idempotency (operator guide: [`docs/IMPORT_GUIDE_AR.md`](docs/IMPORT_GUIDE_AR.md)). See [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md).

## Quick start (Node.js 24.22.1 required)
```sh
cp .env.example .env      # local development; never commit .env; set APP_SECRET + BACKUP_KEY
npm ci
npm run build
npm run db:init           # 1. once: creates data/alkhayr.db (the server never creates or migrates it)
npm run setup-admin       # 2. once, interactive terminal, server stopped: first administrator + TOTP
npm start                 # 3. or: npm run dev  -> http://localhost:3000
npm run check             # typecheck + build + tests
```
Health: `GET /healthz` (process alive) · `GET /readyz` (database ready).
Component gallery (development builds only): `npm run dev`, then `http://localhost:3000/#/__gallery`.
Operator procedures (database, administrator enrollment, upgrades): [`docs/MIGRATION.md`](docs/MIGRATION.md).

Production requires `NODE_ENV=production`, an `https://` `APP_ORIGIN`, and independently generated
`APP_SECRET` / `BACKUP_KEY` (see `.env.example`). Run one instance per data directory, on a local
disk, behind an HTTPS reverse proxy.

## Layout
`src/server` Node API, database layer and operator CLI · `src/web` React SPA · `src/shared` shared
contracts · `migrations` SQL · `scripts` build/dev · `tests` unit/integration/security · `docs`.

| Document | Purpose |
|---|---|
| `docs/BLUEPRINT_AR.md` | Original blueprint and staged prompts (verbatim) |
| `docs/SPEC.md` | Product scope, roles, business rules |
| `docs/DATABASE.md` | Implemented schema, constraints, retention and migration policy |
| `docs/MIGRATION.md` | Operator guide: init → admin enrollment → start, upgrades, startup refusals, recovery |
| `docs/IMPORT_GUIDE_AR.md` | Operator guide (Arabic): CSV import modes, templates, rules, recovery |
| `docs/API_CONTRACT.md` | `/api/v1` endpoints, errors, transitions |
| `docs/DESIGN_SYSTEM.md` | Tokens, contrast, typography, components, shells, gallery |
| `docs/FRONTEND_API.md` | Browser API client and identity rules |
| `docs/SECURITY.md` | Security policy and verification status |
| `docs/THREAT_MODEL.md` | Threats and controls |
| `docs/DECISIONS.md` | Decision log |
| `docs/PROJECT_STATE.md` | Implementation state, verification evidence, next stage |
