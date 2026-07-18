# CR-001 — Sprint OCR-01 (Acceptance Record)

Implements Sprint OCR-01 of `docs/change-requests/CR-001-prescription-intelligence-engine.md`
(§10 sprint plan) — the approved starting slice of the Prescription
Intelligence Engine: database entities, upload API, secure file storage,
the OCR job queue, the prescription status workflow, a local OCR service
skeleton, and a mock OCR provider. Runs alongside the Phase 10 `/ocr/*`
module (untouched) until the OCR-12 migration/cutover.

| Area                | Delivered                                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema              | Additive-only extension of `Prescription` + 4 new tables (`PrescriptionPage`, `OCRTextBlock`, `PrescriptionDrugCandidate`, `OCRCorrection`, unused this sprint) — 2 migrations, zero changes to Phase 10 columns                                               |
| Upload API          | `POST /prescriptions`, `POST /prescriptions/:id/pages`, `POST /prescriptions/:id/submit`, `GET /prescriptions`, `GET /prescriptions/:id` — reuse `ocr.view`/`ocr.upload` permissions and the `ocr.number.format` sequence                                      |
| File validation     | Magic-byte sniffing (JPEG/PNG/PDF/WEBP), never trusts the declared MIME; size limit from Settings                                                                                                                                                              |
| Secure storage      | `PrescriptionStorageDriver` — local disk (HMAC-signed, short-TTL, `@Public()` download route) for dev/test, MinIO (real presigned URLs) for docker-compose/production, selected by `PRESCRIPTION_STORAGE_DRIVER`                                               |
| OCR job queue       | BullMQ, one job per page, configurable retry/backoff, `removeOnFail` retained 7 days as the dead-letter record                                                                                                                                                 |
| Pipeline worker     | Quality gate → preprocess → detect-and-recognize → medicine-line/candidate detection, each stage's status persisted on `PrescriptionPage`; exhausted retries mark the page `FAILED` and the prescription still reaches `REVIEW` — no outcome vanishes silently |
| Python OCR service  | Standalone FastAPI microservice (`services/ocr-service`) with a `Protocol`-based `OCRProvider` interface, a `ProviderRegistry` that enforces `is_local` (not just advisory), and a deterministic `MockOCRProvider`                                             |
| **Safety rule**     | No matching engine exists yet — every `PrescriptionDrugCandidate` the pipeline creates defaults to `NEEDS_PHARMACIST_REVIEW` with `matchedDrugId: null` and `matchConfidence: null`. This is the mandatory-review contract, not a gap.                         |
| Duplicate detection | `contentHash` (sha256) flags a possible duplicate across prescriptions; upload still succeeds — flagged, never silently blocked, decision left to the pharmacist                                                                                               |

## Definition of Done

- [x] Business rules documented — `docs/change-requests/CR-001-prescription-intelligence-engine.md`
      (design, approved) + this record; schema is additive-only; no
      changes to existing Phase 9/10 permission keys
- [x] Tests:
  - `apps/api/src/modules/prescriptions/file-validation.spec.ts` — 11 unit tests (magic-byte sniffing, size limit, allowlist)
  - `apps/api/test/prescriptions.e2e-spec.ts` — 10 e2e tests (PX-1..PX-10: numbering, auth, upload validation, full happy-path pipeline with the mandatory-review safety rule, duplicate flagging, poor-quality → reupload-required, empty OCR result, scope-aware listing, retry-exhaustion → FAILED → still reaches REVIEW, signed-URL byte-correctness + tamper/expiry rejection)
  - `services/ocr-service/tests/test_pipeline.py` — 9 pytest cases (quality gate, deterministic fixtures, candidate filtering)
  - Full regression: **19/19 suites, 169/169 tests** (was 18/159 before this sprint; +1 suite/+10 tests here)
- [x] `tsc --noEmit`, `eslint`, and `prettier --check` all clean on every touched file
- [x] Manual, live, end-to-end verification performed against real Postgres/Redis/BullMQ/uvicorn (not just automated tests) before the automated suite was written — numbering-sequence reuse, validation accept/reject paths, quality-gate pass-through, the mandatory-review safety default, audit/timeline/notification side effects, and signed-URL tamper rejection all confirmed via curl
- [x] Docs updated; rollback = revert commits (schema changes are additive, nothing removed from Phase 10)

## Deliberately out of scope (Sprint OCR-01)

Per the approved design's own gate — "do not start real drug matching
until Sprint OCR-01 is fully runnable and tested" — the following
requirements from the original request are **not** covered by this
sprint's tests, because the systems they depend on don't exist yet:

- Arabic/English trade-name, scientific-name, and abbreviation matching (matching engine — Sprint OCR-05/06)
- Spelling-error and OCR-character-mistake tolerance (matching engine)
- Strength/dosage-form extraction accuracy (real CV/OCR — Sprint OCR-02/03)
- Multiple-similar-medicines disambiguation and confidence scoring (Sprint OCR-07)
- Pharmacist correction workflow and alias learning (Sprint OCR-08/09)
- Availability/alternatives integration (Sprint OCR-10/11)
- Real (non-mock) OCR providers — PaddleOCR/Tesseract (Sprint OCR-02/03)

These are tracked in the design doc's §10 sprint table and require
explicit approval to begin, consistent with this project's standing
incremental-delivery rule.

## Infra note (this session)

The sandbox's Postgres and Redis processes are not supervised — they do
not restart automatically after a container idle/reclaim cycle. Both were
found down mid-session (unrelated to this sprint's code) and were
restarted manually; the Redis instance also needed no requirepass
(ioredis tolerates a configured-but-unrequired password with a harmless
warning). If a future session hits `ECONNREFUSED` on 5432/6379 before
running tests, restart both:

```
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/milaserv -l /tmp/postgres.log -o "-p 5432" start
redis-server --port 6379 --daemonize yes --logfile /tmp/redis-server.log
```
