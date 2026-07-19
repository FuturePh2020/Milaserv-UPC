# CR-001 — Sprint OCR-02 Extension (Acceptance Record)

Extends Sprint OCR-02 with **universal image intake and drag-and-drop
upload** — accepting not just clean scans but WhatsApp screenshots, phone
photos, cropped images, and clipboard pastes, detecting the probable
prescription region inside them, and letting a human confirm or correct
that region before the 18-step preprocessing pipeline runs. No OCR text
recognition and no final drug matching ship in this Extension — both stay
deferred to their own sprints. Sprint OCR-01/02 are untouched in behavior:
full regression proves it.

| Area                        | Delivered                                                                                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region-detection engine      | New `services/ocr-service/app/region_detection/` — contour analysis (Canny + dilation + `findContours`), proportional/resolution-independent heuristics (no fixed pixel coordinates anywhere), IoU-based dedup, weighted region scoring (area/rectangularity/content-density/position) |
| Screenshot detection         | Weighted score (aspect-ratio plausibility, top/bottom chrome-band detection via variance **and** color-distance from the image's own content, camera-EXIF absence) — a scanned A4/Letter page's blank margin is correctly *not* mistaken for a status bar |
| WhatsApp hint                | Secondary-only signal (color-band match against known WhatsApp brand colors, light/dark mode, old/new palette) — only consulted once `screenshot_detected` is already true, per the design doc's explicit "generic detection first" rule                  |
| Multiple-region handling     | Every candidate region is persisted (new `PrescriptionRegion` table), never silently discarded; a human can select one, several (spawning sibling pages), or draw a manual override                                                                       |
| Schema                       | New `PrescriptionSourceType` enum + `PrescriptionPage` additions (sourceType, screenshotDetected, screenshotApplicationHint, detectedDocumentRegionJson, regionDetectionConfidence, manualCropRequired, manualCropJson, clipboardPasted, originalWidth/Height, selectedRegionIndex) + new `PrescriptionRegion` table — one migration, zero changes to OCR-01/02 columns |
| Backend upload flow          | `uploadPage()` now runs region detection synchronously at upload time (before preprocessing is ever queued): validate → duplicate-detect → store original → detect source type/screenshot/region → persist page + all candidate regions → auto-accept a confident crop or defer to a human |
| Crop confirmation API        | `POST /prescriptions/:id/pages/:pageId/crop` — confirms one or more detected regions (extra ones spawn sibling pages) or a manual override box; `GET /prescriptions/:id/pages/:pageId/original` — the raw upload, fetchable before preprocessing has run |
| Manual-crop-required gating  | `submit()` only enqueues pages that don't need a crop confirmed; a degenerate "every page needs a crop" prescription still reaches `REVIEW` promptly instead of hanging in `EXTRACTING` forever (`finalizePrescriptionIfDone` treats "awaiting crop" as resolved-for-now) |
| DropZone component           | New `apps/web/src/components/DropZone.tsx` — domain-agnostic, reusable: drag/drop, click-to-browse, camera capture, clipboard paste, real upload progress + cancel (`XMLHttpRequest`), client- and server-side duplicate flagging, retry, reorder, keyboard-accessible |
| Frontend intake              | `/prescriptions` (list), `/prescriptions/new` (create), and the extended `/prescriptions/:id` (upload section + per-page crop/region workspace + the existing OCR-02 quality inspector) — all inside the existing `(app)` shell, not a standalone page |
| Preview/crop workspace       | Original image, overlaid candidate regions (click to select, multi-select), draw-your-own manual box, zoom, a visual-only rotate aid, reset, confirm — Arabic (RTL) and English (LTR) both verified live in a browser                                     |
| Configuration (ADR-008)      | `prescriptions.region_detection.{enabled,min_confidence,min_region_area_ratio,max_candidates,screenshot_aspect_ratio_min/max,whatsapp_hint_enabled}` — all in Settings, all passed to Python per-call, none hard-coded                                     |

## Definition of Done

- [x] Business rules documented — this record; schema is additive-only; no
      changes to OCR-01/OCR-02 permission keys or existing behavior
- [x] Tests:
  - `services/ocr-service/tests/region_fixtures.py` + `test_region_detection.py` — 17 pytest cases against the real `/v1/detect-region` endpoint: Android/iPhone/dark-mode/light-mode WhatsApp screenshots, a generic status bar, chat bubbles, black borders, a single prescription image, multiple images, a cropped chat screenshot, a camera photo (real EXIF), a scanned image (correctly *not* flagged as a screenshot), a low-confidence blank image (falls back to manual crop), and the region-scoring/dedup helpers directly
  - `apps/api/test/prescriptions.e2e-spec.ts` — 6 new cases (PX-15..PX-20): sourceType/screenshot/clipboardPasted persisted on upload, a low-confidence region deferring to manual crop and the degenerate all-pages-need-crop case still reaching `REVIEW`, `confirmCrop`'s validation rules (exactly one of region-selection/manual-box, unknown index, already-confirmed page), multi-region selection spawning a sibling page, the new `/original` endpoint and its `ocr.view` gate, and — found via this test itself — concurrent multi-file uploads never colliding on `pageNumber`
  - Full regression: **19/19 suites, 179/179 tests** (was 173 before this Extension; +6 e2e here); Python: **37/37** (was 20, +17 region-detection); unit: **11/11** unchanged
- [x] `tsc --noEmit`, `eslint`, and `prettier --check` clean on every touched TypeScript/TSX/JSON file (API, web, and the new `DropZone`/crop-workspace components)
- [x] Manual, live, end-to-end verification against real Postgres/Redis/BullMQ/uvicorn/Next.js:
  - `curl`: created a prescription, uploaded a synthetic Android WhatsApp screenshot (auto-accepted crop, `sourceType=WHATSAPP_SCREENSHOT`) and a low-confidence blank image (`manualCropRequired=true`), confirmed the manual crop, submitted, and watched both pages reach `COMPLETED` with the WhatsApp page's OCR-ready image correctly excluding the chat chrome (859×1134 vs. the original 1080×2280)
  - Playwright (Chromium): logged in, drove the full `/prescriptions` → `/prescriptions/new` → upload → crop-workspace (drag-drawn manual box, zoom/rotate controls) → confirm → submit → `REVIEW` flow end to end, in both Arabic (RTL, default) and English (LTR) locales, with screenshots captured at each step
- [x] UAT walkthrough confirmed: empty/drag-active/uploading/duplicate/error/queued/manual-crop-required/completed page states all render correctly; the sidebar's new "Prescription Intake" entry is scope-gated by `ocr.view` exactly like every other module
- [x] A real bug was found and fixed during that walkthrough: `uploadPage()` computed the next `pageNumber` with a plain read-then-create, which is safe for one file at a time but races when `DropZone` fires one request per file in parallel (its whole point, for "drop multiple files") — concurrent uploads to a brand-new prescription collided on the `(prescriptionId, pageNumber)` unique constraint and the losing requests failed with a 500. Fixed with a small retry-on-conflict helper (`createPageWithNextNumber`, shared by `uploadPage()` and `confirmCrop()`'s sibling-page spawn loop) that re-reads the next number and retries on exactly that collision; verified with 5 genuinely concurrent uploads (`Promise.all`) landing on distinct pageNumbers 1-5, and covered by PX-20
- [x] Docker — `docker compose --env-file .env.example config` (both the default profile and `--profile app`, which includes `api`/`web`/`ocr-service`/`minio`) validates cleanly; no code in this Extension touched `docker-compose.yml` or either Dockerfile. A live `docker build`/`up` could not be exercised in this sandbox (no Docker daemon — confirmed via `docker info`, an environment limitation, not a code issue, same as OCR-01/OCR-02)
- [x] No existing functionality broken — every OCR-01 (PX-1..PX-10) and OCR-02 (PX-11..PX-14) test still passes unmodified in behavior; the only pre-existing file touched for compatibility was the e2e stub's script defaults, extended with a `/v1/detect-region` handler that defaults to an auto-accepted full-frame region so every prior test's auto-enqueue behavior is unchanged
- [x] Docs updated; rollback = revert commits (schema changes are additive, nothing removed from OCR-01/OCR-02)

## Deliberately out of scope (this Extension)

- **Final drug matching** — explicitly excluded by the brief; every candidate this pipeline creates still defaults to `NEEDS_PHARMACIST_REVIEW` (Sprint OCR-01's unchanged safety rule).
- **OCR text recognition** — still Sprint OCR-01's mock stage; unaffected by this Extension.
- **Rotation-aware crop-box math** — the crop workspace's rotate control is a genuine visual aid (lets a reviewer see if a photo is sideways) but region overlays and manual-box drawing are disabled while rotated, rather than inverse-transforming drag coordinates through a CSS rotation. A reviewer resets to 0° to select or draw a region. Not a spec requirement (only "rotate controls" was asked for), and avoids a real class of coordinate bugs for a first iteration.
- **Touch-drag crop drawing beyond basic support** — the crop workspace wires touch events through the same coordinate math as mouse drag, but has not been walked through on an actual touchscreen device (only Chromium/desktop, per this project's established live-verification pattern).
- **An automated frontend test suite** — this project has never had one (Phases 1-12 and OCR-01/02 all relied on live Playwright walkthroughs instead); this Extension follows the same established pattern rather than introducing new tooling.

## Test-scenario coverage (design doc's 20 named scenarios)

| # | Scenario                             | Covered by                                                                 |
| - | ------------------------------------- | --------------------------------------------------------------------------- |
| 1 | Android WhatsApp screenshot           | `test_region_detection.py::test_android_whatsapp_screenshot_is_detected`   |
| 2 | iPhone WhatsApp screenshot            | `test_region_detection.py::test_iphone_whatsapp_screenshot_is_detected`    |
| 3 | WhatsApp dark mode                    | `test_region_detection.py::test_whatsapp_dark_mode_screenshot_is_detected` |
| 4 | WhatsApp light mode                   | `test_region_detection.py::test_whatsapp_light_mode_screenshot_is_detected`|
| 5 | Screenshot with status bar            | `test_region_detection.py::test_generic_status_bar_is_detected_as_screenshot` |
| 6 | Screenshot with chat bubbles          | `test_region_detection.py::test_chat_bubbles_screenshot_is_detected`       |
| 7 | Screenshot with black borders         | `test_region_detection.py::test_black_border_screenshot_is_detected`       |
| 8 | Screenshot with one prescription image| `test_region_detection.py::test_single_image_screenshot_region_selected`   |
| 9 | Screenshot with multiple images       | `test_region_detection.py::test_multiple_images_screenshot_returns_candidates` |
| 10| Cropped screenshot                    | `test_region_detection.py::test_cropped_chat_screenshot_is_detected`       |
| 11| Camera photo                          | `test_region_detection.py::test_camera_photo_is_not_flagged_as_screenshot` |
| 12| Scanned image                         | `test_region_detection.py::test_scanned_image_is_not_flagged_as_screenshot`|
| 13| Clipboard-pasted image                | `prescriptions.e2e-spec.ts::PX-15` (`clipboardPasted` persisted end to end) |
| 14| Drag-drop single file                 | Live Playwright walkthrough (no automated FE suite — see above)            |
| 15| Drag-drop multiple files              | Live Playwright + `curl` concurrency test; regression-tested by `PX-20`    |
| 16| Invalid file type                     | `prescriptions.e2e-spec.ts::PX-3` (unchanged from OCR-01)                  |
| 17| Oversized file                        | `prescriptions.e2e-spec.ts::PX-3` (unchanged from OCR-01)                  |
| 18| Duplicate file                        | `prescriptions.e2e-spec.ts::PX-5` (unchanged from OCR-01, content-hash based) |
| 19| Manual crop correction                | `prescriptions.e2e-spec.ts::PX-16`, `PX-17`, `PX-18` + live Playwright draw-and-confirm |
| 20| Low-confidence region detection       | `test_region_detection.py::test_low_confidence_region_falls_back_to_manual_crop` + `PX-16` |

## Infra note (this session)

Postgres and Redis both dropped mid-session at least once, independent of
any code change here; same recovery as documented in the OCR-01/OCR-02
acceptance records. Separately, running the NestJS e2e suite while a
manually-started `npm run dev` API instance was still alive caused the two
processes' BullMQ workers to race on the same Redis-backed queue, making
the test run appear to hang indefinitely (it wasn't hung — Jest's own
"did not exit" open-handle warning after a real, fast pass was misread as
a freeze the first time, before the actual cause — a leftover dev-server
worker — was found and killed). Always stop any standalone `npm run dev`
against `apps/api` before running its e2e suite.
