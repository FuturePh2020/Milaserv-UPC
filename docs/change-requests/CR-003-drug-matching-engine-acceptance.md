---
# CR-003 — Prescription Intelligence Engine Phase 5: Intelligent
# OCR-to-Drug Matching Engine (Acceptance Record)

Consumes the DIC drug-master foundation built in Phase 4 (CR-002) to turn
raw OCR text blocks into ranked, explainable drug-match candidates for
pharmacist review. **Explicitly out of scope for this phase** (per the
brief): branch inventory availability, stock reservation, substitution
*recommendation*, order creation, and any form of automatic prescription
approval. All of those remain untouched.

## 1. Architecture summary

A new `matching/` sub-module under the existing `prescriptions` module
adds a `DrugMatchingEngine` orchestrator that runs once per prescription,
across every page's OCR text blocks, on every OCR completion and on every
manual block correction. It never deletes a prior run — matching history
is versioned exactly like `PrescriptionOcrRun`. The engine is built from
independently unit-tested pure-logic components (segmentation, phrase
extraction, strength/dosage-form parsing, candidate scoring, conflict
detection, confidence classification, explanation building) wired
together by one orchestrator, with all weights/thresholds resolved from
Settings (ADR-008) rather than hard-coded.

Seven steps, each committed, tested, and pushed independently:

1. Schema + migration + match-config + settings seed
2. Pure-logic matching components + unit tests
3. Candidate generation + scoring + conflicts + explanation
4. `DrugMatchingEngine` orchestrator + queue/worker + e2e
5. Drug-matching API endpoints + permissions + e2e
6. Frontend drug-match review UI
7. Full regression, docker check, this report

## 2. Pipeline

SEGMENT → EXTRACT → GENERATE → SCORE → DETECT_CONFLICTS → SAVE → ROUTE,
run per medication line, for every line on every page of a prescription:

- **SEGMENT** (`PrescriptionLineSegmenter`) — groups a page's OCR text
  blocks into logical lines and classifies each as `MEDICATION`,
  `PATIENT_INFO`, `DOCTOR_INFO`, `INSTRUCTION`, or `OTHER`. Only
  `MEDICATION` lines enter the matching pipeline.
- **EXTRACT** (`MedicationPhraseExtractor`, `StrengthParser`,
  `DosageFormParser`, `UnitNormalizer`) — pulls a candidate drug-name
  phrase, structured strength (value + unit), and dosage form out of the
  raw line text, never fabricating a value it can't confidently parse.
