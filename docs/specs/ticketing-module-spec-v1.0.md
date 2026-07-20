# Ticketing Module Specification v1.0

**Status:** Draft for approval · **Source of truth:** Blueprint v1.0 (§5, §8, §9, §19, §23, §25)
**Governing ADRs:** ADR-003 (Universal Ticket Engine), ADR-004 (role separation),
ADR-005 (mandatory resolution), ADR-006/007 (supervisor auto-mapping + snapshot),
ADR-008 (configuration over code), ADR-010 (scoped search/reports)

Per blueprint §1.1, any behavior not covered here requires a Change Request before
implementation. §12 (Assumptions) lists every interpretation made where the blueprint
is silent — **these need explicit approval.**

---

## 1. Purpose & scope

One universal ticket engine (ADR-003) serving all teams, delivered across two sprints:

| Sprint (§23)       | Scope                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| Sprint 2 remainder | Attachments foundation, Number Generator (prerequisites)                                                   |
| Sprint 3           | Ticketing Core: create, list, details, assignment/responsibility, updates, queues/views, filters, timeline |
| Sprint 4           | Branch tickets + supervisor auto-mapping/snapshot, SLA engine, mandatory resolution, close/re-open         |

**Out of scope** (later phases, unchanged from blueprint): Customer master (§18 — customer
name/phone stay plain ticket fields for now), Case grouping, Yeastar call linkage, Order
linkage, OCR, CSAT SMS, email-to-ticket, full Branch Center (§16 — only the minimal branch
directory below), Rules Engine general conditions, WhatsApp.

## 2. Dependencies added by this phase

1. **Number Generator** — settings-driven formats, per-key sequences (gapless within key):
   - `ticketing.number.internal_format` default `TKT-{YYYY}-{SEQ:6}`
   - `ticketing.number.customer_format` default `CC-{YYYY}-{SEQ:6}` (customer-facing complaint number, §9.4)
2. **Attachment Engine foundation (§8)** — generic `(entityType, entityId)` attachments:
   upload/download/delete, size & MIME allow-list from Settings, S3-compatible storage with
   local-disk driver for development, audit on every operation, permission-checked download.
   (Versioning + preview arrive with the KB phase.)
3. **Minimal Branch Directory** — the subset of §16.1 that Branch tickets require:
   `code, nameAr, nameEn, city, phone, supervisorUserRef?/supervisorName, supervisorEmail,
supervisorPhone, areaManagerName/Email, status`. Managed by `branch.view` / `branch.manage`
   permissions. The full Branch Center later **extends** this table — no rework.
4. **Background worker** — BullMQ on the existing Redis (§20 "Redis + Background Workers")
   for SLA warning/breach timers and notification fan-out.

## 3. Configuration over code (ADR-008)

All of the following are **data, not enums**, seeded with the blueprint's values and
manageable from Settings/admin APIs:

| Catalog                             | Seeded values (blueprint)                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ticket types                        | `INTERNAL`, `BRANCH` (§9.1)                                                                                                                                                                                                                 |
| Categories per type                 | Internal: Inquiry, Complaint, Availability Check, Order Follow-Up · Branch: Pharmacist Behavior, Branch Duty Hours, Branch Structure, Discount, Products, Return Policy, Pricing (§9.2) — bilingual labels, orderable, archivable           |
| Urgencies                           | Low, Moderate, Critical (§9.3) with color + SLA mapping                                                                                                                                                                                     |
| Statuses                            | Opened, Processing, Completed, Closed, Re-opened, Escalated, New Response (§9.3) — each with `kind: OPEN / RESOLVED / TERMINAL`, bilingual labels                                                                                           |
| Status transitions                  | Seeded matrix in §5 below, stored as configuration (workflow-engine foundation)                                                                                                                                                             |
| Update types                        | General Update, Customer Contact, Branch Contact, Investigation, Order Review, Product Review, Waiting, Escalation, Proposed Solution, Final Resolution (§9.6)                                                                              |
| Directed teams                      | The §9.9 list seeded as Teams (tagged `routable`): Branch Supervisor, Operation Leader/Supervisor/Team, Customer Care Leader/Supervisor/Team, CRM Leader/Supervisor/Team, Marketing Leader/Supervisor/Team, Delivery Supervisor, Online Hub |
| Resolution categories               | Seeded starter list (see §12 assumptions)                                                                                                                                                                                                   |
| SLA policies                        | Per (type, urgency): first-response minutes + resolution minutes, warning threshold %, escalation targets                                                                                                                                   |
| Routing fallback                    | `ticketing.branch.no_supervisor_route` = `AREA_MANAGER` \| `UNASSIGNED_QUEUE` (§9.8)                                                                                                                                                        |
| Required-resolution toggle per type | `ticketing.resolution.required_fields` (§9.7, per ticket type)                                                                                                                                                                              |

