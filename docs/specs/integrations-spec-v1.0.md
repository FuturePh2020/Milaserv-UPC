# Physical Integrations — Module Specification v1.0

Source: blueprint §21 (التكاملات) — the connector table — under the §21.1
standard already delivered in Phase 7 (Integration Engine: timeout, retry,
idempotent queue, logging, DLQ + alerts, Monitor) and extended in Phase 10
(response capture + per-key success handlers). OCR (§21 row 7) shipped in
Phase 10; this phase delivers the remaining six connectors as **thin glue
over engines that already exist** — no new business logic, no new tables.

Open points are flagged as assumptions J1–J7.

## 1. Blueprint requirements (verbatim mapping)

| §21 connector | الغرض                                 | Delivered as                                                                 |
| ------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| Yeastar P570  | المكالمات والـ Queues والأداء         | Inbound webhook → §12 YEASTAR metric values (J1)                             |
| Ordering      | الطلبات والحالات والقيمة والمصادر     | Inbound webhook → §13 order ingest (J2); outbound resolved-sync (Phase 7)    |
| DBS           | التوافر وبيانات المنتجات عند الاعتماد | On-demand availability refresh on the §15 drug card, gated by a setting (J3) |
| Email         | إشعارات داخلية وإرسال لمشرف الفرع     | Email notification channel + branch-supervisor mail on branch tickets (J4)   |
| SMS           | إنشاء الشكوى والحل وCSAT              | Templated SMS on ticket create / resolve / close-CSAT (J5)                   |
| Google Maps   | الموقع والفرع الأقرب والمسافات        | Driving-distance enrichment of the §16.3 locator with fallback (J6)          |

## 2. Design decisions

### J1 — Yeastar: inbound webhook to the §12 performance store

