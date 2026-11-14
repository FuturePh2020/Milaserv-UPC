# Production readiness — hardening pass B (release candidate 1.0.0-rc.2)

> **Launch status: PUBLIC LAUNCH BLOCKED. Overall production readiness is about 5/10 — not 9.**
>
> - The owner's target of 9/10 is **not met**, and cannot honestly be met from this environment.
> - **Missing:** a tested real HTTPS environment, a verified real off-server backup, a restore drill on a real
>   separate target, a working authorized alert path, and seven owner decisions.
> - **What reached about 9:** the software package itself, on local evidence.
> - No score here was raised because a target was requested.

Date: 2026-11-13/14 UTC. Environment: one development container (4 vCPU Xeon 2.1 GHz, 16 GB, Docker 29.9.2). It was
restarted by the platform several times during the pass. Everything below is **LOCAL** evidence unless marked HOSTED.

---

## 1. Weaknesses and blockers (first)
| # | Blocker | What closes it |
|---|---|---|
| B-1 | Exact portal stock can be inferred by probing | Owner decision DR-1 (A: allocate portal stock deliberately; B: redesign) |
| B-2 | No real off-server backup exists | Owner input DR-4 → configure → download-verified copy observed |
| B-3 | No real host, domain, public certificate or renewal tested | Owner input DR-5 → `deploy/hosted-smoke.sh` + browser checks on the domain |
| B-4 | RPO / RTO not approved | Owner decision DR-2 |
| B-5 | Distributed sign-in DoS: new/cleared browsers can still be locked out ≤ 15 min; queue saturation gives 503 | Owner decision DR-3 (also confirm or revert the device cookie) |
| B-6 | Default proxy (Caddy 2.11.9) has HIGH advisories with no official fix | Owner decision DR-6 — a scanner-clean Traefik alternative is ready |
| B-7 | No authorized alert recipient; real delivery untested | Owner provides a webhook and permission for one test |
| — | Pilot scope, owners and pause criteria unnamed | Owner decision DR-7 (`PILOT_PLAN.md`) |

**Other weaknesses:**
- **No independent security review.** All testing was done by the implementing agent. An independent review is
  recommended before real trader data is exposed.
- **Browser coverage:** Chromium only, including the mobile emulation. No WebKit/Safari or Firefox, and no real
  phone.
- **Spreadsheets:** tested with LibreOffice Calc. Microsoft Excel is NOT RUN.
- **Operators:** the operator workflows were executed by scripts, not by the human operator who will run the
  system.
- **Backup during load:** the two pass-B load runs did not include a backup, because of an error in my test script
  (wrong working directory). Backup-during-traffic evidence remains the stage-18 run, which did not go through the
  proxy.

## 2. Fixes and additions completed in this pass
| Item | Result |
|---|---|
| **Fix A — dummy-hash enumeration** (commit `71e2dd1`) | Present and covered by 4 regression tests that fail on the old code |
| **Device cookie** against distributed username lockout | A known browser signs in while 6 attacking sources lock the username. Forged, cross-user and expired cookies are refused. A stolen cookie is bounded: 9 further guesses. **This is a policy change, awaiting owner confirmation (DR-3).** |
| **Alerting** | `ops:watch` plus a `monitor` service: one webhook message per status change, a daily reminder, bounded retries, URL kept in a secret file. Tested against a loopback receiver only |
| **Proxy** | No newer official Caddy exists (rechecked). **Traefik 3.7.19** was added as a tested alternative: Trivy 0 critical / 0 high; govulncheck "No vulnerabilities found" |
| **Hosted smoke test** | `deploy/hosted-smoke.sh` (17 checks, verification always on); rehearsed locally on both proxies |
| **Touch target** | Small buttons were 38 px high on a phone; now 44 px on touch screens |
| **Decision pack** | DR-1 concrete A/B comparison; DR-3 and DR-6 updated; DR-7 pilot added |

## 3. Proxy advisories (rechecked 2026-11-13/14)
- **Caddy:** `caddy:2.11.9-alpine@sha256:003a9780…` is still the newest official release, on Docker Hub and on the Go
  module proxy. `go-jose/v3` v3.0.5 is still the newest v3.
  - The findings table in `FINAL_ACCEPTANCE_18.md` §3 is unchanged: the one reachable path (`request_body` →
    GO-2026-6859) stays removed.
  - Residual: 2 HIGH (go-jose v3 JWK DoS; x/net/html DoS), in code our configuration does not load.
  - **Remaining uncertainty:** that conclusion is a review of the configuration and import graph, not exploit
    testing.