## 4. Domain model (Prisma additions)

```
TicketType        id, key, nameAr, nameEn, active
TicketCategory    id, typeId→TicketType, key, nameAr, nameEn, order, active
TicketUrgency     id, key, nameAr, nameEn, color, order, active
TicketStatus      id, key, nameAr, nameEn, kind(OPEN|RESOLVED|TERMINAL), color, order, active
StatusTransition  id, fromStatusId, toStatusId, requiredPermissionKey?   ← workflow config

Ticket
  id, internalNumber (unique), customerComplaintNumber (unique)
  typeId, categoryId, urgencyId, statusId
  customerName, customerPhone                       (§9.4 — plain fields this phase)
  subject, description
  relatedOrderNo?                                   (free text until Ordering integration)
  branchId?           → Branch                      (required when type=BRANCH)
  branchSupervisorSnapshot Json?                    (ADR-007: name/email/phone/capturedAt)
  customerVisitAt?                                  (§9.4)
  sapMaterialNo?, itemNameAr?, itemNameEn?          (§9.4)
  createdById         → User        (ADR-004: never changes)
  responsibleId?      → User        (current single owner, §9.9)
  resolvedById?, resolvedAt?
  closedById?, closedAt?
  reopenCount, lastCustomerResponseAt?
  — SLA (Sprint 4) —
  slaPolicyId?, firstResponseDueAt?, resolutionDueAt?,
  slaStatus (ON_TRACK|WARNING|BREACHED|PAUSED|MET), slaPausedAt?, slaPausedTotalMinutes
  createdAt, updatedAt, deletedAt (soft)

TicketTeam        ticketId, teamId       (§9.9 multi-select directed teams; unique pair)
TicketOwnership   ticketId, userId, fromAt, toAt?, assignedById, reason
                  (full responsibility history, §9.5 "Ownership History")
TicketUpdate      ticketId, authorId, updateTypeId, directedToTeamId?, body,
                  isResolution boolean, createdAt        (§9.6 — immutable once created)
TicketResolution  ticketId (1:1), summary, rootCause, actionTaken, finalSolution,
                  resolutionCategoryId, customerInformed boolean,
                  resolvedById, resolvedAt                (§9.7 — all mandatory)
UpdateType        id, key, nameAr, nameEn, order, active
ResolutionCategory id, key, nameAr, nameEn, active
SlaPolicy         id, typeId, urgencyId, firstResponseMinutes, resolutionMinutes,
                  warningThresholdPct, active   (unique type+urgency)
Branch            (minimal directory, §2 above)
Attachment        id, entityType, entityId, fileName, mimeType, sizeBytes,
                  storageKey, uploadedById, createdAt, deletedAt
NumberSequence    key, year, lastValue      (row-locked increment)
```

Existing engines are reused, not duplicated: `AuditLog`, `TimelineEvent`, `Notification`,
`Setting`, permissions/scopes. Ticket queries respect data scope exactly like users/teams
(ADR-010): `MY_RECORDS` = created-by-me OR responsible-me; `MY_TEAM` = tickets directed to
my teams (plus my records); `DEPARTMENT` = tickets directed to any team of my department
(plus my records); `BRANCH` scope activates for branch-scoped partners later.

## 5. Status state machine (seeded transition matrix)

