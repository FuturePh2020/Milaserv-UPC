# CRM, Leads & Telesales — Module Specification v1.0

Source: blueprint §14 (14.1 Leads Distribution, 14.2 Call Status, 14.3 Lead
Disposition, 14.4 Order Types, 14.5 Telesales KPIs). Module scope per §5
table: **CRM = Ticketing + Orders/Sales performance readiness**. Business
objects touched: Lead, Customer (as lead snapshot fields), Order (§18).

Open points are flagged as assumptions E1–E7.

## 1. Blueprint requirements (verbatim mapping)

| §    | Requirement                                    | Delivered as                                                                     |
| ---- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| 14.1 | رفع Excel مع Validation وPreview               | Client-side sheet parse → `POST /crm/leads/preview` (validation report) → import |
| 14.1 | كشف التكرارات                                  | Per-row duplicate flags: same phone in the file or an existing open lead (E2)    |
| 14.1 | تحديد Lead Source وPartner وCampaign           | Batch-level source/partner/campaign stamped on every imported lead               |
| 14.1 | التوزيع واحدة بواحدة أثناء Shift Session       | `POST /crm/leads/next` — one open lead at a time, requires ACTIVE WorkSession    |
| 14.1 | الاتصال عبر Yeastar API                        | Deferred integration (E4): click-to-call slot; call results logged in-platform   |
| 14.1 | حفظ Call Result وDuration وDisposition         | `LeadCall` rows (status 14.2 + disposition 14.3 + durationSeconds)               |
| 14.1 | Reschedule Date & Time للمتابعة                | Reschedule dispositions require `rescheduledAt`; due leads return via `next`     |
| 14.2 | Answered / Busy / No Answer / Abandoned        | `CallStatus` catalog seeded verbatim                                             |
| 14.3 | 6 dispositions                                 | `LeadDisposition` catalog seeded verbatim with behavior flags (E3)               |
| 14.4 | Cash / Insurance / Wasfaty / Insurance Partner | `TelesalesOrderType` catalog seeded verbatim                                     |
| 14.5 | 10 Telesales KPIs + Monthly/Annual Targets     | Live-computed KPIs in the §12.2 performance engine; targets reuse it (E5)        |

## 2. Design decisions

### E1 — Upload format

