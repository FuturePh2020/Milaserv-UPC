# ALKHAYR B2B — بوابة الخير للتجار

Independent Arabic (RTL) B2B wholesale ordering portal for an Egyptian sweets & chocolate importer.

**Status:** Stage 01 complete — technical foundation only (Node HTTP server, React shell, build,
tests). There is no database, login, catalog or ordering yet. See
[`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md).

## Quick start (Node.js 24.22.1 required)
```sh
cp .env.example .env      # local development; never commit .env
npm ci
npm run dev               # http://localhost:3000
npm run check             # typecheck + build + tests
npm run build && npm start
```
Production requires `NODE_ENV=production`, an `https://` `APP_ORIGIN`, and independently generated
`APP_SECRET` / `BACKUP_KEY` (see `.env.example`). The server must sit behind an HTTPS reverse proxy.

## Layout
`src/server` Node API · `src/web` React SPA · `src/shared` shared contracts · `migrations` SQL ·
`scripts` build/dev · `tests` unit/integration/security · `docs` specification and state.

| Document | Purpose |
|---|---|
| `docs/BLUEPRINT_AR.md` | Original blueprint and staged prompts (verbatim) |
| `docs/SPEC.md` | Product scope, roles, business rules |
| `docs/DATABASE.md` | Schema and migration contract |
| `docs/API_CONTRACT.md` | `/api/v1` endpoints, errors, transitions |
| `docs/SECURITY.md` | Security policy and verification status |
| `docs/THREAT_MODEL.md` | Threats and controls |
| `docs/DECISIONS.md` | Decision log |
| `docs/PROJECT_STATE.md` | Implementation state, verification evidence, next stage |
