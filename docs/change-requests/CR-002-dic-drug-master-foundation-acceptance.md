---
# CR-002 — Prescription Intelligence Engine Phase 4: DIC Drug Master &
# Drug Normalization Foundation (Acceptance Record)

Builds a normalized, searchable, auditable drug-master foundation on top
of the existing DIC module (blueprint §15) — extending it rather than
replacing it. **Explicitly out of scope for this phase** (per the
brief): final OCR-to-drug matching, inventory availability checking,
pharmaceutical alternative *suggestion*, and automatic prescription
confirmation. Phase 5 is not started.

## 1. Architecture summary

The existing DIC module (flat `Drug` table, upsert-by-`materialNo` feed
import, ILIKE search, single-table `DrugChangeRequest` approval flow —
binding decisions H1-H8 in `docs/specs/dic-spec-v1.0.md`) is retained
unchanged as the monthly master-feed path. Phase 4 adds a parallel,
additive layer: structured composition (ingredients, strength,
packaging), controlled reference catalogs (dosage form, unit,
manufacturer, country, therapeutic class), a pharmacist-governed alias
and alternative-link approval layer, a staged Excel import pipeline
independent from the feed importer, controlled merge/versioning, and a
data-quality dashboard. Every new capability is permission-gated,
audited, and timeline-recorded, matching the platform's standing rules.

Eight steps, each committed, tested, and pushed independently:

1. Schema + seed + permissions
2. Normalization utilities + reference-data CRUD
3. Extended search + drug-details API
4. Alias + alternative-link CRUD & approval workflows
5. Staged Excel import
6. Controlled merge, optimistic locking, data-quality dashboard
7. Frontend screens
8. Full regression, docker check, this report

## 2. ERD summary

New models (all additive, no existing table dropped or renamed):

- `Country`, `Manufacturer` (→ `Country`), `DosageForm`, `MeasurementUnit`
- `ActiveIngredient`, `DrugIngredient` (Drug ↔ ActiveIngredient,
  combination-medicine support), `DrugStrengthComponent`
- `DrugPackage`
- `TherapeuticClass` (self-referencing parent/child), `DrugTherapeuticClass`
- `DrugAlias` (unique per `[drugId, normalizedAlias]`)
- `DrugAlternativeLink` (unique per `[sourceDrugId, alternativeDrugId]`,
  self-relation on `Drug`, deliberately named `*Link*` to avoid colliding
  with the pre-existing feed-declared `DrugAlternative`)
- `DrugImportBatch` → `DrugImportRow[]` (staging area for Excel import)

Extended existing models: `Drug` (+~25 nullable/defaulted columns:
`barcode`, normalized/search text columns, `dosageFormId`,
`manufacturerId`, `countryOfOriginId`, `strengthText`,
`regulatoryCategory`, `requiresPrescription`, `dataQualityStatus`,
`version` (optimistic lock), `mergedIntoDrugId` (self-relation,
redirect-not-delete) + 8 new relations); `DrugCoverage` (+7 columns:
`coverageStatus`, `requiresApproval`, `effectiveFrom/To`, etc.);
`InsuranceCompany` (+`providerType`). 9 new enums.

## 3. Files created/modified

37 files, +7,571/-61 lines across 7 commits. Full list:
`git log --stat fb374a2^..e7a6092` in this branch. Highlights:

- Schema/migration/seed: `prisma/schema.prisma`,
  `prisma/migrations/20260719165244_p4_dic_drug_master_foundation/`,
  `prisma/seed/{dic.ts,dic-reference.ts,index.ts}`
- API: `src/modules/dic/{dic.service.ts, dic.dto.ts, dic.module.ts}`
  (extended) + 8 new files (`dic-reference.*`, `dic-alias.service.ts`,
  `dic-alternative.service.ts`, `dic-relations.controller.ts`,
  `dic-staged-import.*`, `dic-quality.*`) + `normalization/` (5 files)
- Contracts: `packages/contracts/src/permissions.ts` (+6 keys)
- Tests: 5 new e2e spec files + 1 unit spec (47 new e2e + 24 unit tests)
- Frontend: `dic-types.ts`, `api.ts` (+`apiDownload`), `xlsx-parse.ts`
  (new), `page.tsx` (extended) + 5 new tab components

## 4. Migration

