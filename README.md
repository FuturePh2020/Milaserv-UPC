# Milaserv360

Enterprise Healthcare Operations Platform for a pharmacy group — unified customer care,
online operations, CRM, knowledge base, teams/branches/drug management, reporting, and
integrations.

**Source of truth:** `docs/blueprint/Milaserv360_Enterprise_Blueprint_v1.0.docx` (see
§1.1 for change-management rules). Architecture decisions: `docs/adr/`.

## Stack

Next.js + TypeScript (web) · NestJS + TypeScript (api) · PostgreSQL + Prisma · Redis ·
Docker Compose. Modular Monolith (ADR-002).

## Repository layout

```
apps/api            NestJS API (modular monolith)
apps/web            Next.js frontend (App Router)
packages/contracts  Shared types, enums, permission keys
docker/             Dockerfiles
docs/               Blueprint (source of truth) + ADRs
```

## Getting started (development)

```bash
cp .env.example .env          # then set real secrets
npm install
docker compose up -d          # postgres + redis
npm run db:migrate            # apply migrations
npm run db:seed               # roles, permissions, default settings, first admin
npm run dev:api               # http://localhost:4000/api/v1/health
npm run dev:web               # http://localhost:3000
```

Full containerized stack (api + web images too):

```bash
docker compose --profile app up -d --build
```

## Quality gates

```bash
npm run lint && npm run format && npm run typecheck && npm run build && npm run test
```

CI runs the same gates on every push/PR (`.github/workflows/ci.yml`).
