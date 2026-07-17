# Break Tracker & Team Live View — Module Specification v1.0

Source: blueprint §11 (Break Tracker & Workforce), Sprint 6 of §23.
Scope: exactly §11.1 (Session), §11.2 (Idle Detection), §11.3 (قواعد البريك).
Nothing is added beyond the blueprint; open points are flagged as assumptions
C1–C6 below.

## 1. Blueprint requirements (verbatim mapping)

| §    | Requirement                                                                                | Delivered as                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 11.1 | Start Session عند بدء العمل / End Session عند نهاية الشيفت                                 | `POST /breaks/session/start`, `POST /breaks/session/end`                                                     |
| 11.1 | حساب Active Time و Idle Time و Manual Breaks                                               | Per-session accumulated seconds, live-computed for the open period                                           |
| 11.1 | تسجيل بداية ونهاية كل فترة                                                                 | `WorkPeriod` rows (WORK / BREAK / IDLE) with startedAt/endedAt                                               |
| 11.2 | 5 دقائق بدون ماوس/كيبورد → Idle يبدأ من لحظة بداية عدم النشاط + تنبيه الموظف + تسجيل الحدث | Activity heartbeat + server-side transition backdated to lastActivityAt; in-app notification; timeline event |
| 11.2 | التوافق مع ضوابط الخصوصية والأمن وسياسات الأجهزة                                           | See §4 (privacy model, C1)                                                                                   |
| 11.3 | إظهار الرصيد المتبقي                                                                       | `GET /breaks/me` returns allowance / used / remaining minutes                                                |
| 11.3 | تحويل التجاوز إلى اللون الأحمر                                                             | Frontend renders negative remaining in red                                                                   |
| 11.3 | Notification للموظف والمشرف وفق الإعدادات                                                  | Overage notification to employee + team LEADER/MANAGER, gated by setting                                     |
| 11.3 | الحد الأقصى لعدد الموظفين في Break داخل نفس Team أو Task Group                             | Concurrency check on break start against `break.max_concurrent_per_team`                                     |
| 11.3 | Live Team View: Available / On Break / Idle / Offline                                      | `GET /breaks/live` + polling UI                                                                              |

## 2. Data model

```
WorkSession  (one per user per shift; at most one ACTIVE per user — partial unique index)
  userId, teamId (primary-team snapshot at start), status ACTIVE|ENDED,
  startedAt, endedAt, endReason MANUAL|AUTO,
  lastHeartbeatAt, lastActivityAt,
  activeSeconds, idleSeconds, breakSeconds   ← rolled up as periods close

WorkPeriod   (the §11.1 "فترة" record)
  sessionId, type WORK|BREAK|IDLE, startedAt, endedAt?
  A session always has exactly one open period while ACTIVE.
```