One migration, `20260719165244_p4_dic_drug_master_foundation`, hand-edited
three times after `prisma migrate diff --create-only` (never touching an
already-applied migration): (a) `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
(b) a one-time `DrugCoverage.coverageStatus` backfill (`COVERED`/
`NOT_COVERED` from the existing `covered` boolean) — the only backfill in
this phase, (c) 8 hand-written `CREATE INDEX ... USING GIN (... gin_trgm_ops)`
statements (Prisma's schema DSL has no opclass syntax). Applied via
`prisma migrate deploy` (not `migrate dev`, which hangs on shadow-DB
diffing in this sandbox — a lesson carried over from Sprint OCR-03).
Every new/changed column is nullable or defaulted; all 22,732 pre-existing
real `Drug` rows and every prior test remained valid with zero data loss.

## 5. Seed data

`seedDicReferenceData()` (new, idempotent — upserts by natural key) seeds
DosageForm (13), MeasurementUnit (10+), Country, and TherapeuticClass
(12+) starter catalogs. `DrugItemType` extended with 6 rows. No example
production drugs were seeded as real master data (per the brief's
explicit instruction) — only controlled reference/lookup rows.

## 6. Normalization

`src/modules/dic/normalization/`:

- `arabic.ts` — diacritic stripping, ة/ه and ي/ى unification (never a
  blind global replace — position/context-aware), Arabic-Indic digit
  preservation (a regression test locks this in after a transcription
  bug was caught mid-session via Python codepoint verification, not
  visual inspection).
- `english.ts` — `foldDrugNameVariants()` converges `Augmentin-1GM` /
  `AUGMENTIN 1 GM` / `Augmentin 1g` / `Augmentin / 1 g` to one comparable
  form (the brief's own worked example, covered by a permanent test).
- `strength.ts` — `parseStrengthText()` extracts structured numeric/unit
  pairs but never fabricates a value it can't confidently parse; the
  original free-text string is always preserved verbatim on both `Drug`
  and `DrugStrengthComponent`.
- `transliteration.ts` — Latin↔Arabic, explicitly lossy/best-effort;
  its only sanctioned use is seeding `DrugAlias` rows with
  `approved: false` — never auto-authoritative.

## 7. Search indexes & search API

`pg_trgm` GIN trigram indexes on the primary name/alias/scientific-name
columns (no Elasticsearch — not justified at this scale). `GET
/dic/search` extended with `barcode`, `scientific`, and `alias` fields
alongside the original `all/brand/ingredient/material/nameAr/nameEn`.
Alias and scientific-name matches are separate relation queries (not
folded into one giant `OR`) so each result carries a `matchSource` tag
(`primary`/`alias`/`scientific`) rather than losing provenance. A
merged-away drug (§14) is excluded from every search path but still
resolves directly by id, showing a redirect.

## 8. Drug Details API

`GET /dic/drugs/:id` now includes dosage form, manufacturer (+country),
active ingredients, strength components, packaging, aliases (with
approval status), therapeutic classes, and `approvedAlternatives`
(pharmacist-approved links only — the raw relation is never exposed).
Existing feed-based `alternatives`/`crossSells` fields are unchanged.

## 9. Reference-data CRUD API

`GET/POST/PATCH /dic/reference/{dosage-forms,units,countries,
manufacturers,therapeutic-classes,active-ingredients}` — list is
`dic.view`; structural-catalog mutation is `dic.admin`; manufacturer/
active-ingredient creation is the lighter `dic.edit` (routine drug-entry
work) but editing an existing one is still `dic.admin`.

## 10. Alias workflow

`POST /dic/drugs/:id/aliases` (propose, `dic.edit`) → always
`approved:false`; duplicate detection surfaces other drugs already
carrying an approved alias with the same normalized text
(`duplicateOf`, informational, never auto-merged); exact same-drug
duplicates are rejected outright. `GET /dic/aliases/pending` +
`POST /dic/aliases/:id/decide` (`dic.approve_alias`). Approved aliases
are immutable (propose a new one instead of editing); reject deactivates
rather than deletes, preserving the audit trail.

## 11. Alternative-link workflow

Mirrors the alias workflow: `POST /dic/drugs/:id/alternative-links`
(`dic.edit`) rejects self-links and duplicate pairs; `GET
/dic/alternative-links/pending` + decide (`dic.approve_alternative`).
Data structure only, per the brief — no auto-recommendation, no
prescription-matching wiring.

## 12. Staged import workflow

`DrugImportBatch`/`DrugImportRow` staging — never writes to `Drug`
directly. Upload → column mapping → validate (dry-run report: hard
errors vs. soft warnings, plus duplicate detection) → per-row resolution
(`CREATE_NEW`/`LINK_EXISTING`/`MERGE`/`REJECT_ROW`/`DEFER_REVIEW`) →
approval gate (blocked while any duplicate is unresolved) → execute →
optional rollback. `LINK_EXISTING`/`MERGE` execution only fills
currently-null fields on the existing drug — never overwrites
`nameEn`/`materialNo` or any already-set value ("prevent silent data
loss"). Error report exported as CSV with per-field formula-injection
guards (a cell starting with `=`/`+`/`-`/`@` is quoted with a
neutralizing leading apostrophe) — verified with a literal `=SUM(...)`
test fixture. This is a second, independent import path alongside the
existing monthly feed importer, not a replacement for it.

## 13. Duplicate detection

Weighted-signal scoring against existing drugs: exact `materialNo` match
(100), exact `barcode` match (80), normalized-name match (50); candidates
scoring ≥50 are surfaced (top 5, never auto-merged). The alias workflow
(§10) runs an analogous same-text-different-drug check.

## 14. Merge & versioning

`POST /dic/drugs/:id/merge` (`dic.admin`) reassigns non-conflicting
aliases/coverage (target's own row wins on a text/company collision,
source's duplicate is dropped) and repoints `DrugAlternativeLink` rows on
either side (dropping any that would become self-links or duplicates).
The source drug is never deleted — only `mergedIntoDrugId` set and
`active:false` ("redirected, not deleted"). Optional
`expectedSourceVersion`/`expectedTargetVersion` act as an optimistic
lock (409 on mismatch). `PATCH /dic/drugs/:id/fields` (`dic.edit`) is a
new version-checked direct edit for the structural fields that had no
edit path before this phase.

## 15. Data-quality dashboard

`GET /dic/quality/dashboard` (`dic.pharmacist_review`): totals,
`DataQualityStatus` breakdown, missing-field counts (Arabic name,
dosage form, manufacturer, strength, barcode), pending alias/
alternative/import-batch counts, merged-drug count. `GET
/dic/quality/issues?rule=...` drills into the offending drugs for one
rule. `POST /dic/drugs/:id/quality/status` sets a drug's status
(`VERIFIED` stamps `approvedBy`/`approvedAt`).

## 16. Permissions

6 new keys added to `packages/contracts/src/permissions.ts` (the single
source of truth) and granted to *existing* `SYSTEM_ROLES` — never new
role names, per this platform's fixed-role architecture:

| Key | Label | Granted to |
| --- | --- | --- |
| `dic.edit` | Create/edit drugs, ingredients, packaging, aliases | TEAM_MANAGER, SUPER/PLATFORM_ADMIN |
| `dic.pharmacist_review` | Review data quality & duplicates | BUSINESS_EXCELLENCE_MANAGER, SUPER/PLATFORM_ADMIN |
| `dic.approve_alias` | Approve/reject aliases | BUSINESS_EXCELLENCE_MANAGER, TEAM_MANAGER, SUPER/PLATFORM_ADMIN |
| `dic.approve_alternative` | Approve/reject alternatives | same as above |
| `dic.import_staged` | Run staged import | INTEGRATION_SUPPORT, SUPER/PLATFORM_ADMIN |
| `dic.admin` | Merge drugs, roll back imports, manage reference catalogs | SUPER/PLATFORM_ADMIN only |

Not all users can approve aliases/alternatives or roll back imports, by
design.

## 17. Audit & timeline coverage

Every mutating action in every new service calls both `AuditService.record()`
(actor, before/after, ip) and `TimelineService.record()` (entity-scoped
event stream) — no exceptions. Verified structurally in code review and
functionally through the e2e suites (which assert on resulting audit/
timeline side effects where relevant) and the live walkthrough.

## 18. Frontend screens

The existing `/dic` page's tab bar extended from 2 to 7 tabs, each
permission-gated to match its backend guard: Search (extended fields +
`matchSource` badges + drug-card Phase 4 sections + in-context
propose-alias/propose-alternative dialogs), Approvals (existing H8),
Reference data (6-catalog CRUD browser), Alias approvals, Alternative
approvals, Staged import (status-driven upload→map→validate→resolve→
approve→execute wizard + CSV error-report download + rollback), Data
quality (dashboard + rule drill-down). All labels added to both
`messages/en.json` and `messages/ar.json`.

## 19. Test results

- **Backend e2e**: 24 suites / 226 tests, all green, run `--runInBand`
  (required in this codebase — parallel workers race on shared DB
  state). 47 new tests across 5 new spec files (ES-1..7 search, DA-1..10
  alias/alternative, IM-1..11 staged import, QU-1..11 merge/quality,
  DR-1..8 reference), plus the pre-existing 9 DI tests (`dic.e2e-spec.ts`)
  and all other modules' suites confirmed unaffected at every step.
- **Backend unit**: 35 tests (24 new normalization + 11 pre-existing
  file-validation), all green.
- **Python (OCR service, untouched by this phase)**: 77/77 green —
  confirms no cross-service regression.
- **Frontend**: `tsc --noEmit` and `eslint` clean on every touched file;
  `next build` production build succeeds (`/dic` route: 10.8 kB). No
  automated frontend test suite exists in this project (established
  precedent since Phase 1 — live Playwright walkthroughs instead).
- **Live walkthrough**: logged in as SUPER_ADMIN against the real dev
  database (23,024 real drugs), both Arabic (default) and English
  locales screenshotted; all 7 tabs render; extended search fields
  confirmed present; drug card confirmed showing every new field
  against a real drug record; a full alias propose → pending-queue →
  approve round trip completed end-to-end with live query-cache
  invalidation observed in the screenshots. Test data cleaned up
  afterward (`DELETE FROM "DrugAlias" WHERE alias = '...Test Alias'`).

## 20. Performance

Trigram GIN indexes keep `ILIKE`/`contains` search sub-100ms range at
23k-drug scale (same order as the pre-existing feed search, which this
phase does not regress). Staged-import validation does one bulk
`findMany` of existing drugs per batch (not N+1 per row) before scoring
duplicates in memory. No N+1 query patterns introduced in the new
services; relation includes are all single-query via Prisma's `include`.

## 21. Known limitations / deliberately out of scope

- No OCR-to-drug matching, inventory availability, alternative
  *suggestion*, or automatic prescription confirmation — explicitly
  excluded by the brief for this phase.
- Rollback of a staged-import batch only auto-reverts `CREATE_NEW` rows
  (deletes the drugs it created). A batch containing any `LINK_EXISTING`/
  `MERGE` row refuses automatic rollback (422) rather than guessing at
  reversing an in-place enrichment with no before-snapshot — an
  intentional "refuse rather than risk silent data loss" design choice,
  not a missing feature.
- Drug merge reassigns aliases/coverage/alternative-links only (per the
  brief's own list); it does not move `DrugIngredient`/
  `DrugStrengthComponent`/`DrugPackage`/`DrugTherapeuticClass` rows —
  those stay on the now-inactive source record, which remains queryable
  via the redirect for historical reference.
- Transliteration is single-candidate/best-effort by design (the brief:
  "do not rely on one transliteration string only" is honored by never
  auto-approving it, not by generating multiple candidates).
- No Docker daemon in this sandbox (confirmed via `docker info`, an
  environment limitation consistent with every prior phase in this
  session) — `docker compose config` validated instead (§22).

## 22. Rollback, environment commands, and Phase 5 readiness

**Rollback**: every change in this phase is additive (new tables/columns/
files) or reversible (revert the 7 commits; the one backfill,
`DrugCoverage.coverageStatus`, is derived data, safely recomputable).
No existing behavior was removed.

**Docker**: `docker compose -f docker-compose.yml --profile app config`
validates all 6 services (`postgres`, `redis`, `minio`, `ocr-service`,
`api`, `web`) cleanly. `docker compose config` (no profile) validates the
2 always-on infra services. (Requires `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`
in `.env` — see `.env.example`; unrelated to this phase.)

**Windows** (PowerShell): `docker compose --profile app up -d`, then
from `apps/api`: `npm run db:deploy && npm run db:seed`.
**macOS/Linux**: identical commands in bash/zsh.
**Local dev without Docker**: `apps/api`: `npm run dev`; `apps/web`:
`npm run dev`; requires local Postgres 16 + Redis 7 matching `.env`.

**Phase 5 readiness**: this phase's foundation (structured composition,
controlled catalogs, approved aliases/alternatives, data-quality
tracking) is what a future OCR-to-drug matching phase would consume —
but per the brief's explicit instruction, **Phase 5 is not started and
will not begin without further instruction.**
