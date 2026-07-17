# United Pharmacy Center — DIC — Module Specification v1.0

Source: blueprint §15 (15.1 البحث, 15.2 بيانات الدواء, 15.3 Insurance
Mapping). Module scope per §5 table: **United Pharmacy Center = DIC, Drug
Search, Mapping, Insurance Coverage, Alternatives**. Drug is a §18 master
business object.

Reference import file: `Mapping_V311_updated2.xlsx` — the company's real
drug mapping (Sheet1: 22,732 items; Sheet2: 306 Hospital-at-Home items).
Profile: 0 duplicate materials, 7,735 SFDA-coded, 3,117 Meena-covered,
3,780 Tawuniya-covered, 87 Raqeeb, 3,576 with alternatives, 44 without an
Arabic name.

Open points are flagged as assumptions H1–H8.

## 1. Blueprint requirements (verbatim mapping)

| §15 item                                                | Delivered as                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 15.1 General/Brand/Ingredient/SAP/Arabic/English search | `GET /dic/search?q=&field=` over the drug master                             |
| 15.1 Partial + Wildcard `*` + Auto-complete             | Contains-match by default; `*` → SQL `%`; same endpoint drives the typeahead |
| 15.2 Coded / Not Coded                                  | Derived: SFDA code present (H4)                                              |
| 15.2 Normal / Special / Raqeeb                          | `DrugItemType` catalog (feed values incl. Hospital At Home) + `raqeeb` flag  |
| 15.2 Price                                              | RSP + RSP-with-tax from the feed                                             |
| 15.2 Active Ingredient / Usage / Offers                 | Editable master fields (not in the feed, H5) — changed via approval (15.3)   |
| 15.2 Availability                                       | Per-city stock snapshot from the feed's city columns (H6)                    |
| 15.2 Alternatives                                       | `DrugAlternative` rows from Mapped Product 1–22                              |
| 15.2 Cross-Selling Products                             | From the feed's Combined Products column (H7)                                |
| 15.3 Meena / Tawuniya / BUPA / Additional               | `InsuranceCompany` catalog (3 seeded, extensible) + `DrugCoverage` rows      |
| 15.3 Bulk Import + Coverage Mapping                     | Master import maps Meena/Tawuniya columns; per-company coverage bulk import  |
| 15.3 Approval Workflow for Master Data Changes          | `DrugChangeRequest` PENDING → APPROVED/REJECTED (H8)                         |

## 2. Design decisions

### H1 — Drug master + Mapping file as canonical format

Same G2/G3 doctrine as branches: the real Mapping export is the canonical
feed; import is a **master-data upsert by Material number**. Sheet2
(Hospital At Home) uses the same importer with its reduced columns.

### H2 — Chunked import, no full-file dry-run

22,732 rows ≈ tens of MB as JSON — a single request (and a full dry-run
round-trip) is the wrong shape. The browser parses the sheet and streams
**chunks of 2,000 rows**; each chunk is validated server-side and answered
with created/updated/invalid + quality counts which the UI accumulates into
a live progress report. Bulk-write strategy per chunk: one lookup query,
`createMany` for new rows, per-row updates only for existing ones,
delete+`createMany` for alternatives/coverage — import of the full real file
stays in tens of seconds.

### H3 — Insurance coverage model (15.3)

`InsuranceCompany` catalog seeded MEENA / TAWUNIYA / BUPA (additional
companies are inserts). `DrugCoverage(drugId, companyKey, covered, note?)`.
The master import fills MEENA (Meena Coverage column) and TAWUNIYA
(Med. Coverage `Taw.Covered`); any company's mapping can be replaced by the
dedicated coverage bulk import (rows: Material, Covered) — BUPA's file lands
there when it exists.

### H4 — "Coded / Not Coded"

Interpreted as SFDA coding: `coded = SFDA CODE present` (7,735 of the real
file). Stored explicitly so a future rule change is one backfill.

