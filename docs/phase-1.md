# Phase 1 — Core Platform (Acceptance Record)

Scope delivered (per approved Phase 1 plan; blueprint §5 "Core Platform" + Sprint 0–2
foundations from §23):

| Area | Delivered |
| --- | --- |
| Architecture | npm-workspaces monorepo: NestJS modular monolith (ADR-002), Next.js App Router, shared `@milaserv/contracts` (ADR-011), Docker Compose (postgres 16 + redis 7, optional containerized api/web), CI gates |
| Authentication | argon2id passwords, JWT access + rotating refresh sessions, idle timeout, lockout, forced password change, logout/deactivation revocation |
| Users | Scope-filtered CRUD, activation, role assignment, audit + timeline + notifications |
| Departments | CRUD + archive (guarded), bilingual masters |
| Teams | CRUD + membership with team roles, permission-cache invalidation |
| Roles | 10 system roles seeded (§6), custom roles, grant matrix editor |
| Permissions | Catalog in contracts (§19.2), widest-scope resolver (§19.1, §6.1), `@RequirePermission` guard, Redis-cached, `GET /me/permissions` |
| Main layout | Sidebar + topbar shell, ar/en with RTL/LTR first paint, locale toggle |
| Dynamic sidebar | Rendered strictly from effective permissions (same keys as API guards) |
| Settings foundation | Typed catalog + SYSTEM/DEPARTMENT/TEAM overrides (ADR-008) |
| Audit foundation | Append-only log, every mutation recorded, scoped query API + viewer (ADR-010) |
| Notification foundation | Channel abstraction (in-app live; email/SMS slots per §8), unread badge, notification center |

Deliberately **not** included (later phases per blueprint): tickets, KB, break tracker,
attachments, number generator, branch/partner masters (scope columns reserved),
email/SMS channels, WebSockets, OpenSearch.

## Definition of Done (§24) checklist

- [x] Business rules documented — blueprint §§6, 19, 22 + ADRs + this record
- [x] UI implemented — login, change-password, shell, 6 admin screens, notifications
- [x] API implemented — auth, me/permissions, users, departments, teams, roles,
      settings, audit, notifications
- [x] Database migrations created — `init`, `team_member_cascade`
- [x] Permissions applied — every admin endpoint `@RequirePermission` + data scope
- [x] Audit events recorded — all mutations + auth events (verified by tests)
- [x] Timeline events recorded — all mutations (verified by tests)
- [x] Notifications verified — team membership + role change (e2e + browser)
- [x] Validation & error states — DTO validation, uniform 401, 403/404/409 semantics,
      loading/empty/error UI states
- [x] Unit & integration tests passed — 4 e2e suites (auth, permissions, org,
      foundations) against live Postgres + Redis
- [x] UAT-style walkthrough — Chromium end-to-end: admin creates department → team →
      user (+role) → member; setting toggled; audit filtered; new user forced password
      change; agent sees permission-filtered sidebar and the in-app notification
- [x] Documentation updated — README, ADRs, this record
- [x] Rollback plan — revert migration + `git revert` per step; each step is an
      isolated commit; seed is idempotent

## Verification environment note

In this development sandbox the container registry was unreachable, so verification ran
against the same Postgres 16 / Redis 7 versions installed natively with the exact
`.env.example` credentials/ports. `docker compose up -d` is the canonical local setup
and is expected to work unchanged on developer machines.

## Next phase (per blueprint §23)

Sprint 2 remainder (Attachments, Number Generator) → Sprint 3 Ticketing Core, starting
with the Ticketing Module Specification (§27) before any code.
