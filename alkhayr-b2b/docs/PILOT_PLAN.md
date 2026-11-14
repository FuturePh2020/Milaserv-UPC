# Proposed limited pilot (NOT started; needs owner approval — DR-7)

A pilot is a controlled, reversible first use with real traders. It is not the public launch.

## Preconditions (all must be true first)
- **Hosted gates:** the hosted gates in `RELEASE_CHECKLIST.md` §B are PASS on the real host:
  - public HTTPS;
  - proxy-only access;
  - reboot persistence;
  - a verified off-server backup;
  - a restore drill on a separate machine;
  - one authorized test alert received.
- **Decisions:** DR-1…DR-6 are answered in writing (`OWNER_DECISIONS_18.md`).
- **Secrets:** production secrets are newly generated, and the custody holders are named.
- **Independent review:** an independent security review is recommended before real trader data is exposed. The
  implementing agent's own tests are not independent.

## Scope (to be filled in by the owner)
| Item | Proposal | Owner's value |
|---|---|---|
| Traders | 3–5 known, trusted traders, each approved individually | ________ |
| Catalog | 20–50 products | ________ |
| Stock | An explicit portal allocation per product ("set total"), small enough that exact inference is harmless (DR-1 option A) | ________ |
| Duration | 2–4 weeks | ________ |
| Order handling | Every order confirmed/cancelled within one working day | ________ |
| Money | Tax, shipping, minimum order configured and confirmed by the business | ________ |

## Named ownership (to be filled in)
| Role | Duty | Name |
|---|---|---|
| Business owner | Approves traders, decides pause/continue | ________ |
| Administrator(s) | Daily orders, stock allocation, corrections | ________ |
| Operator | `ops:status`/alerts daily, backups, updates, incidents | ________ |
| Secret holders (2) | Offline copies of `app_secret` and `backup.key`, kept separately | ________ |

## Daily routine during the pilot
- **Operator:** check the alert channel and `ops:status`. The off-server copy must be verified within the agreed RPO.
- **Administrator:** process pending orders; reconcile portal stock with the allocation.
- **Weekly:** `db:check`, review of failed sign-ins and 429/503 counts, a short note of trader feedback.

## Pause criteria (stop new orders; do not delete anything)
Pause by suspending the pilot traders or stopping the `proxy` service, then follow `MAINTENANCE_AR.md` §3, if any of
these happens:
- **Consistency:** a consistency failure, or an unplanned `writes: closed`.
- **Backups:** no verified off-server backup for longer than the agreed RPO.
- **Security:** suspected account compromise, or any report of one trader seeing another's data.
- **Order errors:** an order whose totals or stock effect cannot be explained from the ledger.
- **Availability:** repeated lockouts or unavailability reported by traders (see DR-3).
- **Vulnerabilities:** a critical or high advisory affecting a reachable component, with no mitigation.

## Exit
At the end, record:
- orders processed;
- incidents;
- restore-drill time on the real host;
- trader feedback.

Then the owner decides **in writing**: extend, widen, or stop. Public launch remains a separate decision.
