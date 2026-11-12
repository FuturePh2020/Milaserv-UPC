# ALKHAYR — Project State

| Field | Value |
|---|---|
| Last updated | 2026-11-12 |
| Current stage | **00 — Master contract & capability check: COMPLETE (specification only)** |
| Next stage | **01 — Project foundation & reproducible build** (awaiting owner prompt) |
| Execution mode | BUILD_NEW (D-001) |
| Project root | `alkhayr-b2b/` in repo `FuturePh2020/Milaserv-UPC`, branch `ccr-b8f31a52-xk6wqg` |
| Application code | **None yet.** No server, UI, database, or tests exist. |

## Stage log

| Stage | Status | Evidence |
|---|---|---|
| 00 | ✅ Done (docs + capability probe) | This file; probes listed below |
| 01–18 | ⏳ Not started | — |

## Stage 00 — what was done
1. Read the full blueprint (742 lines; preserved verbatim at `docs/BLUEPRINT_AR.md`, SHA-256 `e6333a36…f8d5`).
2. Inspected the supplied repository (all remote branches) — no ALKHAYR/2.0.1 source → BUILD_NEW.
3. Stored the owner-supplied logo unchanged at `assets/brand/alkhayr-logo-original.png`.
4. Ran harmless capability probes in a scratch directory (outside the repo).
5. Wrote contract docs: `SPEC.md`, `DATABASE.md`, `API_CONTRACT.md`, `SECURITY.md`,
   `THREAT_MODEL.md`, `DECISIONS.md`, this file.

### Supplied source inventory
| Item | Finding |
|---|---|
| `main`: `README.md` | 1 line (`# Milaserv-UPC`) |
| `main`: `Dashboard.jsx` (1185 lines) | React HR/tasks/leave/team-performance dashboard; uses `lucide-react`, `recharts`; all data hardcoded mock (`EMPLOYEES`, `INITIAL_TASKS`, `INITIAL_LEAVES`); role switch is client state; remote Google Fonts. **Unrelated to ALKHAYR; nothing reused.** Left untouched. |
| Other branches | `ccr-8d61dc0f-53f2ep` (EasyOrders theme), `claude/leads-distributor-crm-system-k7hmkr` (NestJS CRM), `claude/milaserv360-phase-1-arch-ahvj86`, `claude/sidebar-structure-design-lk4nm5` (Vite scaffold). None contain ALKHAYR code. Not modified. |
| Blueprint upload | Two identical copies uploaded (byte-compare equal). |
| Logo upload | PNG 1890×832 RGBA, transparent background. |

### Capability verification (actual probe results, 2026-11-12, cloud dev container)
| Capability | Result | Evidence / command |
|---|---|---|
| Filesystem persistence (session) | ✅ within session | Files written and re-read; container is ephemeral — **only git-pushed files survive the session** |
| Node.js runtime | ✅ | default `node` v22.23.4 / npm 10.9.9; **`/opt/node24/bin/node` v24.22.1** (OpenSSL 3.5.9 on 22) |
| Real HTTP backend | ✅ (local) | `http.createServer` on 127.0.0.1 → `GET /healthz` returned `200 {"ok":true,…}` |
| Process execution | ✅ | shell, spawned Node processes, background daemon |
| Persistent SQLite + WAL | ✅ (local disk) | `node:sqlite` set `journal_mode=wal`, inserted row, reopened in a **new process**, count = 1. SQLite 3.53.4. Node 24 `node:sqlite` exposes `backup` (function) |
| Native SQLite alt. | ✅ | `npm install better-sqlite3@12` (prebuilt) → query OK, SQLite 3.53.2 |
| scrypt N=131072,r=8,p=1 | ✅ | 64-byte key in ≈ 342 ms, maxmem 256 MiB |
| AES-256-GCM | ✅ | encrypt/decrypt round-trip |
| Test execution | ✅ | `node --test` → `# pass 1 # fail 0` |
| npm registry | ✅ | `npm view`: react 19.3.1, zod 4.6.7, esbuild 0.28.2, typescript 7.0.2, better-sqlite3 13.1.1 (latest) |
| Git push / source export | ✅ expected | remote reachable (`git ls-remote` OK); push performed at end of stage 00 (see commit) |
| Docker | ⚠️ partial | CLI 29.9.2 + Compose v5.6.1; daemon not running by default but `dockerd` started; `docker run hello-world` failed: Docker Hub **429 Too Many Requests**. Image build **UNVERIFIED** |
| Browser QA | ✅ available (not yet used) | Chromium + Playwright pre-installed per environment |
| Resources | info | 4 vCPU, 16 GB RAM, ~31 GB free disk |
| **Hosted execution for end users** | ❌ **not available / UNVERIFIED** | This is an ephemeral dev container, not a hosting platform. Deliverable = portable source + Node/Docker release for external hosting (stage 17). No public URL, TLS, DNS or persistent production disk is provided here. |

### Consequences
- Real backend, SQLite and tests can be built and verified **in this container**.
- Production hosting, HTTPS/DNS, container image security and off-host backups must be verified on
  the owner's target host; they will be marked NOT RUN here until evidence exists.
- Work persists only through commits pushed to the development branch.

## Open questions (need owner input)
| ID | Question | Blocks | Default if unanswered |
|---|---|---|---|
| Q-1 | **Names of the four initial product categories.** Blueprint stage 06 says "the blueprint's four initial categories" but never lists them. | Stage 06 (schema CHECK + UI) | None — will ask again at stage 06; will not invent business categories silently |
| Q-2 | Confirm project location `alkhayr-b2b/` inside `Milaserv-UPC` (vs. a dedicated repository). | Nothing now | Keep `alkhayr-b2b/` |
| Q-3 | Is shipping taxable, and what tax rate/label should appear on the order summary? | Stage 08/14 | D-009: tax on goods subtotal only, `tax_bps=0` until configured |
| Q-4 | Low-stock threshold for "كمية محدودة" and admin alerts (cartons). | Stage 06/14 | 10 cartons, configurable |

## Conflicts found in the blueprint and resolutions
| Conflict | Resolution |
|---|---|
| "Four initial categories" referenced but undefined | Open question Q-1 (not invented) |
| Brand "cream and red" vs. supplied logo with blue | D-011: logo is authoritative; blue as secondary accent |
| `__Host-` cookie cannot work on plain-http local dev | D-007 dev cookie name |
| 428 status referenced without definition | D-008 |
| `orders` "UUID/display number" vs. "no predictable sequence numbers" | D-012 |
| Admin "may order for its own account" | D-015 (admin's own approved merchant profile) |
| Default `node` is 22, blueprint baseline 24.22.1 | D-003 use Node 24 explicitly |

## Remaining blockers
- None for stage 01. Q-1 must be answered before stage 06.

## Files changed in stage 00
- `alkhayr-b2b/docs/BLUEPRINT_AR.md` (verbatim copy of supplied blueprint)
- `alkhayr-b2b/docs/SPEC.md`, `DATABASE.md`, `API_CONTRACT.md`, `SECURITY.md`, `THREAT_MODEL.md`, `DECISIONS.md`, `PROJECT_STATE.md`
- `alkhayr-b2b/assets/brand/alkhayr-logo-original.png` (owner-supplied, unchanged)
- `alkhayr-b2b/README.md`

## Checks run in stage 00
Capability probes only (table above). **No application tests exist yet; none are claimed.**

## How to continue
Next: send **PROMPT 01**. A resumed session should read this file, SPEC.md, DATABASE.md,
API_CONTRACT.md, SECURITY.md and DECISIONS.md, then `docs/BLUEPRINT_AR.md` for the stage prompt.