- **GENERATE** (`DrugCandidateGenerator`) — 6 lookup strategies against
  the DIC (identifier, exact name, exact alias, exact scientific name,
  transliteration, and `pg_trgm` fuzzy-trigram similarity via real SQL,
  never a table-wide JS scan), deduplicated by priority and hydrated in
  one bulk fetch. (Levenshtein re-ranking and manufacturer/package
  context — originally framed as separate "levels" — are folded into
  scoring instead, a deliberate documented simplification from the
  brief's "8 levels" framing; see `candidates/types.ts`.)
- **SCORE** (`DrugCandidateScorer`) — 6 weighted dimensions (name 0.4,
  ingredient 0.15, strength 0.2, dosageForm 0.1, context 0.05,
  dataQuality 0.1, summing to 1.0), each 0-100. A dimension with no
  evidence scores neutral (50), never 0 and never a fabricated high
  value; only an actual detected conflict scores 0 for that dimension.
- **DETECT_CONFLICTS** (`MatchConflictDetector`) — 8 per-candidate codes
  (`STRENGTH_CONFLICT`, `DOSAGE_FORM_CONFLICT`, `DISCONTINUED_DRUG`,
  `INACTIVE_DRUG`, `UNAPPROVED_ALIAS_RELIED_ON`, `LOW_OCR_CONFIDENCE`,
  `NAME_ONLY_WEAK_EVIDENCE`, `DATA_QUALITY_LOW`), plus 2 cross-candidate
  signals (`AMBIGUOUS_MARGIN`, `MULTIPLE_STRONG_CANDIDATES`) attached by
  the engine itself after ranking the full candidate set for a line.
- **Confidence classification** (`ConfidenceClassifier`) requires both
  score *and* margin over the runner-up: `VERY_HIGH` / `HIGH` / `MEDIUM`
  / `LOW` / `UNRESOLVED`, mapped to
  `MedicationLineMatchingStatus` (`HIGH_CONFIDENCE` / `AMBIGUOUS` /
  `LOW_CONFIDENCE` / `UNRESOLVED`).
- **SAVE** — persists `PrescriptionMedicationLine` + ranked
  `PrescriptionDrugCandidate` rows, each carrying `evidenceJson`
  (per-dimension score + explanation), `conflictsJson`, and a
  human-readable `explanationText` — never hidden behind backend-only
  logs, surfaced directly in the API response and UI.
- **ROUTE** — sets `reviewRequired` on ambiguous/low/unresolved lines.
  Only a pharmacist review action (confirm / reject / select-manually /
  mark-not-medication) ever clears `reviewRequired`; the engine itself
  never does — matching never silently confirms a drug.

The whole run is wrapped in try/catch; on failure `DrugMatchRun.status`
is set to `MATCHING_FAILED` with `failureCode`/`failureReason` before
rethrowing, so a bad run is visible rather than silently swallowed.

## 3. ERD summary

New models (additive):

- `DrugMatchRun` — one row per matching run for a prescription, status
  lifecycle `MATCHING_QUEUED → MATCHING_PROCESSING → {MATCHING_COMPLETED,
  MATCHING_REVIEW_REQUIRED, MATCHING_PARTIALLY_RESOLVED, MATCHING_RESOLVED,
  MATCHING_FAILED}`, carries `configurationSnapshotJson` so a run stays
  reproducible even after Settings change later.
- `PrescriptionMedicationLine` — one row per detected medication line,
  `lineIndex` unique per `(matchRunId, lineIndex)`, tracks
  `matchingStatus`, `reviewRequired`, `selectedDrugId`/
  `selectedCandidateId`/`selectedById`/`selectedAt`.
- `DrugMatchDecision` — append-only audit trail of every pharmacist
  review action (`CANDIDATE_CONFIRMED`, `CANDIDATE_REJECTED`,
  `MANUAL_DRUG_SELECTED`, `NON_MEDICATION_LINE`), with
  `previousDrugId` where relevant.
- `PrescriptionLineType`, `MedicationLineMatchingStatus`,
  `DrugMatchRunStatus`, `MatchConfidenceLevel`, `MatchDecisionType` (5
  new enums).

Extended existing model: `PrescriptionDrugCandidate` (+`candidateMargin`,
`evidenceJson`, `conflictsJson`, `explanationText`, rank ordering, plus
`selected`/`rejected`/`status` fields consumed by the review workflow).
No existing table dropped, renamed, or had a column removed.

## 4. Migration

One migration, `20260719201544_p5_drug_matching_engine` (173 lines),
applied via `prisma migrate deploy`. Every new column on the extended
`PrescriptionDrugCandidate` model is nullable/defaulted; no backfill was
required since the table held only mock rows from the pre-Phase-5 stub
matching path, which this phase's Step 4 removed entirely (see §6).

## 5. Configuration (ADR-008)

`MatchConfigService` resolves every weight, penalty, threshold, and limit
from `SettingsService` — `MatchWeights` (6 scoring dimensions),
`MatchPenalties` (5 conflict penalties), `MatchThresholds` (7 values
governing confidence bands and minimum acceptable OCR confidence),
`MatchLimits` (candidate caps + trigram similarity floor), plus
`ocrReliabilityAdjustmentMax` and `engineVersion`. Nothing is hard-coded
in the engine itself; Settings writes remain gated by the existing
`setting.manage` permission — no new permission key was needed for
configuration.

## 6. Removed: the old mock candidate-detection stage

`prescription-ocr.worker.ts`'s `DETECTING_CANDIDATES` stage (a mock
`pythonOcr.detectCandidates()` call that fabricated
`PrescriptionDrugCandidate` rows and flagged `isMedicineLine` without any
real DIC lookup) is deleted, along with the corresponding dead
`detectCandidates()` method and its DTOs in
`python-ocr-client.service.ts` (confirmed unused elsewhere via
project-wide grep before removal). A page now finishes OCR extraction and
transitions straight to `COMPLETED`; once every page on a prescription is
done, `finalizePrescriptionIfDone()` enqueues the real
`DrugMatchingEngine` via BullMQ instead.