"رفع Excel": the browser parses `.xlsx`/`.csv` locally and posts JSON rows;
the server is the authority on validation and duplicates (never trusts the
client's verdicts). Keeps binary parsing out of the API and gives instant
preview UX. Required columns: name, phone; optional: city, notes.

### E2 — Duplicate detection

A row is a duplicate when its normalized phone matches (a) another row in the
same file, or (b) any existing **open** lead (NEW/ASSIGNED). Duplicates are
shown in the preview and skipped on import — never silently dropped: the
import response reports imported/skipped counts per reason. Closed leads do
not block re-import (a customer may legitimately return in a new campaign).

### E3 — Disposition behavior as catalog flags

Each `LeadDisposition` row carries flags instead of hard-coded logic
(ADR-008): `closesLead` (Order Created, Refused, Invalid Number, Not
Interested), `requiresReschedule` (Call Back Later, Follow-up Required),
`createsOrder` (Order Created). New dispositions later are data inserts.

### E4 — Yeastar click-to-call deferred

Per the §23 release plan, integrations are Later (same decision as spec D1).
The call record (status, duration, disposition) is captured in-platform; the
UI keeps a call timer so duration is measured, not guessed. When the Yeastar
connector lands (ADR-009) it initiates the call and pre-fills duration —
the data model does not change.

### E5 — KPIs ride the performance engine (Engine First)

The 9 computable 14.5 KPIs become `PerformanceMetricDef` rows with a new
source `TELESALES`, computed live (like `agent_sla`, spec D3) from
`LeadCall`/`TelesalesOrder`. "Monthly / Annual Targets" is therefore already
done: §12.2 targets accept MONTHLY/YEARLY per employee or team for these
metrics, with the same Achievement %/Trend/color pipeline.

| KPI (14.5)         | key                 | computation (per agent in period)                   |
| ------------------ | ------------------- | --------------------------------------------------- |
| Calls              | ts_calls            | count(LeadCall)                                     |
| Leads Called       | ts_leads_called     | count(distinct LeadCall.leadId)                     |
| Orders Created     | ts_orders_created   | count(TelesalesOrder created)                       |
| Completed Orders   | ts_completed_orders | count(TelesalesOrder completed in period)           |
| Open Orders        | ts_open_orders      | count(TelesalesOrder created in period, still OPEN) |
| Sales Value        | ts_sales_value      | sum(TelesalesOrder.value created in period)         |
| AHT                | ts_aht              | avg(LeadCall.durationSeconds)                       |
| Total Talking Time | ts_talk_time        | sum(LeadCall.durationSeconds)                       |
| Conversion Rate    | ts_conversion_rate  | orders created ÷ leads called × 100                 |

Team rows aggregate the team's agents.

### E6 — Partner is a snapshot string

The Partner master record arrives with its own module (§18 business object);
until then `partnerName` is stored as text on the batch/lead, exactly like
the branch-supervisor snapshot precedent (ADR-007). No schema change later —
a `partnerId` FK is added beside it when the master exists.

### E7 — Telesales orders are performance-readiness records

Real orders belong to the Ordering System integration (§13, Later).
`TelesalesOrder` records what telesales closed (type 14.4, value, OPEN →
COMPLETED/CANCELLED) so 14.5 KPIs are true, numbered `ORD-{YYYY}-{SEQ:6}`
via the Number Generator (settings-driven). When the ordering integration
arrives these records link to it; they are not a pharmacy order pipeline.

## 3. Data model

```
LeadBatch    fileName, leadSource, partnerName?, campaign?, uploadedById,
             importedCount, skippedCount
Lead         batchId?, name, phone (normalized), city?, notes?,
             leadSource/partnerName/campaign (stamped), status NEW|ASSIGNED|CLOSED,
             assignedToId?, assignedAt?, rescheduledAt?, lastCallAt?,
             closedAt?, closedDispositionKey?
             @@index(status, rescheduledAt), @@index(assignedToId, status), @@index(phone)
LeadCall     leadId, agentId, callStatusKey (14.2), dispositionKey (14.3),
             durationSeconds, notes?, rescheduledAt?, orderId?, createdAt
TelesalesOrder  number (generator), leadId?, customerName, customerPhone,
             orderTypeKey (14.4), value Decimal, status OPEN|COMPLETED|CANCELLED,
             createdById, completedAt?
Catalogs     CallStatus, LeadDisposition(+behavior flags), TelesalesOrderType
```

## 4. Distribution & call flow (14.1)

`POST /crm/leads/next` (agent):

1. Requires an ACTIVE WorkSession — "أثناء Shift Session" is enforced, not
   advisory. 422 otherwise.
2. If the agent already holds an open lead that is due (no future
   reschedule), it is returned again — one lead at a time, no hoarding.
3. Otherwise assign, in order: (a) the agent's own rescheduled lead that is
   due, (b) the oldest NEW lead (FIFO). Assignment is atomic (row-locking
   update) so two agents never receive the same lead.

`POST /crm/leads/:id/call` (assigned agent): records status/duration/
disposition; disposition flags drive the transition — reschedule
dispositions require `rescheduledAt` (422 without), closing dispositions
close the lead, Order Created additionally requires the order payload
(type + value) and creates the numbered order in the same transaction.
Timeline events on the lead (`entityType: 'lead'`) + audit on mutations.

## 5. API surface

```
POST /crm/leads/preview      crm.upload   validation + duplicate report (no writes)
POST /crm/leads/import       crm.upload   creates batch + leads (skips invalid/dupes)
GET  /crm/leads              crm.view     scoped list (status/batch/search filters)
POST /crm/leads/next         crm.work     one-by-one distribution (WorkSession gate)
POST /crm/leads/:id/call     crm.work     log call result (+order when disposition demands)
GET  /crm/orders             crm.view     scoped list
PATCH /crm/orders/:id/status crm.work     OPEN → COMPLETED | CANCELLED
GET  /crm/catalogs           crm.view     call statuses, dispositions, order types
```

Scoping (§19.1): leads/orders MY_RECORDS = assigned/created by me; MY_TEAM =
my teams' agents; DEPARTMENT; ALL_DATA. Unassigned NEW leads are visible to
crm.view holders at team level and above (they belong to no one yet).

## 6. Permissions & settings

| Key          | Meaning                                        | Defaults                                                 |
| ------------ | ---------------------------------------------- | -------------------------------------------------------- |
| `crm.view`   | Leads/orders lists & catalogs (scope-based)    | Agent MY_RECORDS, Sup/Leader MY_TEAM, Manager DEPARTMENT |
| `crm.work`   | Pull next lead, log calls, create/close orders | Agent MY_RECORDS, Sup/Leader MY_TEAM                     |
| `crm.upload` | Import lead files                              | Manager DEPARTMENT, admins ALL                           |

Settings (category `crm`): `crm.order.number_format` = `ORD-{YYYY}-{SEQ:6}`.

## 7. Out of scope (explicitly)

Yeastar click-to-call (E4), Ordering System integration (§13 Later), Partner
master module (E6), campaign management UI beyond the free-text field, SMS
CSAT (§21 table), lead scoring/AI (Later).