```
Opened ──assign/take──▶ Processing ──resolve──▶ Completed ──close──▶ Closed
  │                        │   ▲                    │                  │
  │                        │   └──new response──────┘                  │
  ├──escalate──▶ Escalated─┘  (New Response: auto, see rules)          │
  └──close (with resolution)──────────────────────────────────────────┘
Closed ──re-open──▶ Re-opened ──▶ (same flow as Processing)
```

Seeded transitions (each row = configuration, editable later):

| From                                              | To           | Guard                                                              |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------------ |
| Opened                                            | Processing   | responsible assigned or self-take (`ticket.take_responsibility`)   |
| Opened / Processing / Re-opened / New Response    | Escalated    | `ticket.escalate`                                                  |
| Escalated                                         | Processing   | `ticket.assign` / `ticket.take_responsibility`                     |
| Processing / Escalated / Re-opened / New Response | Completed    | **resolution record complete** (ADR-005) + `ticket.resolve`        |
| Completed                                         | Closed       | `ticket.close` (Closed By recorded, ADR-004)                       |
| Completed                                         | New Response | automatic on new customer-facing update after resolution           |
| Closed                                            | Re-opened    | `ticket.reopen`, increments `reopenCount`, SLA restarts per policy |

Hard rules (not configurable):

- No transition to Completed/Closed while the §9.7 resolution fields are incomplete (ADR-005).
- `createdById` is immutable; `resolvedBy/closedBy` are set only by their transitions (ADR-004).
- Every transition writes: timeline event + audit entry + ownership row when responsibility
  changes + notifications per §9 below.

**New Response semantics (assumption A3):** when an inbound-flagged update
(`Customer Contact` authored after status=Completed) or a re-opened customer reply arrives,
status auto-moves to `New Response` and the responsible user + directed teams are notified.

## 6. Branch ticket auto-mapping (ADR-006/007, §9.8)

- Create form: user selects **branch only**; API resolves the branch's current supervisor
  and returns it read-only (name/email/phone).
- On creation the system stores `branchSupervisorSnapshot` (immutable) and:
  - supervisor exists & active → auto-direct to the "Branch Supervisor" routable team +
    notify supervisor (in-app; email when that channel activates);
  - no active supervisor → route per `ticketing.branch.no_supervisor_route` setting
    (Area Manager fallback or Unassigned queue) + flag `data_quality` audit event (§26 risk).
- Later supervisor changes never rewrite history; new tickets use current data (§9.8).

## 7. Views, filters, search (§9.10–§9.11)

Saved server-side views (single list endpoint + `view=` param):
`my_tickets` (created by me) · `assigned_to_me` · `all` · `unassigned` · `escalated` ·
`critical` · `branch_complaints` · `closed_today` — all scope-filtered (ADR-010).

Filters (combinable): createdFrom/To, directedTeamId, responsibleId, createdById, typeId,
categoryId, urgencyId, statusId, branchId, product (SAP no. / item name contains),
slaStatus, hasAttachments. Free-text `q` over number, customer name/phone, subject.
Pagination + sort (createdAt, urgency, SLA due) per §22 performance targets
(list < 2s, search < 1s).

## 8. Permissions (extends the §19.2 catalog)

`ticket.view` (with data scope) · `ticket.create` · `ticket.edit` · `ticket.assign` ·
`ticket.take_responsibility` · `ticket.redirect` · `ticket.update_add` · `ticket.resolve` ·
`ticket.close` · `ticket.reopen` · `ticket.escalate` · `ticket.export` (logged, §19.3) ·
`ticket.manage_config` (categories/statuses/SLA/update types) · `branch.view` · `branch.manage` ·
`attachment.manage`
Seed defaults: SUPER/PLATFORM_ADMIN all @ ALL_DATA; TEAM_MANAGER ticket.* @ DEPARTMENT;
TEAM_LEADER/SUPERVISOR view/create/assign/take/update/resolve/escalate @ MY_TEAM;
AGENT view @ MY_RECORDS + create/take/update; QUALITY_REVIEWER ticket.view @ DEPARTMENT;
READ_ONLY ticket.view @ DEPARTMENT. (Adjustable in the Roles screen as always.)

## 9. Notifications & timeline (reuses Phase 1 engines)

