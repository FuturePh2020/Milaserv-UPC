# Stage 17 — Decisions required from the owner before a public launch

> **Superseded for decision-making by [`OWNER_DECISIONS_18.md`](OWNER_DECISIONS_18.md)** (stage 18: updated evidence, DR-6 added). Kept as the stage-17 record; nothing here was approved.

These records **prepare** decisions; they do **not** make them. Nothing here is accepted on the owner's behalf.
Until each one is answered (and B-2/B-3 are closed), the portal must not be opened to traders.

---

## DR-1 (blocker B-1) — Stock availability inference

**Facts (measured, stage 16):**
- Traders never receive stock quantities. They see only three availability states.
- By trying different carton quantities in the quote screen, a trader recovered the exact available stock
  (7 431 cartons) with **17 quote requests**. The per-merchant limit is 60 quotes per 10 minutes, so this takes
  minutes, not days.
- Reducing the rate limit only slows this down. **No rate limit removes binary-search inference** while orders
  for a requested quantity are accepted or refused based on the stock.

**Options (choose one, or propose another):**

| Option | Effect | Cost |
|---|---|---|
| A. Accept as a documented business trade-off | Current behaviour; exact stock can be inferred by a determined approved trader | None now; competitive information exposure |
| B. Commission a separately reviewed change to quote/order behaviour (e.g. accept orders beyond stock as "pending availability", or cap the quantity a single quote/order may test) | Removes or weakens the inference | Changes ordering rules and reservations; needs its own stage, tests and owner sign-off |

**Owner decision:** ☐ A ☐ B ☐ other: ________ Date/name: ________

---

## DR-2 (blocker B-4) — Recovery objectives (RPO / RTO)

**Evidence (local production-like stack; synthetic data; NOT a promise):**

| Step | Measured |
|---|---|
| Dataset | 2 000 products, 20 000 orders (60 000 lines), 5 000 fulfilled, 53 accounts; DB 61 MB; encrypted backup 61 MB |
| Hardware | 4 vCPU Intel Xeon 2.1 GHz, 16 GB, container overlay storage on a development host |
| Scheduled-style backup job (snapshot, verify, encrypt, re-verify, upload, download, decrypt, verify) | 7.1 s (to a LOCAL S3-compatible test server, not off-server) |
| Fetch → verify → restore → serving read-only (recovery mode) | 6.3 s |
| Including the scripted `recovery:reopen` | 9.1 s |
| **Not included** | human reconciliation, provisioning a new server, DNS/TLS issuance, retrieving secrets from off-server custody |
| Upgrade rehearsal (same data): application stop → new release ready | 1.9 s (one failed health probe, HTTP 502) |

**Configuration options:**
- **RPO:**
  - set by `BACKUP_SCHEDULE` (e.g. `02:17` = up to 24 h of loss; `02:17,14:17` = up to 12 h);
  - off-server copies run after each local backup.
- **RTO:** dominated by obtaining a replacement server, DNS/TLS issuance and business reconciliation. The data
  steps above take seconds at this size.

**The provisional 24 h RPO / 2 h RTO remain unapproved targets.**

**Owner decision:** RPO = ____ h · RTO = ____ h · backup times: ________ · Date/name: ________

---

## DR-3 (blocker B-5) — Residual authentication denial of service

**Facts:**
- One source can no longer lock a username: 5 attempts per (source, username) per 15 min. Verified through the
  real proxy (spoofed forwarding headers stay one source).
- **Distributed sources still can:**
  - ≥ 6 independent addresses (IPv4) or /64 prefixes (IPv6) can make one username refuse sign-in for ≤ 15 min
    (30 attempts per username per 15 min);
  - many sources can saturate the bounded scrypt queue (HTTP 503).
- Users behind one shared NAT share the per-source limits.
- Measured: a burst of 50 simultaneous logins from 50 addresses → 45 succeeded within 11.8 s; the rest were
  refused 503/429 and retried.

**Deployment-layer options (none weakens MFA, none adds an administrator bypass):**
- **Provider-level DDoS / rate filtering** in front of the server (e.g. the hosting provider's network
  protection). Not configured; provider-specific.
- **Monitoring and alerting** on `auth.login_failed` per hour (`ops:status` threshold
  `MONITOR_LOGIN_FAILURES_PER_HOUR`) and on 503/429 rates in the proxy logs, with an operator response
  procedure.
- **Restricting the administrator sign-in** to known networks at the proxy (an allow-list for admin traffic).
  This needs a reviewed design because administrators and traders share one login endpoint.

**Owner decision:**
- ☐ accept the residual with monitoring
- ☐ fund provider-level protection
- ☐ request an admin network restriction design

Date/name: ________

---

## DR-4 — Off-server backup destination (blocker B-2: technical prerequisite, owner-provided)

**Prepared and tested** against a local S3-compatible test server with real SigV4 authentication:
- the S3 REST adapter;
- upload → metadata → download → hash → decrypt → consistency verification;
- failure handling: unreachable, 403, 5xx, corrupted download, size mismatch.

**Needed from the owner:**
- the provider and account;
- a bucket in a different region or provider than the server;
- an access key limited to that bucket/prefix (read + write, preferably no delete);
- whether to enable versioning / Object Lock;
- who holds the backup key and APP_SECRET copies, separately from the bucket.

Versioning and immutability are **not** claimed until configured and tested.

---

## DR-5 — Hosting and domain (blocker B-3: technical prerequisite, owner-provided)

**Needed:**
- an authorized Linux server with Docker, a persistent local disk and ports 80/443 open;
- the public host name and DNS access (A/AAAA records);
- an ACME contact e-mail.

No server, domain or certificate was bought, configured or exposed in stage 17.
