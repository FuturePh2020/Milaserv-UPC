# Owner decision pack — stage 18, updated by hardening pass B (supersedes the open items of RELEASE_DECISIONS_17)

These records prepare decisions. **None has been made on the owner's behalf.** Every approval status is **PENDING**.
The public launch stays blocked until each one is answered in writing and the hosted checks pass
(`DEPLOYMENT_INPUTS.md`).

| # | Topic | Approval status |
|---|---|---|
| DR-1 | Stock inference by quote probing | ☐ PENDING |
| DR-2 | RPO / RTO and backup frequency | ☐ PENDING |
| DR-3 | Distributed sign-in denial of service | ☐ PENDING |
| DR-4 | Off-server storage and secret custody | ☐ PENDING (inputs missing) |
| DR-5 | Host and domain | ☐ PENDING (inputs missing) |
| DR-6 | Proxy: residual Caddy advisories, or switch to the tested Traefik alternative | ☐ PENDING |
| DR-7 | Limited pilot: trader group, allocated stock, owners and pause criteria (`PILOT_PLAN.md`) | ☐ PENDING |

---

## DR-1 — Stock inference

**What was demonstrated (stage 16, unit-level reproduction):** traders never receive stock counts, only three
availability states. By asking the quote screen for different carton quantities, an approved trader recovered the
**exact** available stock (7 431 cartons) in **17 quote requests**. The limit is 60 quotes per 10 minutes per
merchant, so this takes minutes.

**Mitigation is not elimination:**
- Lowering the quote limit or removing the availability check from quotes only **slows** inference.
- Order creation itself refuses quantities above the available stock (`INSUFFICIENT_STOCK`). As long as orders are
  accepted or refused by available quantity, a trader can still probe by submitting orders (limit 30 per 10 minutes).
- Removing the quote check alone therefore does **not** prevent inference.

| Option | Consequence of choosing it |
|---|---|
| **A. Accept and document** | No change. A determined approved trader can learn exact available stock per product. The exposure is limited to approved accounts, rate-limited, and visible in the request logs. |
| **B. Commission a business-rule redesign** (separate scoped stage) | E.g. accept orders beyond stock as "pending availability" and decide at confirmation; or cap the quantity a single order may test. This changes the ordering rules, reservations, the UI and the tests, and needs its own review and sign-off. It removes or weakens the inference only when order acceptance stops depending on stock. |

### Concrete comparison (pass B)

