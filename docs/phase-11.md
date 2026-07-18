# Phase 11 — Physical Integrations (Acceptance Record)

Implements `docs/specs/integrations-spec-v1.0.md` (blueprint §21 connector
table under the §21.1 standard). Assumptions J1–J7 applied as flagged. UAT
ran against a stub bridge speaking each connector's contract.

| Connector    | Delivered                                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yeastar P570 | `POST /integrations/yeastar/events` (token-guarded) → §12 YEASTAR metric values upserted per user + team by date; unknown agents rejected per row (§26) — demo push landed 4 events on a real agent |
| Ordering     | `POST /integrations/ordering/events` (token-guarded) reusing the §13 ingest verbatim — webhook-pushed orders appeared on the Online Operation page; outbound resolved-sync unchanged from Phase 7   |
| DBS          | «عند اعتماد الربط» gate (`integrations.dbs.enabled`) + **Refresh availability** on the §15 drug card → `dbs.availability_check` through the retry queue; handler applied 4 cities to the live card  |
| Email        | `EmailChannel` in the notification fan-out (queues `email.send` when `notifications.email_enabled`); branch tickets additionally mail the branch supervisor directly                                |
| SMS          | Templated sends on create / resolve / close-CSAT (`sms.template.*` settings with `{number}`/`{name}`), queued toward the gateway bridge                                                             |
| Google Maps  | Locator enriched with driving km/minutes (3s timeout) and `distanceSource` badge; bridge-down run fell back to straight-line math without breaking the page                                         |
| Machine auth | `X-Integration-Token` per connector; empty token = endpoint disabled (403); all deliveries audited with connector actor context (J7)                                                                |

Admin UI: the Integration Monitor gained **connector cards** (7 connectors
with direction, Enabled/Configured/Not-configured state, op counts, last
success/failure) via `GET /integrations/connectors`.

Engine change: none beyond Phase 10's response capture + handler registry —
DBS registered a second success handler, proving the pattern generalizes.

Out of scope (per spec §6): CSAT response capture, WhatsApp channel,
Yeastar wallboard, polling-mode connectors, mTLS/IP allow-listing
(deployment), per-partner branding.

## Definition of Done (§24)

- [x] Business rules documented — spec + this record
- [x] No new tables or permission keys; 11 connector settings (tokens, endpoints, gates, SMS templates)
- [x] Machine endpoints token-guarded and audited; per-row rejects for unknown agents/sources (§26)
- [x] Tests — connectors suite 9 e2e tests (CN-1..CN-9) with an HTTP stub bridge; full regression **154/154** across 17 suites
- [x] UAT walkthrough — Chromium 8/8: connector cards (7, with live config state) → DBS refresh applied 4 cities to the Panadol Extend card through the 3s sweep → locator with driving distances + source badge → webhook-pushed orders visible in Online Operation → Arabic RTL; Yeastar demo push verified per-user metric values
- [x] Docs updated; rollback = revert commits (settings are additive)

**Go-live note:** every connector activates by filling its endpoint/token
setting in the admin Settings screen — no code change. Remaining blueprint
scope (§23): AI features only.
