# Phase 6 — CRM, Leads & Telesales (Acceptance Record)

Implements `docs/specs/crm-telesales-spec-v1.0.md` (blueprint §14).
Assumptions E1–E7 applied as flagged. The CRM module scope from §5 —
**Ticketing + Orders/Sales performance readiness** — is now operational.

| Area                       | Delivered                                                                                                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lead upload (§14.1)        | `.xlsx`/`.csv` parsed in the browser (Arabic/English headers), server-side validation + preview (nothing written), per-row duplicate detection (same file + existing open leads, KSA-aware phone normalization), imported/skipped reporting                                   |
| Source/Partner/Campaign    | Fixed at upload, stamped on every lead; partner as snapshot string until the Partner master exists (E6, ADR-007 precedent)                                                                                                                                                    |
| Distribution (§14.1)       | One-by-one via `/crm/leads/next`: hard-gated by an ACTIVE Break-Tracker shift session, held lead returns until dispositioned, FIFO claim race-safe under concurrent agents                                                                                                    |
| Call logging (§14.1–14.3)  | Call Status (14.2 verbatim) + Disposition (14.3 verbatim) with catalog behavior flags: reschedule dispositions demand date & time and keep the lead open (due reschedules return before NEW leads); closing dispositions close the lead; UI call timer measures duration (E4) |
| Orders (§14.4, E7)         | Order Created creates the `ORD-{YYYY}-{SEQ:6}` order transactionally (types 14.4 verbatim); lifecycle OPEN → COMPLETED/CANCELLED                                                                                                                                              |
| Telesales KPIs (§14.5, E5) | 9 KPIs live-computed per agent + team aggregation inside the §12 performance engine — Monthly/Annual Targets, Achievement %, Trend and color states apply without new code                                                                                                    |
| Yeastar click-to-call      | Deferred per §23 (Later); call records are integration-ready — the connector will initiate calls and pre-fill duration behind ADR-009                                                                                                                                         |
| Permissions                | `crm.view` / `crm.work` / `crm.upload` (45 keys total), audit + timeline on imports, calls, orders                                                                                                                                                                            |
| Frontend                   | `/crm`: My Queue (next-lead workflow with live call timer, conditional reschedule/order fields), Leads list with filters, Orders list with complete/cancel, upload dialog with preview badges; sidebar; bilingual                                                             |

## Definition of Done (§24)

- [x] Business rules documented — spec + this record
- [x] UI + API implemented; migration `crm_telesales`; 3 permissions, 3 catalogs (14 rows) + 9 KPI defs, 1 setting
- [x] Permissions/audit/timeline on every mutation; skipped rows always reported, never dropped
- [x] Tests — CRM suite 12 e2e tests; full regression 108/108 green
- [x] UAT walkthrough — Chromium 13/13: manager uploads xlsx (2 valid / 1 duplicate / 1 invalid) and imports; agent blocked without shift session, works two leads FIFO (reschedule + order), completes the ORD-numbered order; conversion rate 50% appears in the performance dashboard
- [x] Docs updated; rollback = revert commits + `crm_telesales` migration

Remaining blueprint scope (all in §23 "Later", no fixed order): Online
Operation (§13), United Pharmacy Center DIC (§15), Branch Center (§16), OCR
(§17), physical integrations (§21), AI features.
