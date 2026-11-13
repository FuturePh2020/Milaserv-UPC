# ALKHAYR — Operator guide: initialization, administrator enrollment, migration, recovery

Audience: the trusted server operator. All commands run **on the server host**; none is
reachable over HTTP. Configuration (`DATA_DIR`, etc.) comes from the environment or `.env`.

| Context | Command form |
|---|---|
| Source checkout | `npm run db:status` · `npm run db:init` · `npm run setup-admin` · `npm run db:migrate -- --confirm-backup` |
| Release (no npm needed) | `node dist/server/cli.js db:status` · `… db:init` · `… setup-admin` · `… db:migrate --confirm-backup` |

## 0. Initialization sequence (exact order)
**database initialization → local administrator enrollment → application startup**

1. Configure the environment (`APP_SECRET`, `BACKUP_KEY` generated locally; `APP_ORIGIN`; `DATA_DIR`).
2. `db:init` — create the database (§1).
3. `setup-admin` — enroll the first administrator interactively (§1a). Server must be stopped.
4. Start the server; check `GET /readyz`.

Sign-in API exists since stage 04 (`POST /api/v1/auth/login`; the browser UI comes in stages 10–12).
**First administrator sign-in:** the code used to confirm enrollment is the replay baseline and is
refused at login — wait for the authenticator's NEXT 30-second code.

## 0a. Server prerequisites (stage 04)
- `APP_SECRET` is required to start the server in every mode (development included). Keep the
  original value: it encrypts administrator MFA secrets and signs CSRF/rate-limit keys.
- `TRUST_PROXY`: set it to the exact IP address(es) of your reverse proxy **only** if the Node port is
  reachable solely through that proxy. Then client addresses are taken from `X-Forwarded-For`;
  otherwise the connection address is used. Wrong settings make every user share one rate-limit
  address (too strict) or let clients spoof addresses (too loose).
- Login limits: 5 attempts per username and 20 per IP per 15 minutes; registration 5 per IP per hour;
  300 API requests per IP per minute. Anyone can temporarily exhaust a username's attempts (15-minute
  window, no permanent lockout). Watch for `"event":"rate_limited"` log lines.
- Sessions: administrators are signed out after 15 minutes idle, traders after 30, everyone after
  8 hours; at most 5 sessions per account; changing a password signs out every device.

Exit codes: `0` success · `1` refused/failed (nothing changed unless stated) · `2` usage error.

## 1. First installation
1. Choose `DATA_DIR` on a **local persistent disk**. NFS/SMB/CIFS/Ceph/AFS/9p are detected and refused on Linux.
   FUSE/virtiofs mounts (e.g. Docker Desktop bind mounts on macOS/Windows) are not detected but are **unsupported**;
   use a named Docker volume or a host directory on a local filesystem.
2. `db:status` → `"initialized": false`.
3. `db:init` → creates `alkhayr.db` (mode 0600, directory 0700) and applies all migrations.
   It refuses if any database with a schema already exists and then changes nothing.
4. `db:status` → `schemaVersion` = `latestVersion`, `integrity: ok`, `journalMode: wal`.
5. **No accounts or business data are created by `db:init`.** Continue with §1a, then start the
   server; `GET /readyz` returns `{"status":"ready"}`. Company details, tax and shipping are configured
   in the administration UI (stage 14).

## 1a. Enrolling the first administrator (`setup-admin`)
Prerequisites: `APP_SECRET` configured (the same value the server will use), database initialized and
at the current schema version, server **stopped**, an interactive terminal on the server host
(the command refuses pipes and takes no arguments — passwords are never passed on the command line).

The command asks for: username (3–32 lowercase letters/digits/`._-`), the administrator's company
profile (business name, contact person, phone, governorate, address, optional email), a password
(15–128 characters, typed twice, nothing echoed), then shows a TOTP secret and `otpauth://` URI.
Add it to an authenticator app **manually or with a local tool — never an online QR generator**, then
enter the current 6-digit code. Only after a valid code is everything saved in one transaction:
administrator account (password hash + encrypted MFA secret), approved company profile, and an audit
event. Ctrl-C, three invalid answers, or any error save nothing.

It refuses if an administrator already exists, if the username belongs to any existing account
(traders are never promoted), if the database is missing/uninitialized/foreign/needs migration, or if
the server is running. Keep `APP_SECRET` safe: if it changes, the server refuses to start with
`MFA_KEY_MISMATCH` until the original key is restored (administrators are never reset automatically).

