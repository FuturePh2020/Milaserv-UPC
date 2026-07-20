# CR-001 — Sprint OCR-02 (Acceptance Record)

Implements Sprint OCR-02 — "Milaserv360 OCR Phase 2: Image Processing &
Quality Engine" — the next slice of
`docs/change-requests/CR-001-prescription-intelligence-engine.md`. Builds
a real, enterprise-grade image-preprocessing pipeline that runs before
OCR text extraction; no OCR text recognition ships in this sprint (that's
OCR-03, using the OCR-ready images this sprint produces). Sprint OCR-01
is untouched in behavior: the same upload → submit → status flow, the
same coarse pre-preprocessing quality gate, the same mocked text
extraction, and the same mandatory-review safety rule all still hold —
full regression proves it.

| Area                    | Delivered                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18-step pipeline        | Real OpenCV/Pillow/PyMuPDF processors — validation, blur, brightness, contrast, noise, orientation, auto-rotation, perspective correction, edge detection, auto-crop, background cleanup, shadow removal, contrast enhancement, sharpening, grayscale, binarization — each independently toggleable via `prescriptions.preprocessing.enabled_processors` |
| Quality score           | 0-100 weighted aggregate (resolution/blur/brightness/contrast/noise/rotation/crop/readable-area, renormalized around whichever processors are enabled) → Excellent/Good/Fair/Poor/Re-upload-Required bands, gated by the configurable `MIN_QUALITY_SCORE`                                                                                                |
| Schema                  | Additive `PrescriptionPage` fields (blurScore, brightnessScore, contrastScore, noiseScore, rotationAngle, cropConfidence, preprocessingVersion, preprocessingDuration, finalQualityScore, qualityStatus, start/complete timestamps) + new `PrescriptionPageImageVersion` table — one migration, zero changes to OCR-01 columns                           |
| Image versions          | Original (never overwritten) / Rotated / Cropped / Enhanced / OCR-ready, each a real stored object with a short-TTL signed URL                                                                                                                                                                                                                           |
| API                     | `GET /prescriptions/:id/images`, `GET /prescriptions/:id/quality`, `GET /prescriptions/:id/preprocessing` — same `ocr.view` permission as every other prescriptions route                                                                                                                                                                                |
| Frontend                | `/prescriptions/:id` image-inspection page — quality score/status, blur/brightness/contrast/noise bars, rotation angle, crop confidence, a version picker, and side-by-side Original/Processed comparison — Arabic (RTL) and English (LTR) both verified live in a browser                                                                               |
| Configuration (ADR-008) | `MIN_IMAGE_WIDTH/HEIGHT`, `MIN_QUALITY_SCORE`, `MAX_ROTATION`, `MIN_CONTRAST`, `MAX_NOISE`, per-processor enable flags, and a pipeline version tag — all in Settings, all passed to Python per-call (it holds no Settings/DB access), none hard-coded                                                                                                    |
| Worker workflow         | `PREPROCESSING` → (engine runs) → `READY_FOR_OCR` (new transient status) → OCR-01's existing `EXTRACTING_TEXT` stage, unchanged. Below-threshold quality still routes to `IMAGE_REUPLOAD_REQUIRED` and the prescription still reaches `REVIEW`                                                                                                           |
| Logging                 | Per-stage timings, total duration, quality score, and processor failures logged (`Logger.log`) and, when failures occur, also written to the timeline for the `GET .../preprocessing` endpoint to surface                                                                                                                                                |
| Multi-page PDF          | Python rasterizes every page and reports per-page metrics; Sprint OCR-01's one-file-one-`PrescriptionPage` model is preserved as-is (page 1's versions/metrics are what gets persisted) — see "Deliberately out of scope" below                                                                                                                          |

## Definition of Done

- [x] Business rules documented — this record; schema is additive-only;
      no changes to OCR-01's permission keys or its existing behavior
