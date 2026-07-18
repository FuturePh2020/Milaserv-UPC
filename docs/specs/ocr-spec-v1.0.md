# OCR Prescription Processing — Module Specification v1.0

Source: blueprint §17 (OCR Prescription Processing) + §21 (OCR listed as an
integration: «قراءة الوصفات») governed by the §21.1 integration standard.
Prescriptions feed the §18 model through the existing Attachment, Ticket and
Drug master objects.

Open points are flagged as assumptions I1–I8.

## 1. Blueprint requirements (verbatim mapping)

| §17 item                                              | Delivered as                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| رفع صورة أو PDF للوصفة                                | `Prescription` + file via the existing Attachments engine (image/PDF)    |
| استخراج أسماء الأدوية                                 | `ocr.extract` operation through the Integration Engine (I1)              |
| مطابقة مع Drug Master                                 | Deterministic matcher against the §15 drug master (I3)                   |
| إظهار Confidence Score                                | Per line: engine confidence + match score, both surfaced in the UI       |
| مراجعة وتصحيح بشري                                    | REVIEW stage — correct match, add/reject lines, all behind `ocr.review`  |
| فحص التوافر                                           | Matched drug's per-city availability (§15.2 H6 snapshot) shown per line  |
| اقتراح البدائل                                        | Matched drug's `DrugAlternative` links shown per line                    |
| ربط النتيجة بطلب أو Ticket                            | Confirm step links an existing ticket number and/or order number (I6)    |
| لا يعتمد النظام نتيجة OCR الحساسة تلقائيًا دون مراجعة | No auto-approval path exists: only `ocr.review` holders can confirm (I4) |

## 2. Design decisions

### I1 — OCR engine is external, behind the Integration Engine

§21 lists OCR as an integration, so extraction is **not** implemented
in-process. Submitting a prescription enqueues an `ocr.extract`
`IntegrationOperation`; the existing executor gives us the whole §21.1
standard (timeout, exponential retry, dead-letter + admin alert, monitor,
manual retry) unchanged. The executor is extended in two small ways:

- it now **captures the response body** (previously discarded), and
- modules may **register a success handler** per integration key
  (`IntegrationsService.registerHandler`) — the OCR module registers one
  that applies extraction results. No circular dependency: the engine knows
  nothing about OCR.

Engine contract (`integrations.ocr.endpoint` setting, empty by default):
`POST {operation, payload:{prescriptionId, attachmentId, fileName, mimeType}}`
→ `{ lines: [{ text: string, confidence: number (0–1) }] }`.

**Late-result guard:** engine results are applied only while the
prescription is still `EXTRACTING`. If a reviewer has already started
manual entry (which moves it to `REVIEW`), a late/retried result is ignored
and recorded on the timeline — human work is never overwritten.

If no endpoint is configured the operation fails/retries/dead-letters per
the standard and shows in the Integration Monitor — while the prescription
remains fully processable through **manual line entry** (review is
mandatory anyway per §17).

### I2 — Upload reuses the Attachments engine

No second file pipeline. Flow: `POST /ocr/prescriptions` (creates the
numbered shell) → `POST /attachments?entityType=prescription&entityId=…`
(existing engine: type/size limits, audit) → `POST /ocr/prescriptions/:id/submit`
(validates an attachment exists, enqueues extraction → `EXTRACTING`).

### I3 — Deterministic in-house matching with a transparent score

The blueprint requires matching against the Drug Master and a confidence
score, not a specific algorithm. Matching is deterministic and explainable —
each extracted line is normalized and tried against `nameEn`/`nameAr`/
`brand` in order: exact (score **1.0**) → starts-with (**0.9**) → contains
(**0.7**) → longest-token ≥4 chars contains (**0.5**) → no match (0, line
left unmatched for the reviewer). `engineConfidence` (what the OCR engine
reported) and `matchScore` (how sure the master match is) are stored and
shown separately; lines where either falls below `ocr.review.min_confidence`
are flagged low-confidence in the UI. Fuzzy/AI matching is a §23 "AI"
upgrade behind the same interface.

### I4 — No auto-approval (§17 closing rule)

