# Branch Center — Module Specification v1.0

Source: blueprint §16 (16.1 Branch Master, 16.2 أنواع الفروع, 16.3 Locator &
Delivery Estimator). Module scope per §5 table: **Branch Center = Branch
Database, Supervisor Mapping, Locator readiness**. This extends the minimal
branch directory shipped in Phase 2 (ticketing spec §2) into the §18 Branch
master record — the same rows already feeding §9.8 supervisor auto-mapping.

Reference import file: `United_Locations_June_2026.xlsx` (608 branches) —
the company's real locations export, provided as the canonical feed.

Open points are flagged as assumptions G1–G6.

## 1. Blueprint requirements (verbatim mapping)

| §16 item                       | Delivered as                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16.1 Branch Master (15 fields) | `Branch` model extended: address (ar/en), city, district, region, postal code, lat/lng, phones, type, working hours, duty pharmacist, supervisor + email + phone, area manager, status |
| 16.2 Branch types              | `BranchType` catalog seeded verbatim: Online Store / Dark Store / Offline Branch / Raqeeb Branch                                                                                       |
| 16.3 Locator                   | `GET /branches/nearest?lat&lng` — Haversine distance, nearest N active branches                                                                                                        |
| 16.3 Delivery Estimator        | Per-branch ETA from fulfillment location + distance + working hours + coverage + settings-driven constraints (G5)                                                                      |
| §9.8 Supervisor Mapping        | Already live (ADR-006/007); the import keeps supervisor data fresh                                                                                                                     |
| §26 data-quality risk          | Import flags rows missing location / supervisor / type — reported, never silent                                                                                                        |

## 2. Design decisions

### G1 — Extend the existing Branch row, never fork it

The Phase-2 directory (`code`, names, supervisor snapshot source, status) is
already the branch master §18 names — §16.1 fields are added as nullable
columns on the same row. Branch tickets, supervisor auto-mapping and the
routing fallback keep working untouched, and immediately benefit from
fresher data.

### G2 — The United Locations export is the canonical import format

The browser parses the company's real `.xlsx` (same client-parse /
server-authority pattern as CRM spec E1) and posts raw rows; the server maps
the known headers (SAP Store Code, Store Code, Pharmacy Name, Store Type,
Delivery Coverage, District/Area Manager, Supervisor, Arabic/English
Address, Location, City, District, Region, Postal Code, Latitude,
Longitude, phones). `code` = SAP Store Code, falling back to Store Code
(G2); a row with neither is invalid.

### G3 — Master-data sync is an upsert, not an insert

Unlike leads (transactional), branches are master data: re-importing the
monthly export **updates** existing codes in place and creates new ones —
idempotent by `code`, counts reported as created/updated/invalid. Names come
from Pharmacy Name (English) with the Arabic address's city fallback for
`nameAr` when no Arabic name exists in the feed (the export has no Arabic
pharmacy name column).

### G4 — Store-type mapping + §16.2 catalog

`BranchType` rows seeded verbatim from 16.2. Feed values map as data:
`Offline` → OFFLINE_BRANCH, `Online Branch`/`Online Meena Branch` →
ONLINE_STORE, `Online Dark store` → DARK_STORE; `Raqeeb` feeds map when they
appear. Unmapped/empty types import with `branchTypeKey = null` and a
`unmapped_type` quality flag — master data is never invented.

### G5 — Delivery Estimator formula from settings (ADR-008)

§16.3 lists the inputs but no formula. ETA = `branch.delivery.base_minutes`
(prep, default 15) + distance × `branch.delivery.minutes_per_km` (default 3).
A branch is eligible when: ACTIVE + Delivery Coverage = Covered + has
coordinates + distance ≤ `branch.delivery.max_km` (default 15) + open per
working hours (G6). Ineligible branches still appear in the locator with a
`deliveryUnavailableReason` (NOT_COVERED / OUT_OF_RANGE / CLOSED /
NO_LOCATION) — the operational capacity constraint keeps its slot as a
settings-driven max (0 = unlimited) until live capacity data exists.

### G6 — Working hours format

Not present in the feed; stored as optional JSON `{ "from": "HH:MM",
"to": "HH:MM" }` (editable later, overnight ranges supported). Absent hours
are treated as always open — the §26 data-quality report shows which
branches still lack them.

## 3. Data model

```
Branch (extended)   + storeCode?, addressAr?, addressEn?, district?, region?,
                    postalCode?, latitude?, longitude?, mapUrl?,
                    phone2?, phone3?, branchTypeKey? → BranchType,
                    deliveryCovered?, workingHours Json?, dutyPharmacist?,
                    districtManagerName?
BranchType          key, nameAr, nameEn, active   (§16.2 verbatim, editable)
```

## 4. API surface

```
POST /branches/import/preview   branch.manage   validation + quality report (no writes)
POST /branches/import           branch.manage   master-data upsert (created/updated/invalid)
GET  /branches                  branch.view     list — extended filters (region, typeKey, q)
GET  /branches/nearest          branch.view     ?lat=&lng= → nearest N with distanceKm,
                                                open flag, deliveryEtaMinutes | reason
GET  /branches/types            branch.view     §16.2 catalog
```

## 5. Settings (category `branches`)

| Key                            | Type   | Default | Purpose                  |
| ------------------------------ | ------ | ------- | ------------------------ |
| branch.locator.max_results     | NUMBER | 5       | Locator list size        |
| branch.delivery.base_minutes   | NUMBER | 15      | Prep time (G5)           |
| branch.delivery.minutes_per_km | NUMBER | 3       | Travel factor (G5)       |
| branch.delivery.max_km         | NUMBER | 15      | Delivery constraint (G5) |

## 6. Out of scope (explicitly)

Google Maps integration (§21 table — Later; Haversine now, same endpoint
shape when it lands), live operational capacity, customer-facing locator
(this is the internal §7 screen; public exposure is a Later decision),
per-day working-hours editor UI (JSON field editable via API).