## 7. Queue & worker

`PrescriptionDrugMatchingQueueService.enqueuePrescription(prescriptionId)`
— `jobId: prescriptionId` for idempotency (a re-enqueue of an
already-queued prescription is a no-op at the queue level), attempt count
and backoff resolved from `env.PRESCRIPTION_MATCHING_JOB_ATTEMPTS`/
`_BACKOFF_MS`. `DrugMatchingWorkerService` is a thin consumer calling
`engine.run(job.data.prescriptionId)`, gated on
`env.PRESCRIPTION_MATCHING_WORKER_ENABLED`. `correctBlock()` (existing
block-correction flow) now re-invokes the engine scoped to just the
corrected page (`engine.run(prescriptionId, actorId, { pageIds: [pageId] })`)
rather than re-matching the whole prescription.

## 8. API endpoints

All under the existing `prescriptions.controller.ts`, permission-gated
with the existing `ocr.view`/`ocr.review` keys (no new permission keys
needed for this phase):

| Endpoint | Permission | Purpose |
| --- | --- | --- |
| `GET /prescriptions/:id/drug-matches` | `ocr.view` | Latest (or `?runId=`) run with lines/candidates/evidence |
| `GET /prescriptions/:id/drug-matches/runs` | `ocr.view` | Run history |
| `POST /prescriptions/:id/drug-matches/reprocess` | `ocr.review` | Manually re-trigger matching |
| `POST .../medication-lines/:lineId/candidates/:candidateId/confirm` | `ocr.review` | Confirm a candidate as the selected drug |
| `POST .../medication-lines/:lineId/candidates/:candidateId/reject` | `ocr.review` | Reject a candidate |
| `POST .../medication-lines/:lineId/select-drug` | `ocr.review` | Manually search & select a drug not in the candidate list |
| `POST .../medication-lines/:lineId/mark-not-medication` | `ocr.review` | Flag a mis-segmented line |

Every mutating action runs inside a single Prisma `$transaction`,
recording both `AuditService.record()` and `TimelineService.record()` —
no exceptions.

## 9. Frontend

`DrugMatchReviewPanel` renders on the existing prescription detail page
(`/prescriptions/[id]`) below the OCR pages, only once the prescription
has left `UPLOADED` and has pages. Each medication line shows its raw
text, status badge, currently-selected drug (if any), and its ranked
candidate cards; each card exposes an expandable `explanationText` +
per-dimension evidence grid, and always-visible conflict badges
(`BLOCKING`/`WARNING`/`INFO` toned). Confirm/Reject act directly on a
candidate; "Select drug manually" reuses the legacy `/ocr` module's
`CorrectDialog` DIC-search pattern rather than inventing a new search UX;
"Not a medication" flags mis-segmented lines. All review actions are
hidden (not just disabled) for `ocr.view`-only users. Full RTL/LTR
support via the existing i18n convention (`ocr.drugMatches.*` namespace,
49 new keys in each of `en.json`/`ar.json`, purely additive).

## 10. Files created/modified

50 files, +7,082/-87 lines from the end of Phase 4 through this step
(`git diff --stat e7a6092..098ce33`), across 6 commits. Highlights:

- Schema/migration: `prisma/schema.prisma` (+233/-9: 5 enums, 3 new
  models, `PrescriptionDrugCandidate` extended),
  `prisma/migrations/20260719201544_p5_drug_matching_engine/`
