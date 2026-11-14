# Release notes

## 1.0.0-rc.2 — release candidate (fix A + hardening pass B, 2026-11-14)

**Status: release candidate for hosted staging.**
- The local package is accepted.
- **Public launch is blocked:** hosted checks are NOT RUN and DR-1…DR-7 are pending.
- Assessment and scores: `READINESS_B.md`.

### Identification
| Item | Value |
|---|---|
| Version | `1.0.0-rc.2` |
| Source | Branch `ccr-b8f31a52-xk6wqg`, the commit "Hardening pass B: readiness evidence…" (parents: checkpoint `5e7387f`, fix A `71e2dd1`) |
| Application image | `alkhayr-b2b:1.0.0-rc.2`, local Id `sha256:b91a7ab4efb2706c509f246fe3c6ce95585cb8fc54e8ae97f0dd1fc74901575f` (built 2026-11-14 03:35 UTC; not pushed to a registry; image Ids are not reproducible) |
| `/app/dist` manifest | `1114e6db03c696fb052ff6ab5c763a165ed5ffe23e8402bb1f67fbb9c77c6916` |
| Base images | unchanged from rc.1 (Node 24.22.3 build image; distroless runtime) |
| Proxy (default) | `caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0` |
| Proxy (alternative) | `traefik:v3.7.19@sha256:b7b1b31e6440de0b1f7c4e0f6cf0a0f3f004866761d30c025fe00c80daaf7d9c` |
| `deploy/compose.yaml` | `995ab18614e58ee0aaec976dedf280a1a36c60934ab15263261938502afec9e4` |
| `deploy/compose.traefik.yaml` | `903403c4235f35aff47834b09e4aaaafbb4f5f7b5b17b8fabdb95aaba73e68cb` |
| `deploy/caddy/Caddyfile` | `9b5cf48825b1c6d14601f44a560461b50a0551ecf60f47bc2d355a52fb55c97b` (unchanged) |
| `deploy/traefik/dynamic.yaml` | `84b24ae6e36080b8ef315731fea3015a621879e5c0ce1deba549909a12240945` |
| `deploy/env.example` | `25cc2d141c8cf5ff64cd02e8ffaa0c026b75579fbfb6044bf37b603e1a2324c2` |
| `deploy/hosted-smoke.sh` | `7ddb71abe0b116b004029d3d5bd9dfb734c402eb8b3b690b10b402b42b2eb845` |
| `Dockerfile` | `ec98c6845502c827cec83d56dd132640d2d2bf04d1736a0dbed09b6d82c75d5f` (unchanged) |
| `package-lock.json` | `59bc3c918d5229e1a87239f8adb7d5167b620ab7af235acf6574e411b0986256` (version field only) |
| Migrations | unchanged (0001–0008, hashes below) |

Hashes identify files; they do not prove who published them.

### Changes since rc.1
- **Security:**
  - A failed first creation of the dummy password hash is no longer cached (fix A). Before, it made unknown
    usernames answer 503 while known ones answered 401.
  - Device cookie: browsers that signed in before are not blocked by the account-wide login limit (owner
    confirmation requested, DR-3).
- **Operations:**
  - `ops:watch`, `ops:alert-test` and a `monitor` service for webhook alerts.
  - New required secret file `secrets/alert_webhook_url` (may be empty).
  - `deploy/hosted-smoke.sh`.
- **Proxy:** Traefik 3.7.19 as a tested alternative (`deploy/compose.traefik.yaml`).
- **UI:** small buttons keep a 44 px tap target on touch screens.
- **Documents:** `READINESS_B.md`, `PILOT_PLAN.md`, updated decision pack, guides, checklist and limitations.

### Upgrade notes (rc.1 → rc.2)
- No migration.
- Create the empty file `deploy/secrets/alert_webhook_url` (owner uid 1000, mode 0400) before `up`.
- Switch `ALKHAYR_VERSION`, recreate `app` and `backup`, and start `monitor`.
- Existing sessions stay valid. Users receive the device cookie at their next sign-in.

## 1.0.0-rc.1 — release candidate (stage 18, 2026-11-13)

**Status: release candidate, accepted for the LOCAL deployment package only.**
- **Public launch is blocked** until the owner decisions DR-1 to DR-6 are answered and the hosted gates in
  `RELEASE_CHECKLIST.md` pass.
- This is not a production release.

