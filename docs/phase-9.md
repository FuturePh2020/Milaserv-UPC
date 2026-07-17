# Phase 9 — United Pharmacy Center: DIC (Acceptance Record)

Implements `docs/specs/dic-spec-v1.0.md` (blueprint §15).
Assumptions H1–H8 applied as flagged. UAT ran against the company's **real
Mapping_V311_updated2.xlsx** (Sheet1 22,732 rows + Sheet2 306 Hospital-At-Home
rows → 23,024 drugs imported).

| Area                  | Delivered                                                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drug Master (H1)      | Mapping export as canonical format, keyed by Material number; all sheets read (Sheet2's reduced CODE/NAME layout folds in); monthly re-import updates in place — never duplicates                                                                                            |
| Chunked import (H2)   | Browser parses the 11 MB workbook; rows upload in chunks of `dic.import.chunk_size` (2000 → 12 calls for the real file) with a cumulative progress bar; per-row rejections (4 in the real file) + §26 quality flags (346 missing Arabic name, 15,299 not coded) never silent |
| Coded / SFDA (H4)     | `coded` = SFDA code present — 7,735 coded in the real file, shown as Coded/Not-coded badges (§15.2)                                                                                                                                                                          |
| Coverage (H3)         | Meena + Tawuniya flags come from the master feed (3,117 / 3,780 covered); other insurers via per-company bulk import (`POST /dic/coverage/import`) with unknown-material rejection — demoed with a BUPA file (3 applied, 1 rejected)                                         |
| Search (§15.1)        | Field filters (all/brand/ingredient/material/nameAr/nameEn), partial contains, `*` wildcard (ILIKE), auto-complete via the same endpoint with a small limit; Arabic and English                                                                                              |
| Drug card (§15.2)     | Price ± tax, item type, coded, Raqeeb, acute/chronic, insurance coverage per company, editable H5 fields, availability by city (H6 — sparse columns → `{city: qty}` JSON), alternatives (Mapped Product 1–22, ordered) vs cross-sell (Combined Products) as clickable links  |
| Approvals (H8, §15.3) | Human edits to activeIngredient/usage/offers/note (+ coverage) go through `DrugChangeRequest`: propose (dic.view) → queue (dic.approve) → approve applies patch transactionally / reject leaves master untouched; timeline + audit + requester notification                  |
| Frontend              | `/dic` page: search + auto-complete, drug card, propose-change dialog, approvals tab, chunked master import with progress, coverage import; sidebar entry behind `dic.view`; bilingual (RTL verified)                                                                        |

Out of scope (per spec §6): live per-branch stock integration (§21 Later —
availability refreshes with the monthly file), OCR of prescriptions (§17),
customer-facing DIC.

## Definition of Done (§24)

- [x] Business rules documented — spec + this record
- [x] UI + API implemented; migration `dic_drug_master`; §15 catalogs (3 item types, 3 insurance companies) + `dic.import.chunk_size` setting
- [x] Permissions (`dic.view` / `dic.manage` / `dic.approve`) + audit on imports and decisions; §26 quality flags always reported
- [x] Tests — dic suite 9 e2e tests (DI-1..DI-9); full regression **136/136** across 15 suites (green with the real 23k-drug master loaded)
- [x] UAT walkthrough — Chromium 11/11 **with the real Mapping file**: both sheets parsed (23,038 rows) → 12-chunk import (23,024 created / 10 updated / 4 invalid, quality flags shown) → Arabic partial search → wildcard `Panadol*Extend*` → drug card with coverage, 9 alternatives, 9 cross-sells → change request → approve (patch applied to master) → BUPA coverage import → Arabic RTL card
- [x] Docs updated; rollback = revert commits + `dic_drug_master` migration

Remaining blueprint scope (§23 "Later"): OCR (§17), physical integrations
(§21), AI features.