- Pure-logic components (all independently unit-tested):
  `matching/{prescription-line-segmenter,medication-phrase-extractor,
  strength-parser,dosage-form-parser,unit-normalizer}.ts`,
  `matching/candidates/{types,string-similarity,drug-candidate-generator,
  drug-candidate-scorer,match-conflict-detector,confidence-classifier,
  match-explanation-builder,structured-strength-mapper}.ts`
- Orchestration: `matching/drug-matching.engine.ts`,
  `matching/match-config.service.ts`,
  `matching/queue/{prescription-drug-matching.queue,drug-matching.worker}.ts`
- API: `matching/drug-match-review.{service,dto}.ts`,
  `prescriptions.controller.ts` (+6 routes),
  `prescriptions.service.ts` (`correctBlock()` re-match hook)
- Removed: the mock `DETECTING_CANDIDATES` stage in
  `prescription-ocr.worker.ts`; dead `detectCandidates()` in
  `python-ocr-client.service.ts`
- Tests: 3 new e2e spec files (10 + 7 + 12 = 29 new e2e tests) + 11 new
  unit spec files (118 new unit tests, spanning both the Step 2
  pure-logic parsers and the Step 3 candidate-generation/scoring/
  conflict/explanation components)
- Frontend: `prescriptions/[id]/drug-match-review.tsx` (new),
  `prescriptions/[id]/page.tsx` (+5 lines), `lib/prescription-types.ts`
  (+133 lines), `components/ui.tsx` (+`purple` badge tone),
  `messages/{en,ar}.json` (+49 keys each)

## 11. Test results

- **Backend unit**: 153 tests / 13 suites, all green
  (`npx jest --config jest.config.js`); 118 of those tests across 11
  suites are new to this phase (`matching/` and `matching/candidates/`).
- **Backend e2e**: 27 suites / 255 tests, all green, run `--runInBand`
  (required — parallel workers race on shared DB state). New to this
  phase: `prescriptions-matching-candidates.e2e-spec.ts` (10 tests, all 6
  generation strategies + dedup priority + hydration against real seeded
  DIC fixtures), `prescriptions-drug-matching.e2e-spec.ts` (7 tests,
  MATCH-1..7: uncontested high-confidence match, ambiguous-margin
  near-tie, discontinued-drug conflict penalty, unresolved/no-match,
  non-medication-line exclusion, deleted-prescription safety, multi-run
  history), `prescriptions-drug-match-review.e2e-spec.ts` (12 tests,
  REV-1..12, full HTTP-level via supertest: GET shapes, `?runId`, 403s
  for view-only tokens, confirm/reject/select-drug/mark-not-medication
  happy paths + decision-record assertions, cross-prescription/
  cross-line 404s, invalid-drug 400). `prescriptions.e2e-spec.ts`'s
  existing PX-4 was rewritten to assert the real hand-off to the live
  matching engine instead of the removed mock stage. All other modules'
  suites confirmed unaffected.
- **Python (OCR service, untouched by this phase)**: 77/77 green —
  confirms no cross-service regression.
- **Frontend**: `tsc --noEmit` clean; `next build` production build
  succeeds (`/prescriptions/[id]` route: 11.1 kB). No automated frontend
  test suite exists in this project (established precedent since Phase
  1 — live Playwright walkthroughs instead).
- **Live walkthrough**: seeded a real fixture prescription + two DIC
  drugs (one matched, one discontinued twin) against the real dev
  database, logged in as a `TEAM_MANAGER`-role user (`ocr.review`
  granted), triggered the real engine through the live API. Verified in
  both Arabic (default, RTL) and English (LTR) locales via Playwright
  screenshots: the review panel renders, candidate cards expand to show
  per-dimension evidence and explanation text, conflict badges render
  correctly, and clicking **Confirm** on the top candidate produced the
  expected end-to-end state change (line marked `CONFIRMED`, review
  panel re-rendered via React Query cache invalidation) through the real
  API — not a mock. Fixture data cleaned up afterward.

## 12. Two real bugs found and fixed via e2e testing