- [x] Tests:
  - `services/ocr-service/tests/test_preprocessing.py` — 12 pytest cases: sharp/blurry, rotated, dark, bright, noisy, cropped-scene (auto-crop/perspective), low-resolution, multi-page PDF (3 pages), below-threshold → `REUPLOAD_REQUIRED`, disabled-processor skipping, and processor-timing/no-failures on a clean image
  - `services/ocr-service/tests/test_pipeline.py` — updated (the Sprint OCR-01 mock-passthrough test it covered no longer exists; nothing else in that file depended on it)
  - `apps/api/test/prescriptions.e2e-spec.ts` — 4 new cases (PX-11..PX-14): scores/versions persisted and exposed by all three new endpoints, the preprocessing engine's own quality gate routing to `IMAGE_REUPLOAD_REQUIRED`, every configurable threshold actually reaching the engine (captured request body), and permission gating on the new routes
  - Full regression: **19/19 suites, 173/173 tests** (was 169 before this sprint; +4 e2e here); Python: **20/20** (was 9, +11 net after replacing the obsolete OCR-01 passthrough test); unit: **11/11** unchanged
- [x] `tsc --noEmit`, `eslint`, and `prettier --check` clean on every touched TypeScript/TSX/JSON file
- [x] Manual, live, end-to-end verification against real Postgres/Redis/BullMQ/uvicorn/Next.js — upload → submit → real 18-step pipeline → all three new endpoints → real signed-URL image bytes fetched and decoded as valid PNGs, all confirmed via curl
- [x] UAT walkthrough — Chromium via Playwright: logged in, navigated to `/prescriptions/:id`, confirmed quality score/status, all four indicator bars, rotation angle, crop confidence, and a working side-by-side Original/Processed comparison with a live version-switcher, in both Arabic (RTL) and English (LTR)
- [x] A real bug was found and fixed during that walkthrough: Helmet's default `Cross-Origin-Resource-Policy: same-origin` blocked the frontend (a different origin in dev) from loading the signed image URLs in `<img>` tags. Fixed narrowly — `Cross-Origin-Resource-Policy: cross-origin` is now set only on the local-disk file-serving route, whose own HMAC-signed short-TTL token is the real access control (the same trust model a real S3 presigned URL carries, which has no such restriction either)
- [x] Docker — `docker compose config` validates the compose file (syntax and variable interpolation both correct) and the Dockerfile installs `libglib2.0-0`/`libgl1` for `opencv-python-headless`; a live `docker build`/`up` could not be exercised in this sandbox (no Docker daemon available — confirmed via `docker info`/`docker build`, an environment limitation, not a code issue)
- [x] No existing functionality broken — every OCR-01 test (PX-1..PX-10) still passes unmodified in behavior; the only OCR-01 file touched for compatibility was the e2e stub's `/v1/preprocess` handler, extended to serve the new contract while every other stub route (and every scripted OCR-01 scenario) is untouched
- [x] Docs updated; rollback = revert commits (schema changes are additive, nothing removed from OCR-01)

## Deliberately out of scope (Sprint OCR-02)

- **Real OCR text recognition** — explicitly excluded by the sprint brief; the mock text-extraction stage from OCR-01 still runs unchanged. Sprint OCR-03 integrates PaddleOCR using the OCR-ready images this sprint produces.
- **Splitting a multi-page PDF into multiple `PrescriptionPage` records** — that is an upload/data-model change (Sprint OCR-01's contract is one uploaded file = one page), not a preprocessing change. The engine analyzes every PDF page for quality purposes and reports all of them, but only page 1's versions/metrics are persisted against the existing `PrescriptionPage` row.
- **A prescriptions list/upload frontend screen** — not requested by this sprint (only "an image inspection page"); the new page is reached by direct navigation to `/prescriptions/:id` for now. A list/queue entry point belongs to a later sprint's explicit screen list.
- **Live `docker compose up` verification** — no Docker daemon in this sandbox; `docker compose config` and Dockerfile review are the closest available substitute, documented above rather than glossed over.

## Infra note (this session, continued from OCR-01)

Postgres and Redis both dropped again mid-session (twice), independent of
any code change here. Same recovery as documented in the OCR-01
acceptance record:

```
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/milaserv -l /tmp/postgres.log -o "-p 5432" start
redis-server --port 6379 --daemonize yes --logfile /tmp/redis-server.log
```
