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
- Off-host backups with an independent `BACKUP_KEY` and a practised restore drill (stage 15).
- Restores go to a **new** path, with the server stopped, never mixing a restored file with an old WAL.
- The database file is not encrypted by SQLite; rely on host disk encryption.

## الملخص بالعربية
- ترتيب التشغيل الأول: إنشاء قاعدة البيانات `db:init` ← تسجيل المدير محليًا `setup-admin` ← تشغيل الخادم.
- `setup-admin` يعمل على الخادم نفسه وفي طرفية تفاعلية فقط، والخادم متوقف؛ كلمة المرور لا تُكتب في سطر الأوامر ولا تظهر على الشاشة.
- مفتاح المصادقة الثنائية يظهر للمشغّل فقط؛ لا تستخدم مواقع إنشاء رموز QR على الإنترنت.
- لا يُحفظ أي شيء قبل إدخال رمز تحقق صحيح؛ الإلغاء لا يترك حسابًا ناقصًا.
- احتفظ بقيمة `APP_SECRET` الأصلية؛ تغييرها يمنع تشغيل الخادم حتى تُستعاد، ولا تُعاد تهيئة حسابات المديرين تلقائيًا.
- واجهة تسجيل الدخول (API) متاحة منذ المرحلة 04؛ في أول دخول للمدير انتظر الرمز التالي في تطبيق المصادقة، فالرمز المستخدم في التسجيل لا يُقبل مرة ثانية.
- الخادم لا يعمل دون `APP_SECRET` في أي وضع.
- المرحلة 05 أضافت الترحيل 0002؛ قواعد البيانات الأقدم تحتاج `db:migrate --confirm-backup` بعد إيقاف الخادم وأخذ نسخة احتياطية.
- اعتماد التاجر أو تعليقه يتم من حساب مدير سجّل الدخول خلال آخر 15 دقيقة، مع ذكر سبب عند التعليق أو الإرجاع للمراجعة؛ التعليق يُنهي كل جلسات التاجر فورًا، والاعتماد لا يرسل أي رسائل.
- اضبط `TRUST_PROXY` على عنوان الوكيل العكسي فقط إذا كان الخادم لا يُصل إليه إلا عبره.
- حدود المحاولات: 5 محاولات دخول لكل اسم مستخدم و20 لكل عنوان IP كل 15 دقيقة؛ يمكن لأي شخص استنفاد محاولات اسم مستخدم مؤقتًا (15 دقيقة) دون قفل دائم.
- قاعدة البيانات تُنشأ مرة واحدة بالأمر `db:init` ولا ينشئها الخادم أو يعدّلها تلقائيًا أبدًا.
- عند وجود ترحيلات جديدة: أوقف الخادم، خذ نسخة احتياطية وتأكد من إمكانية استعادتها، ثم شغّل
  `db:migrate --confirm-backup`.
- لا تعدّل ملف ترحيل سبق تطبيقه؛ الخادم يرفض التشغيل إذا تغيّر.
- يعمل خادم واحد فقط على مجلد البيانات، وعلى قرص محلي دائم (لا NFS ولا مجلدات شبكة).