- **Multi-page `lineIndex` collision**: `PrescriptionMedicationLine`
  enforces `@@unique([matchRunId, lineIndex])`, but the segmenter's own
  `line.lineIndex` restarts at 0 for every page — colliding whenever 2+
  pages each had a medication line at the same local index. Fixed by
  introducing a `globalLineIndex` counter in `DrugMatchingEngine.run()`
  that increments once per medication line across the whole run, never
  persisting the segmenter's page-local index directly.
- **Null margin misclassified as zero margin**: `ConfidenceClassifier`
  originally computed `effectiveMargin = margin ?? 0`, so a lone
  candidate with no runner-up to be ambiguous against (`margin: null`)
  failed the margin thresholds and was wrongly capped at `MEDIUM` even
  with a 94/100 score. Fixed so a null margin — nothing to be ambiguous
  against — no longer blocks a high classification; only an actual small
  margin does. Caught proactively while designing Step 4's e2e
  scenarios, before it produced a visible test failure.

## 13. Permissions

No new permission keys were introduced. The existing `ocr.view` (read
matches/runs) and `ocr.review` (reprocess, confirm, reject, select
manually, mark-not-medication) keys — already granted to the appropriate
roles from the OCR phases — cover the full drug-matching review
surface, consistent with this platform's fixed-role, minimal-new-keys
architecture.

## 14. Audit & timeline coverage

Every mutating action in `DrugMatchReviewService` (confirm, reject,
select-drug, mark-not-medication, reprocess) calls both
`AuditService.record()` and `TimelineService.record()` inside the same
transaction as the data change — no exceptions. Verified structurally in
code review, functionally through the e2e suites (which assert on
resulting decision records), and in the live walkthrough.

## 15. Known limitations / deliberately out of scope

- No branch inventory availability check, stock reservation,
  substitution *recommendation*, order creation, or automatic
  prescription approval — explicitly excluded by the brief for this
  phase. Matching only ever produces ranked, explained candidates for a
  human pharmacist to act on.
- Candidate generation runs 6 lookup strategies, not the originally
  envisioned 8 "levels" — Levenshtein re-ranking and manufacturer/
  package context expansion are folded into scoring instead of being
  separate generation queries, a deliberate documented simplification
  (see `candidates/types.ts`).
- Transliteration-sourced candidates remain best-effort/lossy (inherited
  from Phase 4) and are never treated as authoritative by the scorer —
  an `UNAPPROVED_ALIAS_RELIED_ON` conflict is raised when a match relies
  solely on one.
- No Docker daemon persistently available in this sandbox (registry
  pulls to `production.cloudfront.docker.com` blocked by org egress
  policy, confirmed via the proxy status endpoint) — native Postgres 16
  + Redis were used for all development and testing, and
  `docker compose config` was used for structural validation instead
  (§16). This is an environment constraint, not a product limitation.

## 16. Rollback, environment commands, and Phase 6 readiness

**Rollback**: every change in this phase is additive (new tables/
columns/files) or reversible (revert the 6 commits). The one removal —
the mock `DETECTING_CANDIDATES` stage — deleted only fabricated data
with no real-world meaning; nothing derived from it needs to be
preserved.

**Docker**: `docker compose config` (no profile) and
`docker compose --profile app config` both validate cleanly (all 6
services: `postgres`, `redis`, `minio`, `ocr-service`, `api`, `web`).

**Windows** (PowerShell): `docker compose --profile app up -d`, then
from `apps/api`: `npm run db:deploy && npm run db:seed`.
**macOS/Linux**: identical commands in bash/zsh.
**Local dev without Docker**: `apps/api`: `npm run dev`; `apps/web`:
`npm run dev`; requires local Postgres 16 + Redis 7 matching `.env`.

**Phase 6 readiness**: this phase's ranked, explainable, pharmacist-
reviewed drug matches (`PrescriptionMedicationLine.selectedDrugId`) are
what a future inventory/order-creation phase would consume — but per the
brief's explicit instruction, **no further phase is started and none
will begin without further instruction.**