Notify (in-app now, email-ready): assignment/redirect → new responsible; directed team added
→ team leaders; escalation → team managers of directed teams; SLA warning → responsible;
SLA breach → responsible + managers; resolution → creator; close → creator + responsible;
re-open & new response → responsible + directed team leaders.

Timeline records every §9.12 item: creation, assignment, responsibility acceptance,
redirect, status/urgency change, updates, notification sends, escalation, resolution,
closure, re-open, SLA warning/breach — via the existing `TimelineEvent` stream, displayed
in the ticket detail page.

## 10. API contract (v1)

| Method & path                                                                                                          | Permission                           | Notes                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `POST /tickets`                                                                                                        | ticket.create                        | type-specific validation; generates both numbers; branch flow per §6   |
| `GET /tickets?view=&filters…`                                                                                          | ticket.view                          | scoped list, §7                                                        |
| `GET /tickets/:id`                                                                                                     | ticket.view                          | full detail incl. teams, ownership, updates, resolution, SLA, timeline |
| `PATCH /tickets/:id`                                                                                                   | ticket.edit                          | editable descriptive fields only; never audit-bearing fields           |
| `POST /tickets/:id/assign` `{userId}`                                                                                  | ticket.assign                        | closes open ownership row, opens new                                   |
| `POST /tickets/:id/take`                                                                                               | ticket.take_responsibility           | self-assign                                                            |
| `POST /tickets/:id/redirect` `{teamIds[]}`                                                                             | ticket.redirect                      | replaces directed teams (multi-select §9.9)                            |
| `POST /tickets/:id/updates` `{updateTypeId, body, directedToTeamId?}`                                                  | ticket.update_add                    | immutable append (§9.6)                                                |
| `POST /tickets/:id/status` `{statusKey}`                                                                               | per transition matrix                | guard-checked                                                          |
| `POST /tickets/:id/resolve` `{summary, rootCause, actionTaken, finalSolution, resolutionCategoryId, customerInformed}` | ticket.resolve                       | writes resolution + Completed                                          |
| `POST /tickets/:id/close` / `/reopen`                                                                                  | ticket.close / ticket.reopen         | ADR-004 stamps                                                         |
| `POST /tickets/:id/escalate` `{reason}`                                                                                | ticket.escalate                      |                                                                        |
| `GET /tickets/export`                                                                                                  | ticket.export                        | CSV, export logged to audit (§19.3)                                    |
| `GET/PUT /ticket-config/*`                                                                                             | ticket.manage_config                 | catalogs of §3                                                         |
| `GET/POST/PATCH /branches`                                                                                             | branch.view / branch.manage          | minimal directory                                                      |
| `POST /attachments` (+`GET /:id/download`, `DELETE`)                                                                   | attachment.manage / entity view perm | generic engine                                                         |
| `GET /sla-policies` / `PUT`                                                                                            | ticket.manage_config                 | Sprint 4                                                               |

## 11. User stories & acceptance criteria (condensed)

**US-1 Create internal ticket** — agent fills type/category/urgency/customer/subject/description
(+optional order no., product, attachments). ✓ numbers generated per settings format;
✓ status=Opened; ✓ creator recorded immutably; ✓ timeline `created`; ✓ audit `ticket.create`;
✓ appears in creator's My Tickets within scope rules.

**US-2 Create branch ticket** — user picks branch; supervisor auto-fills read-only.
✓ snapshot stored; ✓ auto-directed + supervisor notified; ✓ fallback route honored when
no supervisor; ✓ supervisor change later leaves old tickets untouched.

**US-3 Assignment & responsibility** — leader assigns / agent takes.
✓ single responsible at any moment; ✓ ownership history complete with assigner + reason;
✓ status auto → Processing; ✓ new responsible notified; ✓ 403 outside scope.

**US-4 Updates** — responsible adds typed updates. ✓ author/date/type/directed-team stored;
✓ immutable after creation; ✓ visible in timeline order (§9.6); ✓ `Waiting` type pauses SLA.

**US-5 Resolution (ADR-005)** — resolve requires all §9.7 fields. ✓ API rejects Completed/Closed
without complete resolution (422 with missing-field list); ✓ resolvedBy/At recorded;
✓ creator notified; ✓ SLA result frozen (MET/BREACHED).

