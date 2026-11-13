# Known limitations and open blockers — 1.0.0-rc.1

## Open release blockers
| # | Blocker | Decision / input |
|---|---|---|
| B-1 | Exact available stock can be inferred by quote or order probing | DR-1 (pending) |
| B-2 | No verified copy on real off-server storage | DR-4 (inputs missing) |
| B-3 | No hosted environment, public DNS or publicly trusted certificate tested | DR-5 (inputs missing) |
| B-4 | RPO / RTO unapproved; transfer and reconciliation times unmeasured | DR-2 (pending) |
| B-5 | Distributed sign-in DoS residual (reduced in stage 18) | DR-3 (pending) |
| B-6 | Caddy 2.11.9 image carries HIGH advisories without an official fixed build (reachable one mitigated) | DR-6 (pending) |

## Product limitations (by design or out of scope)
- **Out of scope:**
  - no accounting, invoices, payments, returns after shipment or partial fulfilment;
  - no e-mail/SMS/WhatsApp messages;
  - no public password reset (recovery is by the operator on the server).
- **Inventory:** the portal's stock is independent; sales in other programs must be recorded as adjustments.
- **Imports:** there is no "undo import". Corrections are new traceable imports or adjustments.
- **Rate limits are shared per IP:**
  - 300 API requests per minute;
  - 20 sign-in attempts per 15 min;
  - 5 per (source, username).

  Many users behind one office NAT share them.
- **Pace:** one administrator processing orders very fast (> about 5 requests/s) can hit the per-IP limit.
- **Single instance:** one application instance only, SQLite on local disk. No zero-downtime upgrade (about 1–2 s
  interruption measured locally, with one failed probe).
- **Tax:** the tax and shipping configuration is the business's responsibility; the pilot defaults are 0.

## Verification limitations
- **Browsers:** Chromium only. Accessibility checked by automated rules (axe), not a manual screen-reader review.
- **Load:**
  - synthetic data on a development container, through the Docker bridge, not through the proxy;
  - no number of supported traders is claimed;
  - load through the proxy from many real addresses is NOT RUN.
- **Upgrades:** only the upgrade from schema 7 (stage 15) is tested.
- **Proxy advisories:** applicability rests on configuration and import-graph review plus binary symbol presence.
  There was no exploit testing and no independent penetration test.
- **Not in the evidence:**
  - the Docker host's own hardening (kernel, firewall, OS updates, disk encryption);
  - the provider network;
  - real certificate renewal.
- **`db:check`:** needs the data volume mounted read-write (SQLite WAL shared memory), even though it writes nothing.

## UI notes
- After a refused change, some admin screens show the previous record with a "refreshing" indicator until the
  current one loads. Any action on the stale record is refused by the server (version check).
- The merchant status screen now disables its controls until the current record is shown (stage 18).
- A browser tab left open across an upgrade keeps its old script; compatibility was verified for the stage-15
  client only.
