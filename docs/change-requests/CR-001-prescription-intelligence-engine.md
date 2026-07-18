# CR-001 — Prescription Intelligence Engine (Design Only, Not Yet Approved)

Status: **DESIGN — awaiting approval.** No implementation code has been
written against this document. Per blueprint §1 governance («أي متطلب
جديد يُسجل أولًا كـ Change Request قبل إدخاله في نطاق التنفيذ» / «أي
تعديل يؤثر على Workflow أو SLA أو الصلاحيات أو البيانات الرئيسية يحتاج
Impact Assessment»), this scope goes well beyond blueprint §17's OCR
requirement and is logged here as a Change Request with an impact
assessment before any code changes it.

## 0. Relationship to the shipped platform

This is not a greenfield build. Two things already exist in production
and this design deliberately builds on them rather than duplicating them:

- **DIC drug master (Phase 9, `docs/specs/dic-spec-v1.0.md`)** — `Drug`
  table with 23,024 real rows (materialNo, nameEn/nameAr, brand, price,
  coded/SFDA, availability JSON), `DrugAlternative`/`DrugCrossSell`
  (feed-derived from the monthly Mapping import), `InsuranceCompany`/
  `DrugCoverage`, `DrugChangeRequest` approval workflow. This CR
  **extends** `Drug` with new columns and **adds** new tables
  (`ActiveIngredient`, `DrugIngredient`, `DrugAlias`) rather than
  replacing anything.
- **OCR module (Phase 10, `docs/specs/ocr-spec-v1.0.md`)** — `Prescription`
  and `PrescriptionLine`, `OcrService`, `OcrMatchService` (deterministic
  exact/starts-with/contains/token matcher), review workflow
  (confirm/correct/reject), the §21 Integration Engine as the transport
  to an external OCR HTTP endpoint, and (Phase 12) an AI-assist seam on
  unmatched lines behind the policy gate. **This CR supersedes
  `PrescriptionLine` and the current matcher** with the richer entity
  model and weighted matching engine requested — see §4 and §12 for the
  migration plan and the exact points of conflict.

Two design decisions worth flagging up front, both covered in detail
below, because they change what "extend DIC" and "add a queue" mean in
this codebase:

1. **The DIC `DrugAlternative` table is feed-derived, not
   pharmacist-curated.** It's populated monthly from the Mapping
   export's "Mapped Product 1–22" columns with no type/approval
   semantics. The CR's alternative-type/approval requirement is a
   different concept (clinical substitution rules a pharmacist signs
   off on). §4 proposes a **separate** `DrugPrescriptionAlternative`
   table rather than retrofitting approval fields onto 15,458 existing
   feed rows.
2. **The Python OCR service is first-party, not a §21 external
   connector.** Phase 7's Integration Engine (retry/backoff/DLQ) was
   built for third-party systems we don't control and shouldn't block
   on. The Python service is ours, deployed in the same Docker Compose
   stack, low-latency, and needs per-stage progress/timing — that's a
   job-queue problem (BullMQ), not a retry-queue problem. Both remain
   in the architecture for what they're each good at (§1, §3).

---

## 1. Proposed OCR architecture

```
┌─────────────┐      ┌──────────────────────────────┐      ┌──────────────────────┐
│  Next.js     │      │  NestJS (apps/api)             │      │  Python OCR service    │
│  apps/web    │◄────►│  - Auth/Authz (existing)        │      │  (new: services/ocr-py)│
│  - Upload    │ REST │  - Prescription workflow        │      │  FastAPI, internal-only│
│  - Review UI │      │  - Audit/Timeline/Notifications │      │                        │
│  - Settings  │      │  - DIC matching engine          │─────►│  /v1/analyze-quality   │
└─────────────┘      │  - Review queue                  │ HTTP  │  /v1/preprocess        │
                       │  - Availability adapter          │ (internal│  /v1/detect-text       │
                       └───────────┬─────────────┬────────┘ network)│  /v1/recognize-text    │
                                   │             │                  │  /v1/detect-candidates │
                          BullMQ jobs      Prisma/pg               └───────────┬────────────┘
                                   │             │                             │
                          ┌────────▼──────┐ ┌────▼─────────┐         provider abstraction
                          │ Redis (queue)  │ │ PostgreSQL    │         ┌────────┴────────┐
                          │ existing       │ │ existing +    │         │ PaddleOCR (local)│
                          │ instance, new  │ │ new tables    │         │ Tesseract (local)│
                          │ db index/prefix│ │ (§4)          │         │ [future: Azure/  │
                          └────────────────┘ └───────┬───────┘         │  Textract/GDoc AI│
                                                       │                │  /internal model]│
                                              ┌────────▼────────┐       └──────────────────┘
                                              │ Object storage   │
                                              │ MinIO (S3 API,   │
                                              │ new compose svc) │
                                              │ replaces local-  │
                                              │ disk attachments │
                                              │ for prescription │
                                              │ files specifically│
                                              └──────────────────┘
```

**Why a BullMQ queue in addition to the existing Integration Engine:**
the pipeline is 15 sequential stages per page (§3), each with its own
timing, retry semantics, and debug artifact. The existing
`IntegrationOperation` model is a flat retry-with-backoff record for a
single outbound call — it has no notion of stage sequencing or progress.
BullMQ (backed by the same Redis instance, separate key prefix
`bull:ocr:*` so it never collides with the permission cache or session
data) gives us: per-job progress reporting, stage-level retry, a
built-in dead-letter (failed) queue, and Bull Board for operational
visibility — all requirements the user explicitly listed.

