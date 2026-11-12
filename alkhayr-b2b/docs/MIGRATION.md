# ALKHAYR — Database initialization, migration and recovery requirements

Audience: the trusted server operator. All commands run **on the server host**; none is
reachable over HTTP. Configuration (`DATA_DIR`, etc.) comes from the environment or `.env`.

| Context | Command form |
|---|---|
| Source checkout | `npm run db:status` · `npm run db:init` · `npm run db:migrate -- --confirm-backup` |
| Release (no npm needed) | `node dist/server/cli.js db:status` · `… db:init` · `… db:migrate --confirm-backup` |

Exit codes: `0` success · `1` refused/failed (nothing changed unless stated) · `2` usage error.

## 1. First installation
1. Choose `DATA_DIR` on a **local persistent disk**. NFS/SMB/CIFS/Ceph/AFS/9p are detected and refused on Linux.
   FUSE/virtiofs mounts (e.g. Docker Desktop bind mounts on macOS/Windows) are not detected but are **unsupported**;
   use a named Docker volume or a host directory on a local filesystem.
2. `db:status` → `"initialized": false`.
3. `db:init` → creates `alkhayr.db` (mode 0600, directory 0700) and applies all migrations.
   It refuses if any database with a schema already exists and then changes nothing.
4. `db:status` → `schemaVersion` = `latestVersion`, `integrity: ok`, `journalMode: wal`.
5. Start the server. `GET /readyz` returns `{"status":"ready"}`.
6. Configure the business (company details, tax, shipping) and create the administrator in later
   stages. **No accounts or business data are created by `db:init`.**

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
- قاعدة البيانات تُنشأ مرة واحدة بالأمر `db:init` ولا ينشئها الخادم أو يعدّلها تلقائيًا أبدًا.
- عند وجود ترحيلات جديدة: أوقف الخادم، خذ نسخة احتياطية وتأكد من إمكانية استعادتها، ثم شغّل
  `db:migrate --confirm-backup`.
- لا تعدّل ملف ترحيل سبق تطبيقه؛ الخادم يرفض التشغيل إذا تغيّر.
- يعمل خادم واحد فقط على مجلد البيانات، وعلى قرص محلي دائم (لا NFS ولا مجلدات شبكة).