- **Alternatives scanned** (Trivy 0.76.2, DB updated 2026-11-13 12:56 UTC):

| Image | Result | Decision |
|---|---|---|
| `nginx:stable-alpine@sha256:901e593c…` | 3 HIGH (libxslt), 2 MEDIUM | Rejected |
| `haproxy:lts-alpine@sha256:b9fe316f…` (3.4.7) | 0 HIGH, 1 MEDIUM | Not evaluated further |
| `traefik:v3.7.19@sha256:b7b1b31e…` (Go 1.27.4) | 0 HIGH, 1 MEDIUM; govulncheck 1.9.0 binary mode: no vulnerabilities | **Evaluated and tested** |

- **Traefik compatibility, verified locally** with a private test CA and verification on:

| Check | Result |
|---|---|
| TLS 1.3 verified; unknown SNI | Handshake refused for an unknown SNI |
| HTTP → HTTPS | 301 |
| Foreign Host header | 404 (never reaches the app) |
| Declared and chunked 3.5 MB bodies | 413; a 2.5 MB body gets the app's own 413 |
| HSTS and CSP | HSTS intact; exactly one CSP |
| Forged `X-Forwarded-For` / `X-Real-IP` / `Forwarded` ×7 | Counted as one source (6th = 429) |
| Access log | No cookies, tokens, query strings or forged addresses |
| App port | Unreachable from the host |
| Container | Read-only, capabilities dropped |
| Six HTTPS browser suites | 87, 126, 44, 67, 19, 19 — all pass |
| Smoke script | 17/17 |
| Load run | See §5 |

- **Not verified for either proxy:** ACME issuance and renewal (needs a real domain).
- **Choice is the owner's (DR-6).** Caddy stays the default in `compose.yaml` until then. B-6 stays visible.

## 4. Live readiness checklist
Status: PASS / FAIL / NOT RUN. Env: UNIT (test suite), STACK (local Docker stack, private CA), HOSTED (real server).

### Application correctness
| Item | Evidence | Env | Status |
|---|---|---|---|
| Typecheck, build, full suite | `npm run check` 626/626; clean copy and `npm audit`: §6 | UNIT | PASS |
| Business flows on a clean install | `accept18` on rc.2: §6 | STACK | PASS |
| Upgrade from schema 7, rollback | `upgrade18` 36/36 (stage 18; no schema change since) | STACK | PASS |
| Browser journeys | 6 suites on rc.2 through Caddy and through Traefik: 362 checks each | STACK | PASS (Chromium) |
| Exactly-once writes and consistency under load | §5; `db:check` clean | STACK | PASS |

### Authentication and authorization
| Item | Evidence | Env | Status |
|---|---|---|---|
| Fix A regression | 4 tests | UNIT | PASS |
| Limits, refunds, generic errors, TOTP, session rotation | Auth suites | UNIT | PASS |
| Distributed lockout: known browser stays usable | 2 attacker/victim tests | UNIT | PASS |
| Distributed lockout: new browser | Same test: still refused 429 | UNIT | **Residual (open, DR-3)** |
| Role and merchant separation | HTTP matrix; `accept18` separation section | UNIT, STACK | PASS |
| Secure cookies, CSRF, MFA, logout on the real domain | — | HOSTED | NOT RUN |
| Independent review | — | — | NOT RUN |

### Infrastructure / TLS
| Item | Evidence | Env | Status |
|---|---|---|---|
| Hardened image and stack; second instance refused; persistence | Stages 17–18 | STACK | PASS |
| Proxy rules (two proxies) | §3; smoke rehearsal 17/17 each | STACK | PASS |
| Public DNS, trusted certificate, renewal | — | HOSTED | NOT RUN |
| Proxy-only access and real source addresses on the host | — | HOSTED | NOT RUN |
| Host reboot and persistence | Docker daemon restart only (several unplanned in this pass; data intact) | STACK | NOT RUN on a host |