**Why the Python service is a peer, not a §21 connector:** it is
deployed, versioned, and operated by us in the same repo/compose stack.
It never leaves the private Docker network. Contrasting with Phase 11's
connectors (Yeastar, SMS gateway, Maps — all genuinely external, licensed
separately, outside our deploy pipeline), routing internal microservice
calls through the token-guarded/audited §21 machinery would add latency
and semantics (retry backoff measured in minutes) that are wrong for a
call that should return in under a second. The **AI Gateway's policy
gate is a separate, orthogonal concept** — it exists specifically to
control data leaving the platform to a third party, and stays completely
out of this internal pipeline. It only becomes relevant later if a
cloud OCR provider (Azure/Textract/Google) is enabled, which per this CR
defaults to **off** (§6, §9).

---

## 2. Service boundaries

| Responsibility                                                                                                                     | Owner                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication, session, JWT                                                                                                       | NestJS (existing)                                                                                                                                                                                           |
| Authorization (`ocr.*` permissions, data scope)                                                                                    | NestJS (existing)                                                                                                                                                                                           |
| File upload intake, validation, virus/type scan gate                                                                               | NestJS                                                                                                                                                                                                      |
| Object storage read/write (signed URLs)                                                                                            | NestJS                                                                                                                                                                                                      |
| Prescription/Page/TextBlock/Candidate CRUD + status machine                                                                        | NestJS                                                                                                                                                                                                      |
| BullMQ job orchestration, retries, DLQ                                                                                             | NestJS                                                                                                                                                                                                      |
| Audit log, timeline, notifications                                                                                                 | NestJS (existing)                                                                                                                                                                                           |
| DIC matching engine (weighted scoring, all matching)                                                                               | NestJS — needs direct, transactionally-consistent Prisma access to the 23k-row drug master; keeping matching in one language/process avoids a second DB client and a second source of truth for match logic |
| Availability lookup (in-platform `Drug.availability` + §21 DBS refresh)                                                            | NestJS (existing, reused)                                                                                                                                                                                   |
| Review queue UI backend + pharmacist actions                                                                                       | NestJS                                                                                                                                                                                                      |
| Image quality scoring                                                                                                              | Python                                                                                                                                                                                                      |
| Image preprocessing (orientation, perspective, crop, denoise, contrast, sharpen, binarize)                                         | Python                                                                                                                                                                                                      |
| Text detection (bounding boxes)                                                                                                    | Python                                                                                                                                                                                                      |
| Text recognition (OCR, printed + handwritten)                                                                                      | Python                                                                                                                                                                                                      |
| Per-block OCR confidence                                                                                                           | Python                                                                                                                                                                                                      |
| Language detection (ar/en/mixed)                                                                                                   | Python                                                                                                                                                                                                      |
| Text normalization _at the character/OCR level_ (e.g. fixing `0`↔`O`, joining broken words)                                        | Python                                                                                                                                                                                                      |
| Medicine-line candidate extraction (which lines of the OCR output _look like_ a drug mention — pattern/heuristic, not DB matching) | Python                                                                                                                                                                                                      |
| OCR provider selection/abstraction                                                                                                 | Python                                                                                                                                                                                                      |

The dividing line: **Python turns pixels into normalized candidate text
lines. NestJS turns candidate text lines into DIC drug matches.** Python
never talks to Postgres or knows what a `Drug` row is; it has no DB
credentials at all, closing off an entire class of security risk.

---

## 3. Data flow

1. **Upload** — `POST /prescriptions` (NestJS) creates a numbered
   `Prescription` shell (reuses the existing `NumberingService`,
   format `PRX-{YYYY}-{SEQ:6}`, unchanged from Phase 10).
2. **File registration** — client uploads file(s) via the existing
   Attachments pattern, but to the new MinIO-backed driver; each file
   becomes one `PrescriptionPage` row (`processingStatus: QUEUED`).
   Multi-page PDFs are split into one page per image server-side.
3. **Enqueue** — NestJS pushes one BullMQ job per page onto the
   `prescription-ocr` queue and returns `{ prescriptionId, status:
"PROCESSING" }` immediately — the API never blocks on OCR.
4. **Stage 1–2 (NestJS, pre-queue, synchronous):** file validation
   (size/MIME/magic-bytes) and malware scan gate happen **before** the
   job is even queued, so obviously-bad uploads fail fast with a
   user-facing 400 rather than occupying a worker.
5. **Stages 3–13 (worker, calls Python):** the BullMQ worker calls the
   Python service's pipeline endpoints in sequence
   (`/v1/analyze-quality` → early-exit to `IMAGE_REUPLOAD_REQUIRED` if
   below `IMAGE_QUALITY_MINIMUM` → `/v1/preprocess` →
   `/v1/detect-and-recognize` → `/v1/detect-candidates`). Each response
   is persisted: `PrescriptionPage.enhancedImageUrl`/`imageQualityScore`/
   `orientation`, and one `OCRTextBlock` row per detected line
   (`rawText`, `normalizedText` as returned by Python, `boundingBox`,
   `language`, `OCRConfidence`, `lineNumber`).
