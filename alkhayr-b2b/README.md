# ALKHAYR B2B — بوابة الخير للتجار

Independent Arabic (RTL) B2B wholesale ordering portal for an Egyptian sweets & chocolate importer.

**Status:** Stage 02 complete — foundation plus SQLite schema, migrations and operator CLI. There is
no login, catalog or ordering yet. See [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md).

## Quick start (Node.js 24.22.1 required)
```sh
cp .env.example .env      # local development; never commit .env
npm ci
npm run build
npm run db:init           # once: creates data/alkhayr.db (the server never creates or migrates it)
npm start                 # or: npm run dev  -> http://localhost:3000
npm run check             # typecheck + build + tests
```
Health: `GET /healthz` (process alive) · `GET /readyz` (database ready).
Database operations and upgrades: [`docs/MIGRATION.md`](docs/MIGRATION.md).

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
| `docs/MIGRATION.md` | Operator procedures: init, upgrade, startup refusals, recovery requirements |
| `docs/API_CONTRACT.md` | `/api/v1` endpoints, errors, transitions |
| `docs/SECURITY.md` | Security policy and verification status |
| `docs/THREAT_MODEL.md` | Threats and controls |
| `docs/DECISIONS.md` | Decision log |
| `docs/PROJECT_STATE.md` | Implementation state, verification evidence, next stage |