**Option A — accept inference, but only for stock explicitly allocated to the portal.**
- **What you do:**
  - Keep in the portal only the quantity you are willing to sell there, set with an inventory correction ("set
    total"). Your full warehouse stock stays outside.
  - Refill as it sells.
- **What a probing trader learns:** the portal allocation, not the warehouse total.
- **What changes for customers:** nothing.
- **Operational cost:** someone must top up the allocation; an order above the allocation is refused even if the
  warehouse has more.
- **Software change:** none. The procedure is in `OWNER_QUICKSTART_AR.md` §3.

**Option B — redesign availability validation and ordering.** These are the rules and screens that would change:

| Today | Under B (one possible design) |
|---|---|
| The quote and the order refuse a quantity above available stock (`INSUFFICIENT_STOCK`) | Quote and order accept any quantity up to a per-line cap; the trader is told "subject to confirmation" |
| A created order means the quantity was available at that moment | A created order is a request; the administrator confirms fully, or cancels, or (new rule) proposes a reduced quantity |
| Confirmation fails only if stock changed meanwhile | Confirmation failures become routine and need a customer-communication step |
| Three availability labels driven by real stock | Labels must also be reconsidered: "low stock" itself leaks the threshold |
| No partial fulfilment (out of scope) | Either stays out of scope (more cancellations) or enters scope (new allocation rules, UI and tests) |

- **Affected areas:** order rules (`evaluateOrderLines`), fulfilment, reports, the trader's checkout messages, admin
  order screens, tests and documents. It needs its own reviewed stage.
- **What does not work:** removing the check from the quote alone does not help, because the order would still
  reveal it.
- **What limits do:** request limits slow probing; they do not prevent it. Today that is 60 quotes and 30 orders per
  10 minutes per merchant; 17 probes sufficed.

**Recommended next action:** decide whether competitors among your approved traders make exact stock levels
sensitive. If they do not, A with a deliberate portal allocation is reasonable and costs nothing to build. If they do,
schedule B before launch; B cannot be done safely as a quick patch. A pilot can run under A with a small allocation.

**Owner decision:** ☐ A ☐ B ☐ other: ________ Name / date: ________

---

## DR-2 — Recovery point (RPO), recovery time (RTO) and backup frequency

**Meaning, with examples:**
- **RPO = how much recent work you can afford to lose.**
  - With one daily backup at 02:17, a disk lost at 18:00 loses everything since 02:17: about 16 hours of orders,
    confirmations and stock changes. Those must be re-entered from paper, phone or WhatsApp records.
  - Twice daily (`02:17,14:17`) bounds the loss to about 12 hours.
- **RTO = how long traders can be unable to order.** This includes:
  - getting a replacement server;
  - DNS and certificate issuance;
  - retrieving the secrets from custody;
  - restoring;
  - the business reconciliation before writes reopen.
- **Frequency is not protection by itself.** A backup that exists only on the same server is lost with that server.
  Only a copy verified off-server (DR-4) protects against disk or server loss. Today **no real off-server copy
  exists**.

**Measured locally (synthetic data, development container; not a promise):**

| Step | Time |
|---|---|
| Backup job on a 61 MB database (stage 17) | 7.1 s |
| Online backup during mixed traffic, 59 MB (stage 18 `load18`) | 3.9 s |
| Copy → verify → restore → serving read-only in recovery mode (stage 18 `accept18`, small DB) | 3.0 s |
| … including `db:check` and the scripted reopen | 4.4 s |
| Same steps with a 61 MB DB (stage 17) | 6.3 s / 9.1 s |
| **Not measured** | Off-server download time, provisioning, DNS/TLS, secret retrieval, human reconciliation |

| Option | Consequence of accepting |
|---|---|
| Keep 24 h RPO (one nightly backup) / 2 h RTO | Simplest. Up to a day of re-entry after a disk loss. 2 h is realistic only if a replacement server and secrets are ready in advance. |
| 12 h RPO (two backups daily) | Twice the backup jobs (seconds each at this size), less re-entry. |
| Shorter RPO (e.g. hourly) | More storage and transfer; still bounded by the off-server copy succeeding. |

**Recommended next action:** choose the RPO by how many hours of orders the team can re-enter from other records.
Choose the RTO after the hosting provider confirms how fast a replacement server can be provisioned. Then set
`BACKUP_SCHEDULE` and rehearse once on the real host.

**Owner decision:** RPO ____ h · RTO ____ h · backup times ________ · Name / date: ________

---

## DR-3 — Distributed sign-in denial of service

**Current limits:**
- 20 attempts per source per 15 min;
- 5 per (source, username);
- 30 per username across all sources;
- at most 2 concurrent credential checks per source;
- a bounded hashing queue (busy → 503).

**Improved in stage 18:**
- A request refused for capacity (503 or the per-source concurrency limit) no longer spends the user's attempts.
- Before the fix, a burst of 70 logins left 21 users locked out for 15 min (429 on 525 responses).
- After it, 70 of 70 signed in within 13.1 s, with retries and no lockouts.

**Added in pass B — device cookie (implemented and tested; no account bypass):**
- After a successful sign-in the browser keeps a signed, 90-day "this browser signed in before" cookie.
- A sign-in from such a browser is no longer blocked by the account-wide limit that attackers with many addresses
  can exhaust. It keeps the per-source limits and gets its own limit of 10 attempts per 15 minutes per cookie.
- **Test** (attacker/victim from distinct sources): after 6 attacking addresses locked a username, the victim's
  known browser signed in, even from a new address. A new browser, a forged cookie and a cookie for another
  username were all refused. A stolen cookie gave 9 more guesses, then nothing.
- **This changes the previously agreed policy:** a new long-lived cookie, and the 30-per-username backstop no
  longer bounds attempts from browsers holding a valid cookie.
- **Your choice:** if you prefer the old policy, the change can be disabled by reverting one commit. Please confirm
  or reject it below.

**Residual (not fixed, not accepted on your behalf):**
- A user on a **new or cleared browser** can still be locked out for up to 15 minutes while an attack lasts
  (operator remedy: wait, or the user uses their usual device).
- ≥ 6 independent addresses (or IPv6 /64 prefixes) can make **one** username refuse sign-in for up to 15 minutes,
  with 30 wrong attempts.
- Many sources together can keep the hashing queue full, so sign-ins get 503 while the attack lasts.
- Users behind one shared NAT share the per-source limits; the per-IP limit is 300 API requests per minute.

| Option | Consequence |
|---|---|
| Accept with monitoring | Watch `auth.login_failed` per hour (`ops:status`) and 429/503 rates in proxy logs; the operator can revoke sessions, contact the targeted trader, and wait out the 15-minute window. |
| Provider-level DDoS / rate filtering | Provider- and cost-dependent; not configured. |
| Restrict administrator sign-in to known networks | Needs a reviewed design (one login endpoint serves both roles). |

**Recommended next action:** accept-with-monitoring is proportionate for a closed B2B portal *if* an alert channel
exists (DR-5 and the monitoring item). Otherwise request provider filtering.

**Owner decision:**
- Device cookie: ☐ keep ☐ revert
- Residual: ☐ accept with monitoring ☐ provider protection ☐ admin network restriction design

Name / date: ________

---

## DR-4 — Off-server storage and secret custody (blocker B-2)

**Prepared and tested against a LOCAL S3-compatible server only** (that is not disaster protection):
- upload, metadata check, download, SHA-256 check, decryption and consistency verification;
- failure handling for unreachable, 403, 5xx, corrupted and wrong-size responses.

**Needed (do NOT send secrets in chat, e-mail or documents):**
1. **Provider and account** that offers an S3-compatible API.
2. **A bucket** in a different region or provider than the server.
3. **An access key limited to that bucket/prefix:** read and write, preferably without delete. It is written by the
   operator into `deploy/secrets/offsite_access_key` and `offsite_secret_key` (owner uid 1000, mode 0400).
4. **Decisions on versioning / Object Lock.** Immutability is **not** claimed until configured and tested.
5. **Custody, each in a different place:**
   - a copy of `app_secret`;
   - a copy of `backup.key`;
   - the storage credentials.

   Name who holds each one and how two people can recover them.
6. **A first real verified copy:** `ops:status` must show `offsite_copy` verified. Then do a restore on a separate
   machine.

| Choice | Consequence |
|---|---|
| Configure now | Closes B-2 after a download-verified copy is observed. |
| Launch without it | A single disk or server loss loses all data since the last copy taken by other means. **Not recommended**, and the launch gate stays closed. |

**Owner decision / inputs supplied:** ________ Name / date: ________

---

## DR-5 — Host and domain (blocker B-3)

**Supported infrastructure:**
- Linux x86_64;
- a recent Docker Engine with Compose v2;
- a persistent **local** disk (not NFS/SMB);
- ports 80 and 443 reachable from the internet;
- NTP time sync;
- suggested starting size 2 vCPU and 2–4 GB RAM, plus disk for twice the database plus 14 local backups.

That size is a starting point, not a capacity measurement. No plan or price is recommended here, because none was
verified.

**Exact missing inputs:**
1. Server access for the operator (SSH user, sudo) and who administers OS updates and the firewall.
2. The public host name (e.g. `portal.<your-domain>`).
3. DNS access to create the A/AAAA records (optionally CAA).
4. An ACME contact e-mail.
5. Confirmation that real trader data may be placed there (data location and privacy).

**Owner decision / inputs supplied:** ________ Name / date: ________

---

## DR-6 — Proxy: residual Caddy advisories or the tested Traefik alternative — updated in pass B

Full analysis: `FINAL_ACCEPTANCE_18.md` §3.

**Summary:**
- The pinned image is the newest official Caddy release (2.11.9; Go 1.27.3).
- **One finding was reachable in our configuration**: GO-2026-6859 / CVE-2026-97054, an HTTP/1 server crash
  through `MaxBytesReader`, used by the `request_body` directive.
- **It was mitigated in stage 18** by removing that directive. Declared bodies of 3 000 000 bytes or more are
  refused by a header check; the application enforces the exact limits.
- The remaining HIGH findings, go-jose v3 (JWK DoS, **no fixed v3 release**) and x/net/html (DoS), are in code our
  configuration does not load or route to (Caddy's internal CA / CLI help). That conclusion comes from a
  configuration and import-graph review, not from a runtime proof.

| Option | Consequence |
|---|---|
| Accept the residual until an official Caddy release built with Go ≥ 1.27.4, x/net ≥ 0.62 and a fixed go-jose ships | No change now; the operator re-scans monthly and upgrades when available (`MAINTENANCE_AR.md`). |
| Commission a reviewed custom Caddy build (xcaddy, newer Go) | Cleaner scan, but you take on maintaining a non-official proxy build; needs its own review and tests. |

| **Switch to Traefik 3.7.19** (official image, added in pass B as `deploy/compose.traefik.yaml`) | Scanner-clean today: Trivy 0 critical / 0 high, and govulncheck "No vulnerabilities found" (built with Go 1.27.4). Locally verified the same as Caddy: TLS, HTTP→HTTPS, unknown host refused, 413 for declared and chunked oversized bodies, forged forwarding headers ignored, no cookies or query strings in logs, and all six browser suites. **Differences:** unknown Host gets 404 instead of 421; client IPs appear unmasked in access logs; bodies up to 3 MB are buffered by the proxy; ACME uses TLS-ALPN-01 on port 443. **ACME issuance is NOT RUN for either proxy.** |

**Rechecked in pass B (2026-11-13/14):** no newer official Caddy than 2.11.9 exists, on Docker Hub or the Go module
proxy, and go-jose v3 still has no fixed release. Of the other official images, nginx stable-alpine has 3 HIGH
(libxslt) and HAProxy 3.4 LTS has 0 HIGH. HAProxy was not evaluated further.

**Recommended next action:** use **Traefik** for the hosted staging and pilot, because it removes the open advisories
without a custom build. Keep the Caddy configuration as the fallback. If you prefer Caddy, accept its residual
**with** the monthly re-scan duty and the rule never to enable `acme_server`, the admin API, `encode zstd` or
`request_body` without re-review.

**Owner decision:** ☐ Traefik ☐ Caddy with accepted residual ☐ commission custom build · Name / date: ________

---

## DR-7 — Limited pilot (new in pass B)

The proposal is in `PILOT_PLAN.md`: a small named trader group, an explicit stock allocation, named operational
owners, and pause criteria. A pilot still needs the hosted gates (real HTTPS, verified off-server backup, restore
drill, working alert path) and DR-1…DR-6 answered. **It does not start automatically.**

**Owner decision:** ☐ approve pilot as proposed ☐ approve with changes: ________ ☐ not now · Name / date: ________