### Backup and disaster recovery
| Item | Evidence | Env | Status |
|---|---|---|---|
| Encrypted verified backup; scheduler; retention; failure handling | `ops.test.ts`; stage 17 | UNIT, STACK | PASS |
| Restore to an isolated target; recovery mode; stale operations refused; reopen | `accept18` restore section; stage-17 drill | STACK | PASS |
| Real off-server copy, download-verified | — | HOSTED | NOT RUN |
| Versioning / immutability | — | HOSTED | NOT RUN |
| Drill on a separate machine with measured download and reconciliation | — | HOSTED | NOT RUN |
| RPO / RTO approved | — | — | PENDING (DR-2) |
| Secret custody assigned | — | — | PENDING (DR-4) |

### Monitoring and incident response
| Item | Evidence | Env | Status |
|---|---|---|---|
| Status checks: writes, consistency, backups, off-server age, scheduler, plaintext staging, disk, certificate, login failures | `ops:status` tests | UNIT | PASS |
| Change-based alerts, reminder, bounded retries, no secret leakage | 2 tests, loopback receiver | UNIT | PASS (local) |
| `monitor` service runs non-root and logs without a webhook | `accept18` monitor section | STACK | PASS |
| Delivery to a real authorized channel | — | HOSTED | NOT RUN |
| External uptime check (host down) | — | HOSTED | NOT RUN |
| 429/503 and CPU/memory alerts | Not implemented; log / `docker stats` procedure documented | — | NOT RUN (gap) |
| Named responders | Table in `MAINTENANCE_AR.md` §4 is empty | — | PENDING |
| No restart loops in recovery/hold | Liveness-only health check; the watcher never remediates | STACK | PASS |

### Capacity and resilience
| Item | Evidence | Env | Status |
|---|---|---|---|
| Mixed load through the proxy over TLS, one real source address per user | §5 | STACK | PASS (local observation) |
| Graceful restart; disk full; destination down; second instance | Stages 17–18 | STACK | PASS |
| Backup during load through the proxy | Script error in this pass | STACK | NOT RUN (stage-18 direct run only) |
| Intended host hardware | — | HOSTED | NOT RUN |

### Operator and user acceptance
| Item | Evidence | Env | Status |
|---|---|---|---|
| Mobile Chromium (Pixel 7 emulation): sign-in, catalog, checkout, order; no horizontal overflow; 44 px targets | `ua19` | STACK | PASS |
| Keyboard-only sign-in and add to cart; visible focus | `ua19` | STACK | PASS |
| Arabic print: A4 PDF, embedded Arabic font, correct RTL shaping (checked by eye on the rendered page) | `ua19` | STACK | PASS |
| Spreadsheet round-trip: LibreOffice Calc 24.2 | `ua19`: no formula cell from an `=HYPERLINK(…)` name; ids and versions identical; re-imported file commits | STACK | PASS |
| Microsoft Excel; another browser engine; real devices | Not available here | — | NOT RUN |
| Operator tasks (approve, import, fulfil/cancel, reconcile, backups, account recovery) | Scripted in `accept18`; instructions in the Arabic guides | STACK | PASS (scripted); human dry-run NOT RUN |

### Residual business decisions
DR-1 to DR-7: all **PENDING**. Nothing was approved on the owner's behalf.

## 5. Load through the proxy (local observation, not a capacity promise)
- **Setup:**
  - rc.2 Compose stack; app limited to 2 CPU / 1 GiB;
  - 59 MB database: 2 000 products, 20 000 historical orders;
  - clients connect over TLS to the proxy, each of 71 virtual users from its **own source address**. The audit log
    recorded 71 distinct sources, and no forwarding header was sent by clients.
- **Phases:** a login burst; 60 s of browsing; 95 s mixed. The mixed phase had 50 browsing/quoting traders, 20
  ordering traders, one administrator at human pace and a 100-row CSV import.