6. **Stage 14 (worker, calls NestJS-internal matching engine):** for
   each `OCRTextBlock` Python flagged as a medicine-line candidate, the
   matching engine (§7) queries the DIC master and creates one
   `PrescriptionDrugCandidate` per plausible match with `matchConfidence`
   and `matchExplanation`.
7. **Stage 15 (status decision):** the confidence-threshold engine (§8)
   sets each candidate's `status` and rolls up `Prescription.status`
   and `overallConfidence`. Anything below threshold →
   `NEEDS_PHARMACIST_REVIEW`/`AMBIGUOUS_MATCH`; the prescription is
   pushed into the review queue and its uploader is notified
   (`NotificationsService`, existing).
8. **Confirmation:** a pharmacist reviews (§13), confirming, replacing,
   or rejecting each candidate. Confirmation of a candidate triggers an
   **availability check** (§ "Availability Integration" below) —
   read-only against `Drug.availability`, with an on-demand refresh via
   the existing Phase 11 DBS connector if the pharmacist asks for one.
9. **Every state transition and pharmacist action is an `AuditLog` +
   `TimelineEvent` row** (existing services, unchanged contract) —
   nothing new to build here, just more call sites.
10. **Learning loop:** an `OCRCorrection` row is written whenever a
    pharmacist changes the system's suggestion. Corrections **never**
    write directly to `Drug`, `DrugAlias`, or `DrugAlternative` — see §12
    "learn without silently modifying the master" for the exact
    mechanism (a proposal queue, same DoD as `DrugChangeRequest`).

---

## 4. Database changes

### 4.1 Extend `Drug` (Phase 9 table, additive columns only)

| New column                   | Type    | Notes                                                                                                                                    |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `dosageForm`                 | String? | e.g. "Tablet", "Syrup" — not in the current Mapping feed; backfilled empty, editable via `DrugChangeRequest` like the existing H5 fields |
| `strength`                   | String? | free-text strength as printed (e.g. "500mg") — separate from parsed numeric strength kept on the candidate for matching                  |
| `unit`                       | String? | e.g. "mg", "ml"                                                                                                                          |
| `manufacturer`               | String? |                                                                                                                                          |
| `country`                    | String? |                                                                                                                                          |
| `requiresSpecialHandling`    | Boolean | default false — narcotics/controlled-substance flag                                                                                      |
| `normalizedTradeNameEnglish` | String  | computed at write time (§7.2), indexed (btree + GIN trigram)                                                                             |
| `normalizedTradeNameArabic`  | String? | computed at write time, indexed                                                                                                          |

`sapMaterialNumber` and `isActive` already exist as `materialNo` (unique)
and the absence of `deletedAt`-style soft delete — this CR adds
`isActive Boolean @default(true)` rather than introducing a second
identity field, and a `deletedAt` was intentionally never added to
`Drug` in Phase 9 (master data is upserted, not deleted); `isActive`
fills the "discontinued but keep for history" case that materialized
during this review.

### 4.2 New: `ActiveIngredient`

```
id, scientificNameEnglish, scientificNameArabic,
normalizedNameEnglish, normalizedNameArabic
```

### 4.3 New: `DrugIngredient` (join, many-to-many with strength)

```
drugId, activeIngredientId, ingredientStrength, ingredientUnit
@@unique([drugId, activeIngredientId])
```

### 4.4 New: `DrugAlias`

```
id, drugId, alias, normalizedAlias, language (AR|EN),
aliasType (enum, below), source, approved (Boolean, default false),
createdById, approvedById, createdAt, approvedAt
```

`AliasType`: `TRADE_NAME`, `SCIENTIFIC_NAME`, `ABBREVIATION`,
`COMMON_MISSPELLING`, `OCR_VARIANT`, `LEGACY_NAME`,
`ARABIC_TRANSLITERATION`, `ENGLISH_TRANSLITERATION`.

Unapproved aliases (`approved: false`) are **matched against but
ranked lower** and never shown as the drug's "name" anywhere outside
the review workspace — this is how OCR-observed spelling variants
become searchable without a pharmacist having blessed them yet, while
staying clearly provisional (§12 learning-loop detail).

### 4.5 New: `DrugPrescriptionAlternative` (NOT the existing `DrugAlternative`)

```
id, sourceDrugId, alternativeDrugId, alternativeType (enum, below),
approvedByPharmacistId, priority, notes, isActive, createdAt
@@unique([sourceDrugId, alternativeDrugId])
```

`AlternativeType`: `SAME_ACTIVE_INGREDIENT`, `SAME_STRENGTH`,
`SAME_DOSAGE_FORM`, `THERAPEUTIC_ALTERNATIVE`, `GENERIC_ALTERNATIVE`,
`BRAND_ALTERNATIVE`.

**Only rows with `approvedByPharmacistId IS NOT NULL AND isActive` are
ever returned to a user.** This table starts empty; the existing
feed-derived `DrugAlternative`/`DrugCrossSell` tables are untouched and
keep serving the DIC search screen exactly as today — this CR does not
touch DIC search UX, only adds the prescription-context alternative
list.

### 4.6 Prescription domain (supersedes Phase 10's `PrescriptionLine`)

