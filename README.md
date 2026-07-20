# Leads Distributor & CRM Performance System

A multi-user CRM and telesales lead-distribution platform. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it's built and
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what's implemented vs. deferred.

## Stack

Next.js (App Router) + Tailwind · NestJS + Prisma · PostgreSQL · Redis +
BullMQ · JWT auth in httpOnly cookies · ExcelJS · Swagger.

## Getting started (local, without Docker)

Prerequisites: Node 20+, pnpm, a running PostgreSQL and Redis.

```bash
pnpm install

cp apps/api/.env.example apps/api/.env   # edit DATABASE_URL / REDIS_URL / secrets
pnpm --filter @lcrm/shared build
pnpm --filter @lcrm/ui build
pnpm --filter @lcrm/api prisma:generate
pnpm --filter @lcrm/api prisma:migrate    # creates the schema
pnpm --filter @lcrm/api seed               # creates demo admin/agent accounts, credentials printed to console

pnpm dev:api    # http://localhost:4000 (Swagger at /api/docs)
pnpm dev:web    # http://localhost:3000
```

## Getting started (Docker Compose)

```bash
cp infrastructure/.env.example infrastructure/.env   # set real secrets
docker compose -f infrastructure/docker-compose.yml --env-file infrastructure/.env up --build
```

The stack (Postgres, Redis, API, web, Nginx) comes up behind Nginx on
`http://localhost` (`HTTP_PORT` in the env file). The API container runs
`prisma migrate deploy` on boot; run the seed script once manually inside the
`api` container if you want the demo admin/agent accounts:

```bash
docker compose -f infrastructure/docker-compose.yml exec api pnpm seed
```

## Tests

```bash
pnpm --filter @lcrm/api test        # unit tests
pnpm --filter @lcrm/api test:e2e    # integration tests incl. the lead-distribution
                                     # concurrency proof and break concurrency-limit proof
                                     # (needs a real Postgres + Redis, same as dev)
pnpm --filter @lcrm/web test:e2e    # Playwright golden path (needs API + web running)
```