**US-6 Close / re-open** — ✓ closedBy/At separate from resolver; ✓ re-open increments counter,
restarts flow, notifies; ✓ `closed_today` view accurate.

**US-7 Views & filters** — each §9.10 view returns exactly its definition under the caller's
data scope; all §9.11 filters combinable; export produces CSV + audit entry.

**US-8 SLA** — policy per type+urgency. ✓ due dates computed at creation;
✓ warning at threshold → notification + WARNING; ✓ breach → notification + Escalated per
policy; ✓ Waiting pauses the clock and resumes correctly; ✓ timeline records warning/breach.

**US-9 Config screens** — admin edits categories/urgencies/statuses/update types/SLA/
resolution categories with bilingual labels. ✓ changes audited; ✓ archived values keep
historical tickets intact; ✓ new tickets can't use archived values.

## 12. Assumptions requiring approval

| #   | Assumption                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | `customerComplaintNumber` is auto-generated (customer-facing) alongside the internal number; format is settings-driven.                                                        |
| A2  | Customer name/phone remain plain ticket fields until the Customer master (§18) exists; a later migration links them without data loss.                                         |
| A3  | `New Response` is an automatic status set by inbound updates after resolution (see §5); it can also be set manually by permitted users.                                        |
| A4  | SLA clocks run on calendar time in v1; business-hours calendars are a later enhancement (config slot reserved).                                                                |
| A5  | Minimal Branch Directory ships in this phase as the §16 subset; full Branch Center later extends it.                                                                           |
| A6  | Resolution categories seed list: Resolved–Product, Resolved–Service, Resolved–Branch Action, Not an Issue, Duplicate, Unresolvable–External (editable in config).              |
| A7  | Attachment storage in development = local disk driver; production = S3-compatible bucket (env-configured), 10 MB default limit, images/PDF/Office MIME allow-list in Settings. |
| A8  | Wireframes below are layout guidance; visual design follows the Phase 1 design system.                                                                                         |

## 13. Wireframes (layout guidance)

**List (queues):**

```
[Tickets]                                   [+ New Ticket] [Export]
Views: My | Assigned to me | All | Unassigned | Escalated | Critical | Branch | Closed today
Filters: [type ▾][category ▾][urgency ▾][status ▾][branch ▾][SLA ▾][date ▾][🔍 q]
┌──────┬───────────────┬──────────┬──────────┬───────────┬─────────┬────────────┬──────┐
│ No.  │ Customer      │ Type/Cat │ Urgency  │ Status    │ SLA     │ Responsible│ Age  │
└──────┴───────────────┴──────────┴──────────┴───────────┴─────────┴────────────┴──────┘
```

**Detail:**

```
TKT-2026-000123 · CC-2026-000123      [Take] [Assign ▾] [Redirect ▾] [Escalate] [Resolve] [Close]
Status: Processing   Urgency: Critical   SLA: ⚠ due in 32m
┌ Left column ────────────────┐  ┌ Right column ───────────────────────┐
│ Customer / branch card      │  │ Tabs: Updates | Resolution | Timeline│
│ (supervisor snapshot ro)    │  │  [update type ▾] [directed to ▾]     │
│ Product / order info        │  │  [ textarea + attach ]   [Add]       │
│ Directed teams (chips)      │  │  ● 12:04 Investigation — Sara …      │
│ People: Created/Responsible │  │  ● 11:40 Branch Contact — Ali …      │
│ /Resolved/Closed (ADR-004)  │  │                                      │
│ Attachments                 │  │                                      │
└─────────────────────────────┘  └──────────────────────────────────────┘
```

**Create (branch type):** type → (branch picker → supervisor auto-card read-only) →
category/urgency → customer fields → subject/description → product/order (optional) →
attachments → submit.

## 14. Definition of Done

The §24 checklist applies per sprint, verified the same way as Phase 1 (e2e suites against
live Postgres/Redis + Chromium walkthrough), including: permissions on every endpoint, audit

- timeline on every action, notification checks, validation/error states, migration +
  idempotent seed of all catalogs, docs update, rollback notes.