**`Prescription`** — extends the Phase 10 table: add `customerId?`
(nullable FK to a future customer master — no customer table exists yet
platform-wide, so nullable String reference for now, flagged in §12),
`source` (String, e.g. "walk_in"/"online"/"branch"), `processedFileUrl?`,
`overallConfidence Decimal?`, `detectedLanguage?`, `completedAt?`. Keep
`number`, `status`, `uploadedById`, `reviewedById`, `reviewedAt`,
`ticketId`, `relatedOrderNo`, `note` unchanged (I6 link-only semantics
from the existing spec carry over unmodified). `status` enum grows from
5 values to the CR's required set (§8).

**`PrescriptionPage`** (new) — `id, prescriptionId, pageNumber,
originalImageUrl, enhancedImageUrl, imageQualityScore, orientation,
processingStatus, createdAt, updatedAt`. One row per uploaded/split
page; today's model assumes exactly one attachment per prescription —
this is the multi-page generalization.

**`OCRTextBlock`** (new, replaces the raw-text half of
`PrescriptionLine`) — `id, prescriptionPageId, rawText, normalizedText,
boundingBox (Json: {x,y,w,h}), language, OCRConfidence, lineNumber`.

**`PrescriptionDrugCandidate`** (new, replaces the match half of
`PrescriptionLine`) — `id, prescriptionId, OCRTextBlockId,
extractedDrugText, extractedStrength, extractedDosageForm,
matchedDrugId?, matchConfidence?, status (enum §8), matchExplanation
(Json: string[] of match reasons + score breakdown), reviewedById?,
reviewedAt?`. **One text block can yield zero, one, or several
candidates** (e.g. ambiguous OCR yields two plausible drugs) — this is
the structural reason `PrescriptionLine`'s 1:1 line↔match model doesn't
fit the CR's "return multiple ranked candidates" requirement and must
be replaced, not extended.

**`OCRCorrection`** (new) — `id, candidateId, originalOCRText,
correctedText, originalDrugId?, correctedDrugId?, correctedById,
correctionReason, createdAt`. Purely additive audit/analytics trail;
never mutates `Drug`.

### 4.7 Permissions — additive, reuse existing pattern

`ocr.view`/`ocr.upload`/`ocr.review` (Phase 10) are unchanged and cover
everything in this CR except two new administrative actions:

| New key                  | Grants                                                        |
| ------------------------ | ------------------------------------------------------------- |
| `ocr.alias.manage`       | Propose/approve `DrugAlias` rows, view alias analytics screen |
| `ocr.alternative.manage` | Approve `DrugPrescriptionAlternative` rows                    |

Confidence thresholds and OCR provider config are **Settings**
(existing engine, ADR-008), gated by the existing `setting.manage`
permission — no new permission needed there, consistent with how every
other module's tunables work.

### 4.8 Migration plan for the Phase 10 → CR-001 cutover

Since Phase 10 shipped with e2e coverage and demo data but (per
`docs/delivery-summary.md`) no production customers yet, the lowest-risk
path is: ship the new tables alongside the old ones in Sprint OCR-01,
migrate/backfill any existing `PrescriptionLine` rows into
`OCRTextBlock`+`PrescriptionDrugCandidate` in a dedicated migration
sprint (OCR-12, §10), then drop `PrescriptionLine`. **If real
production prescriptions exist by the time OCR-12 starts, this becomes
a data-preserving migration script, not a schema swap** — flagged as a
hard go/no-go gate in §12.

---

## 5. API contracts (NestJS-facing, representative — not exhaustive)

```
POST /api/v1/prescriptions
  body: { note?, source? }
  → 201 { id, number, status: "UPLOADED" }

POST /api/v1/prescriptions/:id/pages
  multipart file upload (one call per page, or one call with multiple files)
  → 201 { pageId, pageNumber }

POST /api/v1/prescriptions/:id/submit
  → 200 { id, status: "QUEUED" }   // enqueues one BullMQ job per page

GET /api/v1/prescriptions/:id
  → 200 {
      id, number, status, overallConfidence, detectedLanguage,
      pages: [{ id, pageNumber, imageQualityScore, orientation,
                processingStatus, enhancedImageUrl (signed) }],
      candidates: [{
        id, extractedDrugText, extractedStrength, extractedDosageForm,
        status, matchConfidence,
        matches: [{                       // ranked, top-N
          drugId, tradeNameEnglish, tradeNameArabic, strength, dosageForm,
          matchScore, matchReasons: ["trade_name_similarity","strength_match"]
        }]
      }]
    }

GET /api/v1/prescriptions?status=&page=&pageSize=      // scope-aware, existing pattern

POST /api/v1/prescriptions/candidates/:id/confirm
  body: { drugId }              // must be one of the returned matches, or a manual DIC pick
  → 200 { status: "CONFIRMED", availability: {...} | null }

POST /api/v1/prescriptions/candidates/:id/reject
  body: { reason: "UNREADABLE" | "NOT_A_MEDICINE" | "OTHER", note? }

POST /api/v1/prescriptions/candidates/:id/replace
  body: { drugId, correctionReason }
  → writes OCRCorrection + updates candidate

GET /api/v1/prescriptions/candidates/:id/availability
  → 200 { status: "AVAILABLE"|"OUT_OF_STOCK"|"AVAILABILITY_SERVICE_UNAVAILABLE",
          quantity?, branches?: [...], onlineHub?, lastUpdatedAt }

POST /api/v1/dic/aliases                 // ocr.alias.manage
GET  /api/v1/dic/aliases?status=pending
POST /api/v1/dic/aliases/:id/approve

POST /api/v1/dic/prescription-alternatives   // ocr.alternative.manage
POST /api/v1/dic/prescription-alternatives/:id/approve

GET  /api/v1/ocr/settings                 // thresholds, read via setting.view
PATCH /api/v1/ocr/settings                // setting.manage
```

