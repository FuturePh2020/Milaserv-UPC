# ALKHAYR B2B — بوابة الخير للتجار

Independent Arabic (RTL) B2B wholesale ordering portal for an Egyptian sweets & chocolate importer.

**Status:** Release candidate **1.0.0-rc.1** — stage 18 final acceptance: **ACCEPTANCE PASSED FOR LOCAL DEPLOYMENT PACKAGE; PUBLIC LAUNCH BLOCKED** (no hosted checks; owner decisions DR-1…DR-6 pending; see [`docs/FINAL_ACCEPTANCE_18.md`](docs/FINAL_ACCEPTANCE_18.md)) — foundation, SQLite schema/migrations, security primitives, local
administrator enrollment, and the authentication API (register, login with admin TOTP, sessions,
CSRF, rate limits, logout, password change) and the merchant lifecycle (own profile, administrator
review/approval/suspension), product administration, the approved catalog, inventory
adjustments with an append-only ledger, pending-order creation with own-order reads, and
administrator order fulfillment with per-order stock reservations, and the Arabic RTL design system
with application shells, and the complete merchant experience in the browser (registration, sign-in,
catalog, cart, checkout preview, ordering with safe retries, order tracking, profile and password),
and the administration screens (merchant review, products, inventory and ledger, order fulfillment),
and safe CSV imports (create/update products, receive stock, set physical totals) with preview, all-or-nothing
confirmation and durable idempotency (operator guide: [`docs/IMPORT_GUIDE_AR.md`](docs/IMPORT_GUIDE_AR.md)),
and business settings, operational reports, spreadsheet-safe exports, pre-filled import templates and printable
order summaries, and encrypted backups with verified restore and operator account recovery
(guide: [`docs/BACKUP_RECOVERY_AR.md`](docs/BACKUP_RECOVERY_AR.md)), and a stage-16 adversarial security review
with a consistency verifier, a post-restore recovery gate and a release-blocker register
([`docs/SECURITY_REVIEW_16.md`](docs/SECURITY_REVIEW_16.md)). See [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md).

## Quick start (Node.js 24.22.1 required)
```sh
cp .env.example .env      # local development; never commit .env; set APP_SECRET
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
Production deployment (Docker Compose + Caddy HTTPS + scheduled verified backups):
[`docs/DEPLOYMENT_AR.md`](docs/DEPLOYMENT_AR.md); owner decisions still required before launch:
[`docs/OWNER_DECISIONS_18.md`](docs/OWNER_DECISIONS_18.md); daily use (Arabic): [`docs/OWNER_QUICKSTART_AR.md`](docs/OWNER_QUICKSTART_AR.md).

Production requires `NODE_ENV=production`, an `https://` `APP_ORIGIN` and a generated `APP_SECRET` (see
`.env.example`); backups use a separate key file (`npm run cli -- backup:keygen --out <path>`). Run one instance per data directory, on a local
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
| `docs/BACKUP_RECOVERY_AR.md` | Operator guide (Arabic): backups, restore, account recovery cases A–F, retention, RPO/RTO |
| `docs/API_CONTRACT.md` | `/api/v1` endpoints, errors, transitions |
| `docs/DESIGN_SYSTEM.md` | Tokens, contrast, typography, components, shells, gallery |
| `docs/FRONTEND_API.md` | Browser API client and identity rules |
| `docs/SECURITY.md` | Security policy and verification status |
| `docs/DEPLOYMENT_AR.md` | Deployment/operations guide (Arabic): architecture, secrets, commands, backups, monitoring, upgrades, incidents |
| `docs/FINAL_ACCEPTANCE_18.md` | Stage-18 final acceptance report: blockers first, proxy findings, evidence, performance, launch status |
| `docs/REQUIREMENTS_EVIDENCE.md` | Requirements → implementation → evidence → environment → status matrix (stages 00–17) |
| `docs/OWNER_DECISIONS_18.md` | Owner decision pack DR-1…DR-6 (all pending) |
| `docs/RELEASE_CHECKLIST.md` | Release / launch gates with PASS · NOT RUN · PENDING |
| `docs/KNOWN_LIMITATIONS.md` | Known limitations and open blockers |
| `docs/DEPLOYMENT_INPUTS.md` | What the owner must provide for hosted acceptance |
| `docs/RELEASE_NOTES.md` | Versioned release notes with artifact hashes |
| `docs/OWNER_QUICKSTART_AR.md` | Owner/operator quick-start (Arabic): daily tasks, stock, imports, reconciliation, secrets |
| `docs/MAINTENANCE_AR.md` | Maintenance and incident checklist (Arabic) |
| `docs/RELEASE_DECISIONS_17.md` | Stage-17 decision record (superseded by OWNER_DECISIONS_18) |
| `docs/SECURITY_REVIEW_16.md` | Stage-16 adversarial review: findings, fixes, residual risks, NOT RUN checks, release blockers |
| `docs/THREAT_MODEL.md` | Threats and controls |
| `docs/DECISIONS.md` | Decision log |
| `docs/PROJECT_STATE.md` | Implementation state, verification evidence, next stage |