| Metric | Through Traefik | Through Caddy |
|---|---|---|
| Login burst (70 at once) | 70/70 in 13.8 s; 237 × 503 retried; 0 × 429 | 70/70 in 12.7 s; 211 × 503; 0 × 429 |
| Browsing | 195 req/s; 0 errors; p95 12 ms; p99 29 ms | 196 req/s; 0 errors; p95 12 ms; p99 25 ms |
| Mixed | 171 req/s; 0 non-2xx; read p95 111 ms | 172 req/s; 0 non-2xx; read p95 109 ms |
| Orders created / found exactly once | 367 / 367 | 363 / 363 |
| Admin transitions; import | 152; 100 rows committed once | 152; 100 rows committed once |
| Duplicate keys; stock-rule violations; `db:check` | 0; 0; clean | 0; 0; clean |
| Peak app CPU / memory | 199 % / 307 MiB | 199 % / 308 MiB |
| Peak proxy CPU / memory | 19 % / 43 MiB | 14 % / 26 MiB |

- **What limits throughput:** the app's two CPUs, which saturate during sign-in bursts (password hashing). The
  proxy is not the limit.
- **What this does not say:** these numbers do not translate into a number of concurrent traders. The intended
  host is unmeasured.

## 6. Final verification of rc.2
| Check | Result |
|---|---|
| `npm run check` (working tree) | 626/626 |
| Clean copy: `npm ci` + typecheck + tests | PASS — 626/626 in a fresh copy (one copy this pass, not three) |
| `npm audit` | 0 vulnerabilities |
| Image `alkhayr-b2b:1.0.0-rc.2` | Id `sha256:b91a7ab4efb2706c509f246fe3c6ce95585cb8fc54e8ae97f0dd1fc74901575f`; `/app/dist` manifest `1114e6db…7c6916` |
| Trivy, app image | 0 critical / 0 high (39 medium, 12 low, 2 unknown in base packages) |
| `accept18` clean install on rc.2 (now also creates the alert secret file and starts `monitor`) | 125/125 |
| Browser suites on rc.2 | Caddy: 87/126/44/67/19/19. Traefik: 87/126/44/67/19/19 |
| `ua19` | 20/20 |
| Smoke rehearsal | 17/17 on each proxy |

## 7. Scores (evidence-based)
| Area | Score | Why it is not higher |
|---|---|---|
| Application correctness | **9** | Chromium only; no independent review |
| Authentication and authorization | **8** | Residual distributed DoS; device-cookie policy unconfirmed; no independent test; nothing verified on a real domain |
| Infrastructure / TLS | **4** | Packaging and two proxies proven locally only: no host, public certificate, renewal or reboot |
| Backup and disaster recovery | **4** | Mechanics and drills proven locally; no real off-server copy, no separate-machine drill, RPO/RTO unapproved |
| Monitoring and incident response | **5** | Alerting built and tested locally; no recipient, no real delivery, no external uptime check, responders unnamed |
| Capacity and resilience | **6** | Through-proxy load is local; intended host unmeasured |
| Operator and user acceptance | **6** | Scripted, not a human operator; no Excel, second engine or real device |
| Residual business decisions | **2** | Seven decisions pending |
| **Overall production readiness** | **≈ 5** | Capped by the missing hosted evidence and decisions |
| *Local release package (software only)* | *≈ 9* | *Local evidence; not a production score* |

**What would move the overall score to 9+:**
- a real host with public HTTPS that passes the smoke script and the browser checks;
- a download-verified off-server backup, and a restore drill on a separate machine;
- one authorized alert received, plus an external uptime check;
- DR-1…DR-7 answered;
- ideally an independent security review.

## 8. Exact owner inputs and decisions needed
- **Inputs** (`DEPLOYMENT_INPUTS.md`): server, domain and DNS, ACME e-mail, off-server bucket and scoped key, named
  secret holders, an https webhook with permission for one test, an external uptime check. Secrets go into files on
  the server, never into chat.
- **Decisions** (`OWNER_DECISIONS_18.md`):
  - DR-1: A or B.
  - DR-2: RPO, RTO and backup times.
  - DR-3: keep or revert the device cookie, and how to treat the residual.
  - DR-4: off-server storage and custody.
  - DR-5: host and domain.
  - DR-6: Traefik or Caddy.
  - DR-7: the pilot.

## 9. Launch status
- **Release candidate:** 1.0.0-rc.2 is a reviewable release candidate for hosted staging.
- **Not deployed.** No pilot was started and no alert was sent.
- **Public launch remains blocked,** and is the owner's explicit decision.