## 2. Upgrading to a release with new migrations
The server refuses to start with `MIGRATIONS_PENDING` and prints the command. Then:
1. Stop the server (only one process may use the data directory; `db:migrate` is refused while it runs).
2. Take a backup and **verify it restores** (stage 15 adds the encrypted `backup`/`restore` commands;
   until then: with the server stopped, copy `alkhayr.db` — and `-wal`/`-shm` if present — to secure
   storage and test-open the copy with `db:status` using a different `DATA_DIR`).
3. `db:migrate --confirm-backup`. Each migration is atomic; on failure nothing of that migration is
   recorded and the database stays at the previous version.
4. `db:status`, then start the server and check `/readyz`.

Never edit an applied migration file. If startup reports `MIGRATION_CHECKSUM_MISMATCH`, restore the
original file from the release; do not "fix" the database to match an edited file.

### Stage 05 note: migration 0002
Stage 05 ships `0002_merchant_access_version.sql`. A database initialized before stage 05 makes the
server refuse to start with `MIGRATIONS_PENDING`; apply it with §2 (stop the server, back up, then
`db:migrate --confirm-backup`). New installations get it automatically through `db:init`.

### Stage 07 note: migration 0003 and stock operations
`0003_inventory_integrity.sql` must be applied to databases created earlier (§2). After it:
- New products are always created inactive with zero stock; activation and stock are separate steps.
- **Opening stock:** this portal does not know about sales in other programs. Allocate a quantity to the
  portal (count it, or set aside stock for online traders) and enter it as a `receipt` or `set_total` with
  a reason such as "رصيد افتتاحي مخصص للبوابة — جرد 2026-11-15". Re-check it periodically against your
  main system and record differences as corrections with a clear reason.
- Mistakes are never edited or deleted: enter a compensating `correction_delta` referring to the wrong
  movement in the reason.
- Each adjustment needs a fresh operation key (the UI will generate it); retrying the same request is safe.

### Stage 08 note: migration 0004 and orders
`0004_order_finalization.sql` must be applied to databases created earlier (§2). It adds checks only; no
existing data changes. After it, approved traders (and administrators, for their own company profile) can
submit pending orders through the API (`POST /api/v1/orders`):
- Prices, totals, tax and shipping are calculated by the server from the current settings (defaults:
  tax 0, shipping 0); configure the real values before production (settings screen: stage 14).
- A pending order does **not** reserve stock; stock is reserved when an administrator confirms (stage 09).
- Each trader may attempt at most 30 orders per 10 minutes.