Why counters + periods: periods are the auditable truth (§11.1 requires
recording each period's start/end); the counters are a denormalized rollup so
`/breaks/me` and the live view never aggregate a whole day of rows per user.
The open period's elapsed time is added at read time.

Why a partial unique index (`WHERE status = 'ACTIVE'`): "one active session
per user" is a data invariant, not just service logic — enforced by Postgres
even under concurrent starts.

`teamId` is snapshotted at session start (same rationale as the ticket branch
supervisor snapshot, ADR-006): the live view and the concurrency rule apply to
the team the person was working under during that shift.

## 3. State machine

```
(no session) --start--> ACTIVE[WORK]
ACTIVE[WORK]  --break start-->  ACTIVE[BREAK]     (concurrency check here)
ACTIVE[BREAK] --break end---->  ACTIVE[WORK]
ACTIVE[WORK]  --no activity ≥ threshold--> ACTIVE[IDLE]   (backdated to lastActivityAt)
ACTIVE[IDLE]  --activity------> ACTIVE[WORK]
ACTIVE[*]     --end (manual or auto)--> ENDED     (open period closed)
```

- Starting a break while IDLE is allowed (closes IDLE, opens BREAK) — a person
  can be away and only then press the break button.
- Ending a session closes whatever period is open and finalizes counters.

## 4. Idle detection & privacy (§11.2)

Client side: the web app listens to `mousemove` / `keydown` (plus
`visibilitychange`) and keeps a single in-memory `lastActivityAt` timestamp.
While a session is ACTIVE it sends `POST /breaks/heartbeat { lastActivityAt }`
every `break.heartbeat_interval_seconds`. **No keystrokes, screen content,
window titles, or URLs are ever captured or transmitted — only the timestamp
of the most recent input.** That is the design answer to the §11.2 privacy
clause (C1).

Server side (authoritative):

- Heartbeat handler: if the open period is WORK and
  `now − lastActivityAt ≥ break.idle_threshold_seconds` (default 300 = the
  blueprint's five minutes) → close WORK at `lastActivityAt`, open IDLE at
  `lastActivityAt` (idle counted **from the start of inactivity**, exactly as
  §11.2 requires), notify the employee, record a timeline event.
- If the open period is IDLE and fresh activity arrives → close IDLE at the
  activity time, open WORK.
- Client timestamps are clamped to `[period start, now]` — a client can never
  fabricate past/future activity beyond its own session window.
- The sweeper (below) applies the same rule server-side, so idle is detected
  even if the client stops sending heartbeats while the tab stays open.

Offline: a session whose `lastHeartbeatAt` is older than
`break.offline_threshold_seconds` shows as **Offline** in the live view (the
tab was closed or the machine is off — the browser cannot report activity, C1).

## 5. Break rules (§11.3)

- **Allowance**: `break.daily_allowance_minutes` (SYSTEM default, overridable
  per DEPARTMENT/TEAM via the existing Settings engine — ADR-008). Used =
  sum of BREAK periods that started today (server day, C6). `/breaks/me`
  returns allowance/used/remaining; the UI shows remaining and renders
  overage in red.
- **Concurrency**: on break start, count open BREAK periods among ACTIVE
  sessions of the same team; if ≥ `break.max_concurrent_per_team`
  (team-overridable; 0 = unlimited) → 409 with a clear bilingual message.
- **Overage notification**: when a break ends (or the sweeper sees a running
  break) and today's total exceeds the allowance, notify the employee and the
  team's LEADER/MANAGER members once per day — only if
  `break.notify_on_overage` is true ("وفق الإعدادات").

## 6. Sweeper

`BreaksSweeperService`, same pattern as the SLA sweeper (in-process interval,
`BREAK_SWEEP_INTERVAL_SECONDS`, 0 = disabled for tests which call `sweep()`
directly; BullMQ remains the documented upgrade slot):

1. WORK periods whose session `lastActivityAt` is past the idle threshold →
   transition to IDLE (backdated) + notify + timeline.
2. Sessions with no heartbeat for `break.session_auto_end_hours` → auto-end
   with `endReason: AUTO` (C4) + timeline event.
3. Running breaks that crossed the allowance → overage notification (once/day).

## 7. Live Team View (§11.3)

`GET /breaks/live` — for each user in scope, derived state:

| State     | Condition                                                        |
| --------- | ---------------------------------------------------------------- |
| AVAILABLE | ACTIVE session, open WORK period, heartbeat fresh                |
| ON_BREAK  | ACTIVE session, open BREAK period                                |
| IDLE      | ACTIVE session, open IDLE period                                 |
| OFFLINE   | no ACTIVE session, or heartbeat older than the offline threshold |

Grouped by team; includes today's break used/remaining per member. The UI
polls every 15 s (C5 — WebSockets are the blueprint §20 later-phase item; the
endpoint shape will not change when transport upgrades).

## 8. Permissions (§19.1 model, existing engine)

| Key              | Meaning                                                          | Defaults                                                   |
| ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `break.track`    | Start/end own sessions & breaks, heartbeat, own summary          | All staff roles, MY_RECORDS                                |
| `break.viewTeam` | Live Team View + session history of others (data-scope filtered) | Supervisor MY_TEAM, Manager DEPARTMENT, Ops/Admin ALL_DATA |

Scope semantics for `break.viewTeam` reuse `RequestScope` exactly like
tickets: MY_TEAM = own teams' members, DEPARTMENT = department users, etc.
All mutations audit-log; session/idle/break events go to the Timeline engine
under `entityType: 'work_session'` (future timeline integration, rule 9).

## 9. API surface

```
POST /breaks/session/start            break.track
POST /breaks/session/end              break.track
POST /breaks/heartbeat                break.track   { lastActivityAt }
POST /breaks/break/start              break.track
POST /breaks/break/end                break.track
GET  /breaks/me                       break.track   → session, open period, counters, allowance
GET  /breaks/live                     break.viewTeam → teams → members → state + break usage
GET  /breaks/sessions?userId=&from=…  break.viewTeam → history with periods (scope-filtered)
```

## 10. Settings (seeded, category `breaks`)

| Key                              | Type    | Default | Blueprint basis                |
| -------------------------------- | ------- | ------- | ------------------------------ |
| break.idle_threshold_seconds     | NUMBER  | 300     | §11.2 "خمس دقائق"              |
| break.daily_allowance_minutes    | NUMBER  | 60      | §11.3 الرصيد (default C3)      |
| break.max_concurrent_per_team    | NUMBER  | 2       | §11.3 الحد الأقصى (default C3) |
| break.offline_threshold_seconds  | NUMBER  | 180     | Live view OFFLINE derivation   |
| break.notify_on_overage          | BOOLEAN | true    | §11.3 "وفق الإعدادات"          |
| break.heartbeat_interval_seconds | NUMBER  | 60      | client cadence                 |
| break.session_auto_end_hours     | NUMBER  | 12      | C4 hygiene                     |

## 11. Assumptions (flagged for approval)

- **C1 — Browser-based idle detection.** §11.2 mentions mouse/keyboard with a
  privacy/device-policy constraint. Detection therefore runs inside the web
  app only (input **timestamps**, never content), which means idle is
  observable only while the app is open; a closed tab reads as Offline. A
  native desktop agent would widen coverage but is a device-policy decision —
  slot reserved, out of scope here.
- **C2 — "Task Group".** §11.3 allows the concurrency cap per "Team أو Task
  Group", but Task Group is not defined anywhere else in the blueprint. The
  cap is enforced per Team now; because the cap is a Setting with TEAM-scope
  overrides, a task-group dimension can be added without schema changes.
- **C3 — Unquantified defaults.** The blueprint does not state the daily
  allowance or the concurrency cap values → configuration, not code:
  60 min/day and 2 per team as SYSTEM defaults, overridable per team.
- **C4 — Abandoned sessions.** A session whose client vanished would count
  Active Time forever; auto-end after 12 h (configurable) with `endReason:
AUTO` keeps §11.1 time accounting truthful.
- **C5 — Polling live view.** Real-time transport (WebSocket) is listed in
  the blueprint's later phases (§20); the live view polls every 15 s for now.
- **C6 — Allowance day boundary.** "الرصيد" is read as a per-day allowance,
  reset at server midnight.

## 12. Out of scope (per blueprint)

Shift scheduling/rosters, payroll export, per-break-type catalogs, native
desktop idle agent, WebSocket push — none are in §11; reports beyond the live
view arrive with §13 (Reports & Analytics) in a later sprint.
