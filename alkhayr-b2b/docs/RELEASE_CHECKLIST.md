# Release checklist — 1.0.0-rc.2

**Legend:**
- **PASS / FAIL / NOT RUN / PENDING** (owner decision).
- **Env:** STACK = local production-like Docker stack with Caddy's LOCAL CA; HOSTED = the real server.

A launch to traders requires **every row in sections B and C to be PASS or approved**. Today they are not.

## A. Release package (local)
| Item | Env | Status |
|---|---|---|
| Typecheck, build, 618 tests; 3 clean copies | UNIT | PASS (`FINAL_ACCEPTANCE_18.md` §4) |
| `npm audit` 0 vulnerabilities | — | PASS |
| Image built from pinned base digests; non-root; read-only; caps dropped | STACK | PASS |
| App image scan 0 critical / 0 high | STACK | PASS |
| Proxy image scan reviewed; reachable finding mitigated | STACK | PASS (residual → DR-6) |
| Clean install from the guide (`accept18`, 123 checks) | STACK | PASS |
| Upgrade from schema 7 + rollback (`upgrade18`) | STACK | PASS |
| HTTPS browser regressions (6 suites) | STACK | PASS |
| Backup → isolated restore → recovery mode → reopen; stale operations refused | STACK | PASS |
| Bounded mixed load + consistency afterwards | STACK | PASS (local observation only; through both proxies in pass B) |
| Fix A (dummy-hash enumeration) and pass B (device cookie, alert watcher, Traefik option) regression | UNIT + STACK | PASS (`READINESS_B.md`) |
| Mobile emulation, keyboard-only sign-in, Arabic print PDF, LibreOffice round-trip | STACK | PASS (Chromium + LibreOffice only) |
| Alert delivery to a LOCAL test receiver | UNIT | PASS (not a real recipient) |

## B. Hosted technical gates
| Item | Env | Status |
|---|---|---|
| Public DNS + publicly trusted certificate (ACME) + renewal configured | HOSTED | NOT RUN |
| Secure cookies, CSRF/Origin, account switching on the real domain | HOSTED | NOT RUN |
| App reachable only through the proxy; real client addresses in the logs | HOSTED | NOT RUN |
| Persistent local disk; non-root permissions; reboot → services return, data intact | HOSTED | NOT RUN |
| Real off-server copy: upload → download → decrypt → consistency (`offsite_copy` verified) | HOSTED | NOT RUN |
| Restore drill on a separate machine from the downloaded copy, times recorded | HOSTED | NOT RUN |
| `deploy/hosted-smoke.sh <domain>` from outside the server: all PASS | HOSTED | NOT RUN (rehearsed locally with a private CA) |
| Monitoring: webhook configured, `ops:alert-test` authorized and the message received; external uptime check | HOSTED | NOT RUN |
| Independent security review (recommended) | — | NOT RUN |
| Production secrets newly generated; custody holders named | HOSTED | NOT RUN |

## C. Owner decisions
| Item | Status |
|---|---|
| DR-1 stock inference | PENDING |
| DR-2 RPO / RTO / backup times | PENDING |
| DR-3 distributed sign-in DoS | PENDING |
| DR-4 off-server storage + custody | PENDING (inputs missing) |
| DR-5 host + domain | PENDING (inputs missing) |
| DR-6 proxy choice (Traefik, or Caddy with accepted residual) | PENDING |
| DR-7 limited pilot scope, owners, pause criteria | PENDING |
| Tax, shipping and minimum order configured by the business | PENDING |

## D. Launch
| Item | Status |
|---|---|
| Business launch approval (owner, in writing) | **NOT GIVEN — launch blocked** |