### Stage 09 note: migration 0005 and order fulfillment
`0005_order_fulfillment.sql` must be applied to databases created earlier (§2). It adds the
`order_allocations` table, columns on `order_events` and checks; existing rows are not changed. After it:
- Administrators process orders: confirm (reserves stock for that order), prepare, ship (deducts stock),
  deliver, or cancel with a reason (releases that order's reservation). Each step needs a login within the
  last 15 minutes.
- **Pieces per carton cannot be changed while a product has stock or reservations.** To repack: cancel or
  ship open reservations, set the stock to 0 with an inventory adjustment (with a reason), change the
  packaging, then receive the stock again. Pending orders made with the old packaging cannot be confirmed;
  cancel them and ask the trader to order again.
- Suspending a trader does not cancel or release anything; their orders wait (or can be cancelled).
- Before this upgrade no order can be confirmed (stage 08 orders are all pending), so no reservation data
  needs conversion.

### Stage 10 note: web interface (no migration)
Stage 10 changes only the browser application (design system and page frames); the database schema
is unchanged. The release contains the production web build only; the component gallery
(`#/__gallery`) exists solely in development builds (`npm run dev`). Fonts are served from the server
itself (no internet font service). Sign-in screens arrive in stage 11; until then, accounts sign in
through the API.

### Stage 11 note: merchant screens (no migration)
Traders can now register, sign in, browse, order and follow their orders in the browser; administrators sign
in on the same page by ticking "تسجيل دخول مدير النظام" and entering the authenticator code. There is no
password reset in the portal: a trader who forgets the password must contact the business (an administrator
account cannot reset it either; there is no such feature yet). Shipping, tax and minimum order shown to
traders come from the business settings (defaults 0 until configured in stage 14). Before go-live, make sure
the real tax/shipping values are configured.

### Stage 12 note: administration screens (no migration)
Administrators now manage merchants, products, stock and orders in the browser. Every change requires a
sign-in within the last 15 minutes; when it has expired the screen asks for the password and a **new**
authenticator code (wait for the next code if the current one was just used) and never executes the
prepared action by itself. Products are created inactive with zero stock: receive stock in «المخزون», then
activate the product. Products of an inactive category are no longer shown to traders. A second administrator
cannot be created from the portal or with `setup-admin` (it refuses once an administrator exists); keep the
first administrator's authenticator safe.

### Stage 13 note: migration 0006 and CSV imports
This release adds `0006_import_operations.sql` (committed import batches). Existing installations: stop the server,
back up, run `db:migrate --confirm-backup`, start the server (it refuses to start with a pending migration). New
installations get it through `db:init`. Administrators can then import products and stock from CSV files: see
[`IMPORT_GUIDE_AR.md`](IMPORT_GUIDE_AR.md). Imported products are created inactive with zero stock. Keep the original
files: the server stores only their hash, size and record count.

### Stage 14 note: settings, reports, exports and printing (no migration)
No database change. After upgrading, open «الإعدادات» and configure the company details you want printed, the
shipping charge, the tax rate (your business decision — the system does not certify it), whether shipping is taxable,
the minimum goods subtotal and the low-stock threshold; until then the defaults are 0 / 0% / 10 cartons. Changes apply to
future quotes and orders only. A trader who reviewed totals before a shipping/tax change is asked to review again.
Browsers holding an unclear order submission saved before this release cannot resend it (it lacks the reviewed terms)
and drop it: check «طلباتي» for that trader. Reports use Cairo calendar days and show order values, not collected
money. Exports are CSV for viewing (not for re-import); pre-filled import templates are on the import page. Printed
«ملخص طلب» documents are not tax invoices or receipts. See [`IMPORT_GUIDE_AR.md`](IMPORT_GUIDE_AR.md).

### Stage 15 note: migration 0007, encrypted backups and operator recovery
This release adds `0007_credential_version.sql` (one column and two triggers on `auth_users`; no data rewritten).
Existing installations:
1. Stop the server.
2. Take a backup with the NEW tools: `npm run cli -- backup:keygen --out <protected path>` once, then
   `npm run cli -- backup:create --key-file <path>` (it verifies itself).
3. Run `db:migrate --confirm-backup`, then start the server.

`BACKUP_KEY` in `.env` is no longer used or required; backups use the separate key file or a hidden prompt.
New operator commands (server host only, interactive, server stopped): `admin:create`, `account:reset-password`,
`account:reset-mfa` and `account:revoke-sessions`. There are also `backup:inspect`, `backup:verify`, `backup:restore`,
`backup:prune` and `backup:status`.
Full procedures, recovery cases A–F, secret custody and RPO/RTO: [`BACKUP_RECOVERY_AR.md`](BACKUP_RECOVERY_AR.md).
Browsers that still hold an unclear order submission from before stage 14 now show a notice that the order may already
exist, linking to «طلباتي»; nothing is resent automatically.

### Stage 16 note: migration 0008, recovery gate and consistency checks
This release adds `0008_system_state.sql`. Existing installations:
1. Stop the server.
2. `backup:create`, then `db:migrate --confirm-backup`.
3. Start the server.

New installations get it through `db:init`. New commands: `db:check` (read-only; safe while running),
`recovery:status`, `recovery:reopen`. After any restore the portal starts in RECOVERY MODE: reconcile, then run
`recovery:reopen` ([`BACKUP_RECOVERY_AR.md`](BACKUP_RECOVERY_AR.md)). If the startup log shows `consistency_failed`,
new business writes stay refused until `db:check` is clean and the server is restarted. Nothing is repaired
automatically.

### Stage 17 note: container deployment (no migration)
No database change. The supported production layout is now the Docker Compose stack in `deploy/` (see
[`DEPLOYMENT_AR.md`](DEPLOYMENT_AR.md)). For an existing bare-metal installation:
1. Take a verified backup.
2. Initialize the new stack with an EMPTY data volume.
3. Restore that backup into the new volume with `backup:restore`.
4. Reconcile, then run `recovery:reopen`.

Never copy a live database file. New startup refusal: `DATA_DIR_NOT_WRITABLE` (wrong owner or read-only mount; the
container runs as uid 1000).

## 3. Startup refusals and what to do
| Code | Meaning | Action |
|---|---|---|
| `DATABASE_MISSING` | No database file in `DATA_DIR` | Wrong `DATA_DIR`/volume? Otherwise `db:init` (new installation only) |
| `DATABASE_UNINITIALIZED` | Empty file without schema | `db:init` |
| `MIGRATIONS_PENDING` | Release newer than database | §2 |
| `SCHEMA_TOO_NEW` | Database newer than release | Run the matching or newer release; never downgrade |
| `MIGRATION_CHECKSUM_MISMATCH` | A shipped migration file differs from what was applied | Restore the original release files |
| `NO_MIGRATION_HISTORY` / `FOREIGN_DATABASE` | The file is not an ALKHAYR database | Check `DATA_DIR`; the file is left untouched |
| `INTEGRITY_CHECK_FAILED` | SQLite `quick_check` failed | Stop; restore from a verified backup |
| `INSTANCE_LOCKED` | Another server or maintenance command uses `DATA_DIR` | Stop the other process; never run two instances |
| `MFA_KEY_MISMATCH` | Administrator MFA secrets do not decrypt with the configured `APP_SECRET` | Restore the original `APP_SECRET` from your secret store; do not reset accounts |
| `APP_SECRET_REQUIRED` | The server (any mode) or `setup-admin` was started without `APP_SECRET` | Configure the original `APP_SECRET` (a new one only for a fresh installation without administrators) |
| `NETWORK_FILESYSTEM` / `INSECURE_PERMISSIONS` / `STALE_WAL` | Unsafe storage | Move to a local disk / fix ownership and modes / investigate stray `-wal` before creating anything |

## 4. Rules for any supplied existing database (e.g. a 2.0.1 copy)
None has been supplied (BUILD_NEW). If one is:
- Work only on a **copy**; keep the original read-only and off the server.
- Record row counts and financial totals (orders, items, stock) before and after, and keep the
  comparison in this file.
- Write an additive migration/backfill and test it on the copy first; never drop the original data.
- Require a verified, restorable backup before running anything against production.

## 5. Recovery requirements (what must exist before production)
- Implemented in stage 15 ([`BACKUP_RECOVERY_AR.md`](BACKUP_RECOVERY_AR.md)). Before production you still need:
  - daily `backup:create` with `--keep`;
  - an off-host copy of the `.akbk` files;
  - the backup key file and `APP_SECRET`, each stored off-host and separately;
  - a practised restore drill on real-sized data (RTO not yet measured on real data).
- Restores go to a **new** `DATA_DIR` by default. `--replace` moves the old database aside (never deleted); the
  server must be stopped. The restore never mixes a restored file with an old WAL: the WAL is moved aside with the database.
- The live database file is not encrypted by SQLite; rely on host disk encryption. Backup files are encrypted (AES-256-GCM).

## الملخص بالعربية
- ترتيب التشغيل الأول: إنشاء قاعدة البيانات `db:init` ← تسجيل المدير محليًا `setup-admin` ← تشغيل الخادم.
- `setup-admin` يعمل على الخادم نفسه وفي طرفية تفاعلية فقط، والخادم متوقف؛ كلمة المرور لا تُكتب في سطر الأوامر ولا تظهر على الشاشة.
- مفتاح المصادقة الثنائية يظهر للمشغّل فقط؛ لا تستخدم مواقع إنشاء رموز QR على الإنترنت.
- لا يُحفظ أي شيء قبل إدخال رمز تحقق صحيح؛ الإلغاء لا يترك حسابًا ناقصًا.
- احتفظ بقيمة `APP_SECRET` الأصلية؛ تغييرها يمنع تشغيل الخادم حتى تُستعاد، ولا تُعاد تهيئة حسابات المديرين تلقائيًا.
- واجهة تسجيل الدخول (API) متاحة منذ المرحلة 04؛ في أول دخول للمدير انتظر الرمز التالي في تطبيق المصادقة، فالرمز المستخدم في التسجيل لا يُقبل مرة ثانية.
- الخادم لا يعمل دون `APP_SECRET` في أي وضع.
- المرحلة 07 أضافت الترحيل 0003: المنتجات الجديدة تُنشأ غير مفعّلة وبرصيد صفر، وأي تغيير في الرصيد يجب أن يقابله قيد في سجل الحركة.
- رصيد الافتتاح: البوابة لا تعرف المبيعات في البرامج الأخرى؛ خصّص كمية للبوابة وسجّلها كاستلام أو كتحديد للإجمالي مع ذكر السبب، وراجعها دوريًا.
- لا تُعدَّل الحركات القديمة ولا تُحذف؛ الخطأ يُصحَّح بحركة تسوية عكسية مع ذكر السبب.
- المرحلة 11 أضافت واجهة التاجر كاملة: التسجيل، تسجيل الدخول (والمدير بخيار «تسجيل دخول مدير النظام» مع رمز التحقق)، الكتالوج، السلة، إرسال الطلب ومتابعته، وتعديل البيانات وكلمة المرور. لا توجد استعادة لكلمة المرور من البوابة.
- المرحلة 10 أضافت الهوية البصرية وإطارات الواجهة فقط، بدون ترحيل لقاعدة البيانات؛ معرض المكونات موجود في نسخة التطوير فقط ولا يظهر في نسخة الإنتاج.
- المرحلة 09 أضافت الترحيل 0005: الإدارة تؤكد الطلب (يُحجز المخزون لهذا الطلب تحديدًا)، ثم التجهيز، ثم الشحن (يُخصم المخزون)، ثم التسليم، أو الإلغاء مع ذكر السبب (يُفك الحجز). كل خطوة تتطلب تسجيل دخول خلال آخر 15 دقيقة.
- لا يمكن تغيير عدد القطع في الكرتونة أثناء وجود رصيد أو حجوزات للمنتج؛ صفّر الرصيد بحركة موثّقة أولًا. الطلبات المعلّقة بالتعبئة القديمة لا تُؤكَّد، بل تُلغى ويُطلب من التاجر طلب جديد.
- تعليق حساب التاجر لا يلغي طلباته ولا يفك الحجز تلقائيًا.
- المرحلة 08 أضافت الترحيل 0004 (فحوص إضافية فقط) وإنشاء الطلبات قيد الانتظار: الأسعار والضريبة والشحن يحسبها الخادم، والطلب قيد الانتظار لا يحجز مخزونًا (الحجز عند تأكيد الإدارة في المرحلة 09)، وبحد أقصى 30 محاولة طلب لكل تاجر كل 10 دقائق.
- المرحلة 05 أضافت الترحيل 0002؛ قواعد البيانات الأقدم تحتاج `db:migrate --confirm-backup` بعد إيقاف الخادم وأخذ نسخة احتياطية.
- اعتماد التاجر أو تعليقه يتم من حساب مدير سجّل الدخول خلال آخر 15 دقيقة، مع ذكر سبب عند التعليق أو الإرجاع للمراجعة؛ التعليق يُنهي كل جلسات التاجر فورًا، والاعتماد لا يرسل أي رسائل.
- اضبط `TRUST_PROXY` على عنوان الوكيل العكسي فقط إذا كان الخادم لا يُصل إليه إلا عبره.
- حدود المحاولات: 5 محاولات دخول لكل اسم مستخدم و20 لكل عنوان IP كل 15 دقيقة؛ يمكن لأي شخص استنفاد محاولات اسم مستخدم مؤقتًا (15 دقيقة) دون قفل دائم.
- قاعدة البيانات تُنشأ مرة واحدة بالأمر `db:init` ولا ينشئها الخادم أو يعدّلها تلقائيًا أبدًا.
- عند وجود ترحيلات جديدة: أوقف الخادم، خذ نسخة احتياطية وتأكد من إمكانية استعادتها، ثم شغّل
  `db:migrate --confirm-backup`.
- لا تعدّل ملف ترحيل سبق تطبيقه؛ الخادم يرفض التشغيل إذا تغيّر.
- يعمل خادم واحد فقط على مجلد البيانات، وعلى قرص محلي دائم (لا NFS ولا مجلدات شبكة).
- المرحلة 15 أضافت الترحيل 0007 والنسخ الاحتياطي المشفّر والاستعادة وأوامر استرداد الحسابات (على الخادم فقط)؛ التفاصيل في `BACKUP_RECOVERY_AR.md`. `BACKUP_KEY` لم يعد مستخدمًا؛ مفتاح النسخ ملف محمي منفصل.
