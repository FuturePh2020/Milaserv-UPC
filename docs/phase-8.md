# Phase 8 — Branch Center (Acceptance Record)

Implements `docs/specs/branch-center-spec-v1.0.md` (blueprint §16).
Assumptions G1–G6 applied as flagged. UAT ran against the company's **real
United_Locations_June_2026.xlsx** (608 rows → 529 branches imported).

| Area                       | Delivered                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch Master (§16.1)      | Phase-2 branch row extended in place (G1): bilingual addresses, district/region/postal, coordinates, map link, 3 phones, type, delivery coverage, working hours (G6), duty pharmacist, district manager                                                                                    |
| Types (§16.2)              | `BranchType` catalog verbatim; real feed values map as data (G4) — the actual file produced **0 unmapped types**                                                                                                                                                                           |
| Import (G2/G3)             | United Locations export as canonical format; browser-parsed, server-validated preview (created/updated forecast + §26 quality flags: 7 missing location, 1 missing supervisor in the real file); master-data upsert by code so monthly re-imports refresh §9.8 supervisor mapping in place |
| Locator (§16.3)            | `GET /branches/nearest` — Haversine ranking of active located branches; Google Maps stays the §21 Later upgrade behind the same endpoint                                                                                                                                                   |
| Delivery Estimator (§16.3) | ETA = base + km × factor (settings, G5) gated by coverage, range, and working hours — ineligible branches carry NOT_COVERED / OUT_OF_RANGE / CLOSED reasons instead of disappearing                                                                                                        |
| Frontend                   | Admin Branches: import dialog with forecast + quality badges, region/type columns; **Branch Locator** page (coordinates or browser geolocation → ranked cards with distance, open state, ETA, map link); bilingual                                                                         |
| Fix                        | API JSON body limit raised to 5 MB — the 100 kb express default rejected real master files                                                                                                                                                                                                 |

Out of scope (per spec §6): Google Maps integration, live operational
capacity, customer-facing locator, per-day working-hours editor UI.

## Definition of Done (§24)

- [x] Business rules documented — spec + this record
- [x] UI + API implemented; migration `branch_center`; §16.2 catalog + 4 settings
- [x] Permissions (`branch.view` / `branch.manage`) + audit on imports; §26 quality flags always reported
- [x] Tests — branch-center suite 9 e2e tests; full regression 127/127 green
- [x] UAT walkthrough — Chromium 7/7 **with the real 608-row file**: parse → preview (529 valid / 79 code-less rows rejected, quality flags shown) → import; master list shows region/type; locator from central Jeddah returns the real nearest five branches with ETAs
- [x] Docs updated; rollback = revert commits + `branch_center` migration

Remaining blueprint scope (§23 "Later"): United Pharmacy Center DIC (§15),
OCR (§17), physical integrations (§21), AI features.
