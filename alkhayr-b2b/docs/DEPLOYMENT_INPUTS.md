# Deployment input checklist (what the owner must provide)

Nothing below was available in stage 18, so every hosted check is NOT RUN.
**Do not send passwords, keys or tokens in chat, e-mail or documents.** The operator places secret values directly
into files on the server (`deploy/secrets/*`, owner uid 1000, mode 0400).

## Infrastructure (DR-5)
- [ ] **An authorized Linux x86_64 server**, with:
  - Docker Engine and Compose v2;
  - a persistent **local** disk (not NFS/SMB);
  - NTP time sync;
  - ports 80/443 open to the internet.
- [ ] **Operator access** (SSH user with sudo), and the name of who patches the OS and manages the firewall.
- [ ] **Public host name** for the portal (e.g. `portal.<your-domain>`).
- [ ] **DNS access** to create A (and AAAA, if IPv6 is open) records; optionally CAA.
- [ ] **ACME contact e-mail** for certificate expiry notices.
- [ ] **Written confirmation** that real trader data may be stored on that host and in that country.

## Off-server backups (DR-4)
- [ ] Provider and account with an S3-compatible API.
- [ ] Bucket in a **different region or provider** than the server; prefix (e.g. `alkhayr/prod/`).
- [ ] Access key limited to that bucket/prefix: read + write, preferably without delete. Entered by the operator
      on the server only.
- [ ] Decision on versioning / Object Lock / retention (not claimed until tested).

## Secret custody (DR-4)
- [ ] Named holder of the offline copy of `app_secret`.
- [ ] Named holder of the offline copy of `backup.key`, in a different place from the backups.
- [ ] A second person able to reach each, for emergencies.

## Monitoring
- [ ] Alert recipient or channel, and **explicit permission to send a test alert**.
- [ ] Who reviews `ops:status` daily.

## Business configuration
- [ ] Company name, phone, address (shown on order summaries).
- [ ] Tax rate, shipping, minimum order — confirmed by the business (the pilot defaults are 0).
- [ ] Owner decisions DR-1, DR-2, DR-3 and DR-6 answered (`OWNER_DECISIONS_18.md`).

## After the inputs exist (operator, in this order)
1. `DEPLOYMENT_AR.md` §2–§3 with **new production secrets**; never reuse staging secrets.
2. Hosted checks:
   - public TLS with a browser that trusts only the system root store;
   - HTTP→HTTPS; Host≠SNI 421;
   - cookie attributes;
   - app port unreachable from outside;
   - client addresses in the logs;
   - reboot the host → services return and data persists.
3. Configure the off-server copy → `backup:run` → `ops:status` shows `offsite_copy` verified.
4. Restore drill **on a separate machine** from the downloaded copy; record times.
5. Send one authorized test alert.
6. Record PASS/FAIL for each in `RELEASE_CHECKLIST.md`.