There is deliberately **no** code path that confirms a prescription without
a human: every prescription must be confirmed line-by-line by an
`ocr.review` holder, whatever the scores say. Confirm/reject/correct are
audited and timeline-recorded; the reviewer and time are stored on the
record.

### I5 — Availability + alternatives from the DIC master

`فحص التوافر` and `اقتراح البدائل` read the §15 data already in the
platform: the matched drug's per-city availability JSON and its
`DrugAlternative` links (joined to live drugs). No new stock source; live
per-branch stock stays the §21 DBS integration (Later).

### I6 — Linking to order/ticket links existing records

`ربط النتيجة بطلب أو Ticket`: at confirm time the reviewer may pass an
existing **ticket number** and/or an **order number**. The prescription
stores both; a linked ticket gets a timeline event pointing back. Creating
new tickets/orders remains the job of the ticketing/online modules — OCR
links, it does not duplicate their flows.

### I7 — Numbering

`PRX-{YYYY}-{SEQ:6}` via the existing NumberingService, format from setting
`ocr.number.format` (ADR-008).

### I8 — Permissions

Three keys (contracts → 51): `ocr.upload` (create + submit), `ocr.view`
(see prescriptions, scope-aware: MY_RECORDS = own uploads), `ocr.review`
(correct/add/reject lines, confirm/reject prescription). Grants: AGENT
upload+view MY_RECORDS; SUPERVISOR view MY_TEAM; TEAM_MANAGER view+review
DEPARTMENT; BEM view+review ALL; INTEGRATION_SUPPORT view ALL; admins ALL.

## 3. Data model

```
Prescription    id, number (unique), status UPLOADED→EXTRACTING→REVIEW→CONFIRMED|REJECTED,
                attachmentId?, uploadedById, reviewedById?, reviewedAt?,
                ticketId?, relatedOrderNo?, note?, engineMeta Json?
PrescriptionLine id, prescriptionId (cascade), lineNo (unique per rx), rawText,
                engineConfidence?, matchScore?, matchedDrugId?,
                status SUGGESTED|CONFIRMED|CORRECTED|REJECTED
```

`CORRECTED` = reviewer changed the matched drug (or set one on an unmatched
line) before confirming — kept distinct from `CONFIRMED` so match quality
can be measured later (§12 source for an OCR accuracy metric).

## 4. API surface

| Route                                 | Permission | Purpose                                              |
| ------------------------------------- | ---------- | ---------------------------------------------------- |
| `POST /ocr/prescriptions`             | ocr.upload | Create numbered shell                                |
| `POST /ocr/prescriptions/:id/submit`  | ocr.upload | Validate attachment, enqueue `ocr.extract`           |
| `GET /ocr/prescriptions`              | ocr.view   | List (status filter; MY_RECORDS scope = own)         |
| `GET /ocr/prescriptions/:id`          | ocr.view   | Detail: lines + matched drug + availability + alts   |
| `POST /ocr/prescriptions/:id/lines`   | ocr.review | Manual line entry (moves EXTRACTING/UPLOADED→REVIEW) |
| `POST /ocr/lines/:lineId/decide`      | ocr.review | Confirm / correct / reject one line                  |
| `POST /ocr/prescriptions/:id/confirm` | ocr.review | Confirm (optional ticketNo/orderNo link)             |
| `POST /ocr/prescriptions/:id/reject`  | ocr.review | Reject with note                                     |

## 5. Settings (ADR-008)

| Key                         | Default              | Meaning                                     |
| --------------------------- | -------------------- | ------------------------------------------- |
| `integrations.ocr.endpoint` | `''`                 | External OCR engine URL (§21)               |
| `ocr.number.format`         | `PRX-{YYYY}-{SEQ:6}` | Prescription numbering                      |
| `ocr.review.min_confidence` | `0.6`                | Below this a line is flagged low-confidence |

## 6. Out of scope (this phase)

Live per-branch stock (DBS §21), AI/fuzzy matching (§23 AI), customer-facing
upload, auto-creation of orders/tickets from prescriptions, handwriting
model choice (engine-side concern behind the endpoint).
