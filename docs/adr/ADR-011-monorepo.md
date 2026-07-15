# ADR-011 — npm-workspaces monorepo with a shared contracts package

**Status:** Accepted (Phase 1) · **Supports:** ADR-002 (Modular Monolith), blueprint §4 (API First)

## Context

The platform ships one backend (NestJS) and one frontend (Next.js) that must agree on
permission keys, enums, and DTO shapes. Divergence between them is the most common source
of authorization bugs (§26: "permission complexity" risk).

## Decision

Single repository with npm workspaces: `apps/api`, `apps/web`, `packages/contracts`.
`@milaserv/contracts` holds permission keys, data scopes, system roles, locales, and shared
DTO types. The API seeds and guards from it; the web renders the sidebar and permission
matrix from it. No build orchestrator (Turborepo/Nx) until workspace count or build time
justifies one.

## Consequences

- One CI pipeline validates both apps against the same contract types.
- Permission keys exist in exactly one place; renaming one is a compile error in both apps.
- Adding a future domain module (Ticketing, KB) means appending to the catalog — no renames.