### H5 — Active Ingredient / Usage / Offers are editable master fields

The feed has none of them, yet §15.1 searches by Active Ingredient and
§15.2 displays all three. They are nullable columns maintained inside the
platform by pharmacists — every edit passes the 15.3 approval workflow (H8).
Missing values are a data-quality count, never a blocker.

### H6 — Availability snapshot as JSON

The feed carries ~70 per-city stock columns (sparsely filled). Stored as a
`{city: qty}` JSON snapshot per drug — display-grade per §15.2, refreshed on
each import. A normalized stock table (1.6M rows) buys nothing until live
DBS integration (§21) lands.

### H7 — Alternatives vs Cross-Selling

Mapped Product 1–22 → Alternatives (ordered). Combined Products →
Cross-Selling. In the current file the two largely coincide; both are
stored separately so the feeds can diverge without schema change.

### H8 — Approval workflow scope

Single-drug edits (active ingredient, usage, offers, coverage toggle)
create a `DrugChangeRequest` holding the proposed patch; `dic.approve`
holders approve (patch applied atomically) or reject with a note. Bulk
imports by `dic.manage` are the sanctioned master feed and apply directly —
the workflow governs human edits, not the feed. Timeline + audit on both.

## 3. Data model

```
Drug               materialNo (unique), oldMaterialNo?, ean?, gtin?, sfdaCode?,
                   coded, nameEn, nameAr?, brand?, division?, category?,
                   subCategory?, className?, subClassName?, price?, priceWithTax?,
                   itemTypeKey? → DrugItemType, raqeeb, acuteChronic?,
                   activeIngredient?, usage?, offers?, note?,
                   availability Json?   ({city: qty}, H6)
DrugItemType       key, nameAr, nameEn, active   (NORMAL/SPECIAL/HOSPITAL_AT_HOME seeded)
DrugAlternative    drugId, altMaterialNo, order      @@unique(drugId, altMaterialNo)
DrugCrossSell      drugId, materialNo                @@unique(drugId, materialNo)
InsuranceCompany   key, nameAr, nameEn, active   (MEENA/TAWUNIYA/BUPA seeded)
DrugCoverage       drugId, companyKey, covered, note? @@unique(drugId, companyKey)
DrugChangeRequest  drugId, patch Json, status PENDING|APPROVED|REJECTED,
                   requestedById, decidedById?, decisionNote?, timestamps
```

## 4. API surface

```
POST /dic/import                dic.manage    chunked master upsert (H2)
POST /dic/coverage/import      dic.manage    per-company coverage mapping (H3)
GET  /dic/search               dic.view      q, field=all|brand|ingredient|material|nameAr|nameEn,
                                             limit (autocomplete uses limit=8)
GET  /dic/drugs/:id            dic.view      full card: coverage, alternatives (joined),
                                             cross-sell, availability
POST /dic/drugs/:id/change-request   dic.view     propose edit (H5/H8)
GET  /dic/change-requests      dic.approve   pending queue
POST /dic/change-requests/:id/decide dic.approve  approve|reject (+note)
GET  /dic/catalogs             dic.view      item types + insurance companies
```

## 5. Permissions & settings

| Key           | Defaults                                                         |
| ------------- | ---------------------------------------------------------------- |
| `dic.view`    | All staff roles (search & card are daily pharmacist tools)       |
| `dic.manage`  | TEAM_MANAGER DEPARTMENT, INTEGRATION_SUPPORT ALL, admins         |
| `dic.approve` | TEAM_MANAGER DEPARTMENT, BUSINESS_EXCELLENCE_MANAGER ALL, admins |

Setting: `dic.import.chunk_size` (NUMBER, 2000) — client chunking hint.

## 6. Out of scope (explicitly)

Live DBS availability integration (§21 — the JSON snapshot is its landing
zone), offers engine (the field is display text until a promotions module is
approved), prescription OCR (§17), drug interactions/clinical content (not
in §15).