### 5.1 NestJS → Python internal contract

```
POST /v1/analyze-quality
  { imageUrl (presigned, short-TTL, internal) }
  → { qualityScore: 0..1, issues: ["BLUR","LOW_RESOLUTION","GLARE"] }

POST /v1/preprocess
  { imageUrl }
  → { enhancedImageUrl, orientation: 0|90|180|270, stagesApplied: [...] }

POST /v1/detect-and-recognize
  { imageUrl, provider?: "paddleocr"|"tesseract" }
  → { blocks: [{ rawText, normalizedText, boundingBox, language, confidence, lineNumber }],
      detectedLanguage: "ar"|"en"|"mixed",
      providerUsed, processingTimeMs }

POST /v1/detect-candidates
  { blocks: [...] }               // same shape as above
  → { candidateLines: [{ blockIndex, extractedDrugText, extractedStrength?, extractedDosageForm? }] }
```

All four are synchronous internal HTTP calls made from within the
BullMQ worker (not queued individually) — the queue boundary is
"one page," not "one pipeline stage," so stage failures retry the whole
page's job rather than requiring cross-stage checkpointing for v1.
Every request/response pair is persisted verbatim (§ "store every
stage") for debugging, keyed by `prescriptionPageId` + stage name.

---

## 6. OCR provider interface (Python side — contract only, no implementation)

```python
class OCRProvider(Protocol):
    name: str
    supports_handwriting: bool
    is_local: bool          # False only for cloud providers

    def detect_and_recognize(self, image: PreparedImage) -> OCRResult: ...
    def health_check(self) -> ProviderHealth: ...
```

`OCRResult` carries per-block text + bbox + confidence, matching the
`/v1/detect-and-recognize` response shape in §5.1. A `ProviderRegistry`
selects the active provider from Settings
(`ocr.provider.printed`, `ocr.provider.handwriting` — separate settings
because PaddleOCR/Tesseract are strong on printed text and weak on
handwriting; a future internal handwriting model would only replace the
second). **`is_local` is enforced, not advisory**: the registry refuses
to route a request to a provider with `is_local == False` unless
`integrations.ocr_cloud.enabled` is explicitly on (default off, §9) —
this is the concrete mechanism behind "do not send healthcare data to
an external provider unless explicitly enabled," independent of and in
addition to the Phase 12 AI policy gate (that gate covers the _matching
assist_ seam; this flag covers the _OCR_ seam — two different data
flows, two independent switches, same doctrine).

Initial providers: `PaddleOCRProvider` (local, printed + reasonable
handwriting support, CPU-only default), `TesseractProvider` (local,
printed-text fallback if PaddleOCR errors or is unavailable). Future
slots already accounted for by the interface: `AzureDocIntelligence`,
`AWSTextract`, `GoogleDocumentAI`, `InternalHandwritingModel` — each a
new class implementing the same `Protocol`, zero changes to NestJS or
the matching engine.

---

## 7. Drug matching algorithm design

### 7.1 Pipeline (short-circuit tiers, then weighted scoring)

1. **SAP material number exact match** (if the OCR text or a companion
   barcode/number happens to contain one) → score `1.0`, stop.
2. **Exact normalized trade name / scientific name / approved alias
   match** → score `0.95`, stop (mirrors the existing deterministic
   tiers, extended to also check `ActiveIngredient` and `DrugAlias`).
3. Otherwise, compute a **weighted score** across signals, each in
   `[0,1]`, combined as a weighted sum with **weights stored in
   Settings** (`matching.weight.*`, ADR-008 — not hard-coded, per the
   CR's explicit requirement):

| Signal                              | Default weight | Computation                                                                            |
| ----------------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| Trade name similarity               | 0.30           | `pg_trgm` `similarity()` on normalized trade name                                      |
| Scientific/ingredient similarity    | 0.15           | `pg_trgm` on `ActiveIngredient.normalizedName*`, via `DrugIngredient`                  |
| Alias similarity (incl. unapproved) | 0.15           | `pg_trgm` against `DrugAlias.normalizedAlias`, unapproved rows capped at 0.8×          |
| Token/Levenshtein distance          | 0.10           | Postgres `fuzzystrmatch` `levenshtein()`, normalized by string length                  |
| Transliteration similarity          | 0.10           | Arabic↔English phonetic mapping table (§7.2) applied before trigram                    |
| Strength match                      | 0.10           | exact/near numeric match between extracted and candidate strength                      |
| Dosage form match                   | 0.05           | normalized form string equality                                                        |
| Manufacturer match                  | 0.03           | when both sides have data; 0 contribution otherwise (never penalizes missing data)     |
| Surrounding-text context            | 0.02           | boost if sibling text blocks on the same page mention the same drug class/manufacturer |

Candidates below `OCR_MINIMUM_CONFIDENCE` (on the _text block_, before
matching even runs) are not matched at all. The top-N (default 5,
configurable) candidates above a floor score are returned, ranked, with
`matchReasons` listing every signal that contributed non-trivially —
this is exactly the response shape in the CR's example.

### 7.2 Normalization

**Arabic** (applied to both stored `normalized*` columns and query-time
input, so both sides are always compared in the same space):
unify `أ إ آ` → `ا`; unify `ى` → `ي`; conditionally unify `ة` → `ه` only
at word end when the alternate form exists as a variant in `DrugAlias`
(never blind global replace, to avoid false collisions); strip
diacritics (tashkeel) and tatweel (`ـ`); map Arabic-Indic digits
`٠-٩` → ASCII `0-9`; collapse whitespace; apply an OCR-substitution
table (e.g. `ه`↔`0` misreads common in low-quality scans).

**English:** lowercase; strip punctuation except within numbers/units;
collapse whitespace; normalize hyphens (`Co-Amoxiclav` ≈
`Co Amoxiclav` ≈ `Coamoxiclav`); OCR-substitution table (`0`↔`O`,
`1`↔`l`↔`I`, `5`↔`S`, `rn`↔`m`).

**Transliteration table:** a curated Arabic↔English phonetic mapping
(e.g. `بنادول` ↔ `panadol`) seeded from the real DIC data during import
(any drug with both an approved Arabic and English name contributes a
training pair) rather than a general-purpose transliteration library —
keeps it scoped to actual pharmacy vocabulary and avoids generic
transliteration noise.

All of `normalizedTradeNameEnglish/Arabic`, `ActiveIngredient`'s
normalized columns, and `DrugAlias.normalizedAlias` are computed **once,
at write time** (import/approval), not per-query — required for the
23k-row master to stay fast under `pg_trgm` GIN indexes.

---

## 8. Confidence scoring design

### 8.1 Settings (all in the existing Settings engine, ADR-008)

| Key                          | Default | Meaning                                                                                              |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `ocr.match.auto_threshold`   | `0.92`  | ≥ this + single clear leader → `AUTO_MATCHED`                                                        |
| `ocr.match.review_threshold` | `0.60`  | below this → treated as no acceptable candidate                                                      |
| `ocr.text.min_confidence`    | `0.50`  | OCR block confidence floor before matching is even attempted                                         |
| `ocr.match.candidate_gap`    | `0.08`  | if top-2 candidates' scores differ by less than this → `AMBIGUOUS_MATCH` regardless of the top score |
| `ocr.image.quality_minimum`  | `0.40`  | page quality floor before OCR runs at all                                                            |

### 8.2 Decision tree (per `PrescriptionDrugCandidate`)

```
page.imageQualityScore < IMAGE_QUALITY_MINIMUM
  → PrescriptionPage.processingStatus = IMAGE_REUPLOAD_REQUIRED (stop, no OCR run)

textBlock.OCRConfidence < OCR_MINIMUM_CONFIDENCE
  → candidate not created; block flagged low-confidence for manual review

no candidate scores ≥ REVIEW_THRESHOLD
  → status = NOT_FOUND

top two candidates within MULTIPLE_CANDIDATE_DIFFERENCE of each other
  → status = AMBIGUOUS_MATCH

single leader ≥ AUTO_MATCH_THRESHOLD
  → status = AUTO_MATCHED           // still visible to a pharmacist, never silently applied to inventory/order actions

REVIEW_THRESHOLD ≤ leader < AUTO_MATCH_THRESHOLD
  → status = NEEDS_PHARMACIST_REVIEW
```

`Prescription.overallConfidence` = the minimum candidate confidence on
the prescription (a chain is as strong as its weakest medicine — a
single low-confidence line pulls the whole prescription into review).
`Prescription.status` is `REVIEW` if any candidate is
`NEEDS_PHARMACIST_REVIEW`/`AMBIGUOUS_MATCH`/`NOT_FOUND`, otherwise
`CONFIRMED` only once a pharmacist has explicitly confirmed every
`AUTO_MATCHED` candidate too — **the safety rule is absolute:
`AUTO_MATCHED` pre-fills the review screen with the system's best guess
already selected, but a human still presses confirm.** This is stricter
than Phase 10's OCR spec (which allowed auto-suggestion without
requiring a click on every line) and is the correct behavior given the
CR's explicit critical safety rule.

---

## 9. Security and privacy design

- **File limits:** reuse `attachments.max_size_mb`/`attachments.allowed_mime`
  settings (existing), scoped additionally to `prescription.*` MIME
  allowlist (image/jpeg, image/png, image/webp, application/pdf).
- **Malware/type validation:** magic-byte verification (not just
  extension) at intake, before queueing. A pluggable AV scan hook
  (ClamAV via a sidecar) is designed in but **off by default** —
  running a full AV engine is an infra decision for the deploying
  environment, flagged as a risk in §12, not blocking Sprint OCR-01.
- **Access-controlled files, signed URLs:** MinIO presigned URLs with a
  short TTL (default 5 minutes), scoped per-request, never a public
  bucket. No `originalImageUrl`/`enhancedImageUrl` is ever a permanent
  public link — the API always returns a freshly-signed URL.
- **Encryption at rest:** MinIO server-side encryption (SSE-S3),
  Postgres disk encryption — both deployment/infra configuration,
  documented in the Docker Compose but not something application code
  controls.
- **Encryption in transit:** TLS on all external-facing traffic
  (existing); the NestJS↔Python link stays on the private Compose
  network — TLS there is recommended for parity with a future
  multi-host deployment but not a hard blocker for local Compose.
- **Prescription access permissions:** `ocr.view` scope-aware exactly
  as Phase 10 (`MY_RECORDS`/`MY_TEAM`/`DEPARTMENT`/`ALL_DATA`) — no
  change needed, the model already fits.
- **No external OCR by default:** enforced at the provider-registry
  level (§6), independent of the Phase 12 AI gate.
- **Data retention:** new setting `ocr.retention.debug_artifacts_days`
  (default 30) — a scheduled job purges per-stage debug images/JSON
  older than this; the final `Prescription`/candidate records (the
  clinical/audit record) are retained per the platform's general
  retention policy (§19.3, unchanged, no new mechanism needed).
- **Temporary file cleanup:** any intermediate file the Python service
  writes to local disk during processing is deleted at the end of the
  request regardless of success/failure (`finally`-block responsibility
  of the Python service, not NestJS).
- **Audit:** every state transition, every pharmacist action, every
  alias/alternative approval — all through the existing `AuditService`,
  same contract, no new audit mechanism.

---

## 10. Implementation sprints

| Sprint                        | Scope                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OCR-01** (next, on request) | DB entities (§4.6 new tables only — not yet the Drug/Alias extension), upload API, MinIO-backed secure file storage, BullMQ job queue skeleton, prescription status workflow, Python service skeleton (FastAPI, health check, no real CV yet), **mock OCR provider** (deterministic canned responses for tests), unit + integration tests. Per the CR's own instruction: **no real drug matching in this sprint.** |
| OCR-02                        | Real image pipeline in Python: quality analysis, orientation/perspective/crop, denoise/contrast/sharpen/binarize — each stage's output persisted                                                                                                                                                                                                                                                                   |
| OCR-03                        | PaddleOCR + Tesseract providers wired in behind the provider interface; language detection; per-block confidence                                                                                                                                                                                                                                                                                                   |
| OCR-04                        | DIC schema extension (§4.1–4.5: `ActiveIngredient`, `DrugIngredient`, `DrugAlias`, `DrugPrescriptionAlternative`, `Drug` columns) + seed/backfill of normalized columns                                                                                                                                                                                                                                            |
| OCR-05                        | Matching engine v1 — deterministic tiers + alias matching (no fuzzy scoring yet)                                                                                                                                                                                                                                                                                                                                   |
| OCR-06                        | Fuzzy/weighted matching — `pg_trgm`/`fuzzystrmatch` integration, transliteration table, full scoring per §7                                                                                                                                                                                                                                                                                                        |
| OCR-07                        | Confidence thresholds + status workflow (§8), Settings screen for thresholds                                                                                                                                                                                                                                                                                                                                       |
| OCR-08                        | Availability integration (reuses Phase 11 DBS connector + `Drug.availability`), `AVAILABILITY_SERVICE_UNAVAILABLE` handling                                                                                                                                                                                                                                                                                        |
| OCR-09                        | Pharmacist Review Queue + Review Workspace frontend (zoom/rotate, bboxes, candidate picker, manual DIC search, all review actions)                                                                                                                                                                                                                                                                                 |
| OCR-10                        | Alias Management + Prescription-Alternative Management admin screens; the learning-loop proposal flow (§12)                                                                                                                                                                                                                                                                                                        |
| OCR-11                        | Remaining frontend screens (Upload, Processing Status, Results, History, Error Dashboard, OCR Settings, Training/Correction Analytics)                                                                                                                                                                                                                                                                             |
| OCR-12                        | Observability (metrics list in the CR), retention job, legacy `PrescriptionLine` migration + cutover, full regression, acceptance                                                                                                                                                                                                                                                                                  |

Each sprint closes with the same Definition-of-Done rigor as every prior
phase in this project: spec/design → schema+e2e → frontend+Chromium
walkthrough → acceptance record, committed and pushed before the next
sprint starts.

---

## 11. Test strategy

**Python (pytest):** unit tests per pipeline stage with fixture images
(synthetic + any real anonymized samples the company can provide);
golden-file tests for the mock provider; contract tests validating every
`/v1/*` response matches §5.1 exactly regardless of which real provider
is behind it.

**NestJS (Jest, matching the existing `*.e2e-spec.ts` convention):**

- Normalization functions — pure unit tests: Arabic diacritics/hamza
  variants, digit conversion, English OCR substitutions, hyphen
  joining/splitting.
- Matching engine — unit tests against a seeded fixture drug set
  (not the real 23k rows, for determinism) covering: Arabic trade
  names, English trade names, scientific names, common misspellings,
  OCR character errors, strength extraction, dosage-form extraction,
  multiple visually-similar medicines (ambiguous-match path),
  partial names.
- Confidence/status decision function — unit tests for every branch of
  §8.2's decision tree, including boundary values at each threshold.
- e2e: upload → queue → mocked Python responses → candidates created →
  review actions → confirm → availability lookup (mocked DBS both up
  and down) → audit rows present. Mirrors the pattern already used for
  OCR (`ocr.e2e-spec.ts`) and connectors (`connectors.e2e-spec.ts`).
- e2e: unreadable/poor-quality/rotated image → `IMAGE_REUPLOAD_REQUIRED`
  short-circuit, no OCR call made.
- e2e: duplicate prescription upload (same file hash) — flagged, not
  silently deduplicated (pharmacist decides, matching the "never
  silent" doctrine used throughout this platform).
- e2e: unauthorized access at every new endpoint (403 without the
  right `ocr.*` permission/scope).
- e2e: forced low-confidence result never reaches `AUTO_MATCHED` even
  if a bug tried to force it — a regression guard on the safety rule.
- e2e: pharmacist correction workflow — replace/confirm/reject, verify
  `OCRCorrection` written and `Drug`/`DrugAlias` **unchanged** until a
  separate approval step runs.

Full regression (existing 159 e2e across 18 suites) must stay green
throughout — no sprint in this CR touches existing modules except the
additive `Drug` columns and the new permission keys.

---

## 12. Risks and assumptions

1. **`PrescriptionLine` → `OCRTextBlock`/`PrescriptionDrugCandidate`
   migration.** Low risk today (no production prescriptions per the
   delivery record), but OCR-12 must re-check this assumption before
   dropping the old table — if real data exists by then, this becomes
   a data-migration script and a maintenance-window decision, not a
   schema swap. **Needs explicit go/no-go before OCR-12.**
2. **Feed-derived `DrugAlternative` vs. new `DrugPrescriptionAlternative`.**
   Assumed these are different concepts (auto-imported "mapped
   products" vs. pharmacist-approved clinical substitutions) and kept
   them as separate tables. If the company actually wants the existing
   15,458 feed-derived rows to become the seed data for
   pharmacist-approval workflows instead, that's a smaller CR to
   reconcile — **flagging for confirmation, not blocking Sprint OCR-01.**
3. **Malware scanning** is designed as a pluggable hook, not delivered
   in Sprint OCR-01 — running ClamAV is an infra/ops decision for the
   deploying environment. MIME + magic-byte validation ships from day
   one; full AV is a later sprint or an ops runbook item.
4. **PaddleOCR is CPU-only by default** in this design (no GPU
   assumption in Docker Compose) — handwriting accuracy will be modest
   until/unless a GPU-backed deployment or a specialized handwriting
   model is added later (already accounted for in the provider
   interface). **Set expectations accordingly: for handwritten
   prescriptions, `NEEDS_PHARMACIST_REVIEW` should be the norm, not the
   exception** — this is a feature of the safety design, not a defect.
5. **Object storage** — this CR proposes introducing MinIO
   (S3-compatible, fits the existing `StorageDriver` interface from
   Phase 1/Attachments with a new driver implementation) rather than a
   cloud bucket, to keep local/on-prem parity and match the "Docker
   Compose" requirement. A cloud-bucket driver is a drop-in swap later
   if needed (same interface).
6. **Confidence threshold defaults (§8.1) are engineering starting
   points, not clinical guidance.** They must be reviewed and adjusted
   by an actual pharmacist/clinical stakeholder before go-live, given
   the patient-safety stakes — this is explicitly called out as a
   pre-launch gate, not something the platform can self-certify.
7. **`customerId` on `Prescription`** references a customer master that
   doesn't exist yet anywhere in the platform (no CRM customer entity
   was built in prior phases — CRM/Telesales, Phase 6, models leads and
   telesales orders, not a durable customer master). Kept nullable and
   untyped (`String?`) for this CR; wiring it to a real customer table
   is out of scope here and would be its own CR.
8. **BullMQ adds a new runtime dependency** (`bullmq` npm package) and
   a new Redis key namespace on the existing instance — no new
   infrastructure service, low risk, but worth naming as a new
   dependency the team is taking on.
9. **Language-detection library choice** (e.g. fastText vs. a simple
   Arabic-script-ratio heuristic) is deferred to OCR-03 — a heuristic
   is likely sufficient given the domain (ar/en/mixed only, not
   open-domain language ID) and avoids a large model download.
10. **Recommend phased rollout:** enable printed-prescription OCR first
    (higher accuracy, lower risk) and gate handwriting support behind a
    separate setting until the printed path has real-world validation
    — reduces blast radius of the riskiest part of the system.

---

## Approval checklist

- [ ] Confirm the `DrugAlternative` vs `DrugPrescriptionAlternative`
      split (§12.2) is the intended model, or reconcile per the
      alternative noted.
- [ ] Confirm `PrescriptionLine` migration timing/risk tolerance (§12.1).
- [ ] Confirm default confidence thresholds are placeholders pending
      pharmacist sign-off (§12.6), not final values.
- [ ] Confirm MinIO (vs. a cloud bucket) is acceptable for object storage.
- [ ] Approve Sprint OCR-01 scope as the starting point, per the CR's
      own instruction to not build everything in one pass.

Once approved, implementation begins with **Sprint OCR-01** exactly as
scoped in §10, following this project's established per-sprint rigor
(design → schema/API/tests → frontend/UAT → acceptance record, each
committed and pushed before the next sprint starts).
