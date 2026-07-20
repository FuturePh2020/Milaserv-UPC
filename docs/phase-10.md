# Phase 10 — OCR Prescription Processing (Acceptance Record)

Implements `docs/specs/ocr-spec-v1.0.md` (blueprint §17 + §21 OCR
integration). Assumptions I1–I8 applied as flagged. UAT ran end-to-end
against a **stub OCR engine speaking the I1 contract**, matching against the
real 23k-drug master imported in Phase 9.

| Area                     | Delivered                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload (§17.1)           | `Prescription` shell with `PRX-{YYYY}-{SEQ:6}` numbering → image/PDF via the existing Attachments engine (I2) → submit                                                                                                                            |
| Extraction (§17.2, §21)  | `ocr.extract` operation through the Integration Engine — timeout, exponential retry, dead-letter + admin alert, and Integration Monitor all apply (I1); executor extended to capture response bodies and dispatch per-key success handlers        |
| Matching (§17.3)         | Deterministic drug-master matcher: exact 1.0 / starts-with 0.9 / contains 0.7 / longest-token 0.5 (I3)                                                                                                                                            |
| Confidence (§17.4)       | Engine confidence (clamped 0–1) and match score stored and shown separately per line; below `ocr.review.min_confidence` renders amber                                                                                                             |
| Human review (§17.5)     | REVIEW stage behind `ocr.review`: confirm / correct (via §15.1 DIC search) / reject per line, manual line entry; late/retried engine results never overwrite human work (I1 guard, timeline-recorded)                                             |
| Availability (§17.6)     | Matched drug's per-city availability from the §15 master (I5)                                                                                                                                                                                     |
| Alternatives (§17.7)     | Matched drug's `DrugAlternative` links joined to live drugs (I5)                                                                                                                                                                                  |
| Linking (§17.8)          | Confirm optionally links an existing ticket number (validated, cross-timeline event) and/or order number — OCR never creates tickets/orders (I6)                                                                                                  |
| No auto-approval (§17.9) | No code path confirms without a human: confirm requires `ocr.review`, every line decided, ≥1 accepted line; reviewer + time recorded; all actions audited (I4)                                                                                    |
| Frontend                 | `/ocr` page: upload dialog (create→attach→submit), live list with status filter, review panel with confidence badges/availability/alternatives, correction picker on DIC search, confirm/reject dialogs; sidebar behind `ocr.view`; bilingual RTL |

Out of scope (per spec §6): live per-branch stock (DBS §21), AI/fuzzy
matching (§23 AI — same interface), customer-facing upload, auto-creation
of orders/tickets, engine/handwriting model choice.

## Definition of Done (§24)

- [x] Business rules documented — spec + this record
- [x] UI + API implemented; migration `ocr_prescriptions`; settings `integrations.ocr.endpoint`, `ocr.number.format`, `ocr.review.min_confidence`
- [x] Permissions (`ocr.view` / `ocr.upload` / `ocr.review`, contracts → 51) with scope-aware listing; audit + timeline on create/submit/extract/line decisions/confirm/reject; notifications to the uploader
- [x] Tests — ocr suite 9 e2e tests (OC-1..OC-9) incl. an HTTP stub engine; full regression **145/145** across 16 suites
- [x] UAT walkthrough — Chromium 10/10: upload demo scan → extraction via the Integration Engine sweep against the stub engine → three lines matched against the **real drug master** (Panadol Extend exact 100%, Adol 500 starts-with 90%, illegible line flagged at OCR 31%) → reviewer confirms / corrects via DIC search (Fevadol) / rejects → confirm with order link → CONFIRMED; Arabic RTL verified
- [x] Docs updated; rollback = revert commits + `ocr_prescriptions` migration

Remaining blueprint scope (§23 "Later"): physical integrations (§21 —
Yeastar, Ordering, DBS, Email/SMS, Google Maps connectors against the
already-built Integration Engine), AI features.