The PBX pushes call events; the platform maps them onto the **already
seeded YEASTAR metric definitions** (inbound_calls, outbound_calls,
missed_calls, queue_calls_answered, total_talk_time, …). Endpoint
`POST /integrations/yeastar/events` accepts
`{ events: [{ agentEmail, direction in|out, answered, queue?, talkSeconds, at }] }`
and upserts daily `MetricValue` rows per USER (matched by email) and TEAM
(the user's team) — the §12 dashboard then renders PBX data with zero UI
change. Unknown agent emails are rejected per row, never silently (§26).

### J2 — Ordering: inbound webhook wrapping the §13 ingest

`POST /integrations/ordering/events` accepts the same order shape as the
Phase 7 `online/orders/ingest` service and reuses it verbatim (upsert by
external number, status catalog mapping, §26 rejects). The outbound
direction (issue-resolved sync) has existed since Phase 7. This connector
only adds the machine entry point.

### J3 — DBS: on-demand availability, «عند اعتماد الربط»

The blueprint activates DBS only when the link is approved — modeled as
setting `integrations.dbs.enabled` (false). When enabled, the §15 drug
card gains a **Refresh availability** action: it enqueues a
`dbs.availability_check` operation; the registered success handler (same
mechanism as OCR) applies the response `{ availability: { city: qty } }`
to `Drug.availability` + timeline. Queue semantics give retry/DLQ/Monitor
for free; the card keeps showing the last snapshot meanwhile.

### J4 — Email: a NotificationChannel + supervisor mail

The Phase 1 notification engine was built for exactly this: `EmailChannel`
implements the existing `NotificationChannel` interface. When
`notifications.email_enabled` is true and the user has an email address,
every notification also enqueues an `email.send` operation
(`{ to, subject, body }`) toward `integrations.email.endpoint` (an SMTP
bridge/relay). «إرسال لمشرف الفرع»: on branch-ticket creation the branch's
`supervisorEmail` (who may not be a platform user) gets a direct
`email.send` op with the ticket number and subject.

### J5 — SMS: templated sends on the complaint lifecycle

Three hooks in the ticket lifecycle, active when `integrations.sms.enabled`
and the ticket has a customer phone: **create** (شكوى مسجلة برقم …),
**resolve** (تم حل الشكوى), **close → CSAT** (رابط تقييم). Message texts
are settings (`sms.template.created/resolved/csat`) with `{number}` /
`{name}` placeholders — ADR-008, no hard-coded wording. Each send is an
`sms.send` operation toward `integrations.sms.endpoint` (gateway bridge).
CSAT capture itself (inbound reply/webform) is out of scope this phase —
the SMS carries the survey link.

### J6 — Google Maps: synchronous enrichment, graceful fallback

The locator answers a user waiting on screen — a retry queue is the wrong
shape. When `integrations.maps.endpoint` is set, `GET /branches/nearest`
POSTs origin + candidate branches to it (3s timeout) and uses returned
driving `km`/`minutes`; the response carries `distanceSource: "maps"`.
On timeout/error/empty it falls back to the Phase 8 Haversine math
(`distanceSource: "straight_line"`) — the locator never breaks because
Maps is down. Failures are logged; they do not enter the retry queue.

### J7 — Machine authentication: per-connector inbound tokens

Yeastar/Ordering push without a user session. Their endpoints are
`@Public` (no JWT) but guarded by a shared secret: header
`X-Integration-Token` must equal `integrations.<key>.inbound_token`;
an **empty token setting disables the endpoint entirely** (403). Every
accepted delivery is audit-logged with the connector as actor context.
Real IP allow-listing/mTLS is deployment configuration, not code.

## 3. API surface

| Route                                      | Auth                     | Purpose                                  |
| ------------------------------------------ | ------------------------ | ---------------------------------------- |
| `POST /integrations/yeastar/events`        | X-Integration-Token (J7) | Call events → §12 metric values          |
| `POST /integrations/ordering/events`       | X-Integration-Token (J7) | Orders → §13 ingest                      |
| `POST /dic/drugs/:id/refresh-availability` | dic.view + dbs.enabled   | Enqueue `dbs.availability_check` (J3)    |
| `GET /integrations/connectors`             | integration.monitor      | Connector config/health cards (admin UI) |

Plus internal: `EmailChannel` in the notification fan-out (J4), SMS hooks
in `TicketsService` create/resolve/close (J5), Maps call in
`BranchesService.nearest` (J6). Handlers registered: `dbs`.

## 4. Settings (ADR-008)

| Key                                   | Default                         | Meaning                                  |
| ------------------------------------- | ------------------------------- | ---------------------------------------- |
| `integrations.yeastar.inbound_token`  | `''`                            | Empty = webhook disabled (J7)            |
| `integrations.ordering.inbound_token` | `''`                            | Empty = webhook disabled (J7)            |
| `integrations.dbs.enabled`            | `false`                         | «عند اعتماد الربط» gate (J3)             |
| `integrations.dbs.endpoint`           | `''`                            | DBS bridge URL                           |
| `integrations.email.endpoint`         | `''`                            | SMTP relay/bridge URL                    |
| `integrations.sms.enabled`            | `false`                         | SMS lifecycle hooks gate (J5)            |
| `integrations.sms.endpoint`           | `''`                            | SMS gateway bridge URL                   |
| `integrations.maps.endpoint`          | `''`                            | Distance service URL (empty = Haversine) |
| `sms.template.created`                | Arabic template with `{number}` | Complaint-registered text                |
| `sms.template.resolved`               | Arabic template with `{number}` | Complaint-resolved text                  |
| `sms.template.csat`                   | Arabic template with `{number}` | CSAT survey text                         |

(`notifications.email_enabled` and `integrations.ordering.endpoint` /
`integrations.ocr.endpoint` already exist.)

## 5. Data model

**No new tables.** The connectors write into `MetricValue`, `OnlineOrder`,
`Drug.availability`, `Notification`, and `IntegrationOperation` — all
existing. No new permissions either: webhooks use tokens (J7), the DBS
refresh rides `dic.view`, the connectors card rides `integration.monitor`.

## 6. Out of scope (this phase)

CSAT response capture, WhatsApp channel, live Yeastar queue dashboard
(wallboard), polling-mode connectors, mTLS/IP allow-listing (deployment),
per-partner branding of emails/SMS (§Partner scope, later).