### Identification
| Item | Value |
|---|---|
| Version | `1.0.0-rc.1` (`package.json`) |
| Source | Branch `ccr-b8f31a52-xk6wqg`, the stage-18 commit ("Stage 18: final acceptance…"); parent `cebed8c` (stage 17) |
| Application image | `alkhayr-b2b:1.0.0-rc.1`, **not pushed to any registry**. Tested build: Id `sha256:e8cf6ad9100efda3433053d755b069fc636ce436e7193ce872819ed939a562da` (2026-11-13 21:24 UTC, Docker 29.9.2). Current local rebuild of the same source: `sha256:b8a647ab15ba896d19bf96c2cb71488e1c5557cde5d2bf6e6885aa9395165346` (21:39 UTC). The tested build was replaced when the tag moved. |
| Build base | `node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54` |
| Runtime base | `gcr.io/distroless/nodejs24-debian13:nonroot@sha256:6abfcb367ebc291572c774c1592a986be2ab26a2486f73093401327495a5962a` (Node v24.22.3) |
| Proxy | `caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0` |
| `/app/dist` (16 files) | sha256 of the sorted `sha256sum` manifest: `a4b35fdb85f1ee02508d8d1152ed5fd96519747353b24499388573a12dbcdb95` |
| `deploy/compose.yaml` | `c92098eb448dbf3434d86deb114cdb58512683cabb691f2b49afca7bf17819db` |
| `deploy/caddy/Caddyfile` | `9b5cf48825b1c6d14601f44a560461b50a0551ecf60f47bc2d355a52fb55c97b` |
| `deploy/env.example` | `7c4e7ff52107f446fa52dd49101463d48c159062420f4c5afb82a17983bc5d53` |
| `Dockerfile` | `ec98c6845502c827cec83d56dd132640d2d2bf04d1736a0dbed09b6d82c75d5f` |
| `package-lock.json` | `c888df1f1f7a9b2e10274ea95349fc23882f34ae1592d5e8475d449df0572165` |

**Migrations** (sha256 = the checksum recorded in `schema_migrations`):

| File | sha256 |
|---|---|
| 0001_initial.sql | `dbf8d1e1ac8ffa1acb59fc96b060ee58da9713eb4b9e56d887b4973db53048cd` |
| 0002_merchant_access_version.sql | `abd3658927dbd8d6f22c8a82732c91e7b43b0691f6fcc0ffc9f1683e6b791f68` |
| 0003_inventory_integrity.sql | `fa1ad83526b9263f8132fe69af180779fd9b1cd683b99e7420340a0c61d8882d` |
| 0004_order_finalization.sql | `1ba38c1c2f601fbf48dda71b1f59689e65e42073d04abc6d9a59542cc749277a` |
| 0005_order_fulfillment.sql | `00c69130cfe4326797885852bbf4de5148abc91e186f51bde2e389fb2bc829e7` |
| 0006_import_operations.sql | `8209c86b61b88862a90a19d99704171ca249545af2f941645a5d2d4c24eca133` |
| 0007_credential_version.sql | `5101d7d04199c88bec2d5e105030b33847eb736b562bbb1a47144ae3127b2c8a` |
| 0008_system_state.sql | `f276d4ab5f24eff7176f1536531a91109178d319c4195c703895fa61242dabba` |

**Reproducing:**
- Build from the commit: `docker build -t alkhayr-b2b:1.0.0-rc.1 .`, with the optional `extra_ca` build secret only
  behind a TLS-intercepting proxy.
- Compare the `/app/dist` manifest:
  ```sh
  cid=$(docker create alkhayr-b2b:1.0.0-rc.1)
  docker cp $cid:/app/dist ./dist && docker rm $cid
  (cd dist && find . -type f | sort | xargs sha256sum) | sha256sum
  ```
- The image Id itself includes build timestamps and is not expected to match a rebuild.
  - **Verified:** a `--no-cache` rebuild produced the identical `/app/dist` manifest (`a4b35fdb…`) and identical migrations.
- **Hashes identify artifacts; they do not prove who published them.** There is no signature or independent
  publisher attestation.

### Changes in this release candidate (stage 18)
- **Security (proxy):**
  - The Caddyfile no longer uses `request_body`. It exposed GO-2026-6859 (an HTTP/1 server crash through
    `MaxBytesReader`) in Caddy 2.11.9 / Go 1.27.3.
  - Declared bodies of 3 000 000 bytes or more are refused with 413 without reading them. The application still
    enforces the exact limits.
- **Security / availability (sign-in):**
  - A sign-in refused for capacity (busy queue, 503, or per-source concurrency) no longer spends the user's
    attempts.
  - This stops a 15-minute lockout of legitimate users during sign-in surges or queue-saturation attacks.
- **UI (merchant status screen):** after a version conflict, the controls are disabled until the current record is
  shown, so stale choices are never offered.
- **Version:** 1.0.0-rc.1; `deploy/env.example` defaults to it.
- **Documentation:**
  - final acceptance report, evidence matrix, release checklist, known limitations and deployment inputs;
  - owner decision pack (DR-1 to DR-6);
  - Arabic owner quick-start and maintenance/incident checklist;
  - corrected stage-17 load summary.

### Upgrade notes
- **From schema 7 (the stage-15 release):** take a verified backup, stop the app, run
  `db:migrate --confirm-backup` (applies 0008), then `db:check`. Tested in stage 18. Older schemas are not tested.
- **From 17.0.0-rcN (schema 8):** no migration. Switch `ALKHAYR_VERSION` and recreate `app`.
- **Caddyfile changed:** recreate the `proxy` service (`docker compose up -d proxy`).

### Earlier history
Stages 00–17 are recorded in `PROJECT_STATE.md` (commits `2427e9e` … `cebed8c`).
