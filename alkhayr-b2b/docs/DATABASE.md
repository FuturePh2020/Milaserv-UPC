# ALKHAYR — Database Contract

Status: **Implemented in stage 02** (`migrations/0001_initial.sql`, `src/server/database/*`, CLI
`db:status` / `db:init` / `db:migrate`). The SQL file is the authoritative schema; this document
explains it. Operator procedures: [`MIGRATION.md`](MIGRATION.md).

## 1. Engine, files and connection policy
| Item | Decision |
|---|---|
| Engine | SQLite 3.53.4 bundled in Node.js 24.22.1, built-in `node:sqlite` (`DatabaseSync`); no native add-on (D-004) |
| Location | `${DATA_DIR}/alkhayr.db` (+ `-wal`, `-shm`), sidecar `alkhayr.instance.lock` |
| Placement | Local persistent disk only. Network filesystems (NFS, SMB/CIFS, Ceph, AFS, Coda, NCP, 9p) are detected via `statfs` and refused. `DATA_DIR`/`BACKUP_DIR` may not overlap `dist/web`; they are outside the release archive and git-ignored. |
| Instances | Exactly one server per data directory: an exclusive SQLite (fcntl) lock on `alkhayr.instance.lock`, released by the OS if the process dies (no stale locks). `db:init` / `db:migrate` take the same lock; read-only `db:status` does not. |
| Permissions | Data directory `0700`, database/WAL/SHM `0600`; processes run with `umask 077`. A directory/file accessible to others whose mode cannot be tightened is refused. |
| PRAGMAs (every connection) | `journal_mode=WAL` (verified), `synchronous=FULL`, `foreign_keys=ON` (verified), `busy_timeout=5000` ms, `trusted_schema=OFF`, `secure_delete=ON`, `journal_size_limit=64 MiB`, defensive mode on, extensions disabled, double-quoted string literals disabled |
| Runtime connection | After startup checks the server reopens the DB with an **authorizer** that denies CREATE/DROP/ALTER (incl. TEMP), ATTACH/DETACH, REINDEX, ANALYZE, virtual tables, SAVEPOINT, any PRAGMA assignment and PRAGMA reads outside an allow-list. HTTP code cannot alter schema or disable foreign keys. |
| Transactions | `writeTransaction` = `BEGIN IMMEDIATE` … `COMMIT`/`ROLLBACK`; `readTransaction` = `BEGIN DEFERRED`. Callbacks must be synchronous (a returned Promise → rollback + `AsyncTransactionError`). Nesting refused (`NestedTransactionError`); no savepoints. Busy after timeout → `DatabaseBusyError`. |
| Parameters | Bound parameters only. The only interpolated value is the integer migration version in `PRAGMA user_version = N` (validated `Number.isSafeInteger`). |
| Identification | `PRAGMA application_id = 0x414B4852` ('AKHR'); `PRAGMA user_version` = applied migration version. |

## 2. Value conventions
- All tables are **STRICT**: a fractional value in an INTEGER column is rejected (`cannot store REAL value in INTEGER column`), not truncated.
- Money: INTEGER piasters, columns named `*_cents` (D-017). Quantities: INTEGER cartons.
- IDs: lowercase UUID v4 TEXT (CHECK: 36 chars of `[0-9a-f-]`). Timestamps: INTEGER Unix epoch ms UTC. Booleans: INTEGER `0/1` with CHECK.
- **Known SQLite behaviour:** STRICT still converts *losslessly convertible* text (`'100'` → `100`) and booleans (`true` → `1`). The stored value is a real integer, but type confusion is not rejected by the database; services must validate input types (zod) before writing (stages 04+). Tested and documented.
- Available stock is **never stored**: `available = on_hand − reserved`.

## 3. Tables (13)
Twelve contract tables plus `product_categories` (D-029), which holds the owner-approved categories as data.

| Table | Purpose / key rules |
|---|---|
| `schema_migrations` | `version` PK, `name`, `checksum` (SHA-256 hex), `applied_at`. Append-only (triggers). |
| `auth_users` | UUID PK; `username` lowercase `^[a-z0-9][a-z0-9._-]{2,31}$` (CHECK) with `UNIQUE … COLLATE NOCASE` index → case-insensitively unique; `password_hash`; `password_changed_at`; `role ∈ {admin, trader}`; admin ⇒ `totp_ciphertext NOT NULL`; `last_otp_step`. |
| `merchants` | UUID PK; `user_id` UNIQUE FK→auth_users; business/contact name, optional email, phone (digits/+), governorate, address with length CHECKs; `status ∈ {pending, approved, suspended}`; `version` must increase by exactly 1 on every UPDATE (trigger). |
| `sessions` | `token_hash` PK = SHA-256 hex of the raw token (CHECK 64 lowercase hex; a raw token cannot fit); FK user **ON DELETE CASCADE** (credentials, not history); created/last_seen/expires/auth_at/password_changed_at with time-order CHECK. `csrf_secret` removed (D-030). WITHOUT ROWID. |
| `product_categories` | `id` PK (`chocolate`, `candy`, `wafers_biscuits`, `snacks_nuts`), unique Arabic `label_ar`, unique `sort_order`, `active`. Seeded by 0001; must equal `src/shared/categories.ts` (test). Deletion blocked (deactivate instead). |
| `products` | UUID PK; name/brand; `category` FK→product_categories; `barcode` TEXT (1–32 of `[0-9A-Za-z-]`, leading zeros kept, **NULL for none**, empty string rejected) with partial UNIQUE index; `image_url` https only; `price_cents` 1…100,000,000; `on_hand` 0…1e9; `reserved ≥ 0`; **`reserved ≤ on_hand`**; `pack_size` 1…10,000; `minimum_cartons` 1…100,000; `active`, `is_demo`; `version` +1 on every UPDATE including stock/reservation changes. |
| `orders` | UUID PK; `display_number` `AK-YYMMDD-XXXXXX` UNIQUE; FKs merchant/creator; `state` (6 values); snapshot of `subtotal_cents` (≥1), `shipping_cents`, `shipping_taxable`, `tax_bps`, `tax_base_cents` (= subtotal + taxable shipping, CHECK), `tax_cents` (≤ base), `total_cents` (= subtotal + tax + shipping, ≤ 1e13), `minimum_order_cents`; buyer name/contact/phone/governorate/address snapshot; `note`; `is_demo`; `request_key` UUID + `request_digest` SHA-256 hex; **`UNIQUE(merchant_id, request_key)`**; `version`. Triggers: insert only as `pending`/version 1; every UPDATE bumps version by 1; **only `state`, `version`, `updated_at` may change**; legal transitions only; no DELETE. |
| `order_items` | PK `(order_id, product_id)` → one line per product; `UNIQUE(order_id, line_no)`; product name/brand/barcode/pack-size/unit-price snapshot; `cartons` 1…100,000; `line_total_cents = unit_price_cents × cartons` (CHECK). Immutable (no UPDATE/DELETE). WITHOUT ROWID. |
| `order_events` | Autoincrement id; FK order/actor; `(old_state, new_state)` CHECK allows only `NULL→pending` and the legal transitions; append-only. |
| `inventory_ledger` | Autoincrement id; FK product/actor/order; `kind ∈ {opening, receipt, correction, reserve, release, ship, import}`; deltas + balances after (`0 ≤ reserved_after ≤ on_hand_after`); per-kind rules (manual kinds need a reason and no reservation change; opening/receipt positive; reserve/release/ship need an order and the correct delta signs; ship deducts both equally); non-zero movement; `operation_key`/`operation_digest` paired, `UNIQUE(actor_user_id, operation_key)`; append-only. |
| `audit_logs` | Autoincrement id; nullable actor (NULL = anonymous); controlled `action` `[a-z0-9_.]`; target; `metadata` must be a JSON **object** ≤ 2 KiB; `ip_hmac` hex; `request_id` UUID. No UPDATE; DELETE only for rows older than 365 days (trigger). |
| `rate_limits` | `key` PK (16–128 chars, derived/HMAC), `count ≥ 0`, `window_ends_at`; index on window. WITHOUT ROWID. Rows are disposable. |
| `business_settings` | Single row `id = 1`. Company name/phone/email/address **NULL until the operator sets them** (nothing invented). `shipping_cents` 0…10,000,000, `shipping_taxable` 0/1, `tax_bps` 0…10,000, `minimum_order_cents` 0…1e9, `low_stock_threshold_cartons` 0…100,000, `version` +1 on update, no DELETE. Seeded with the pilot defaults below. |

Indexes (19): unique username (NOCASE), merchants `(status, created_at, id)`, sessions `(user_id, created_at)` and `(expires_at)`, products barcode partial unique, `(active, category, name)`, `(brand)`, `(created_at, id)`, orders `(merchant_id, created_at DESC, id DESC)`, `(state, created_at DESC, id DESC)`, `(created_at DESC, id DESC)`, order_items `(product_id)`, order_events `(order_id, id)`, ledger `(product_id, id)`, `(order_id)` partial, operation-key partial unique, audit `(created_at, id)`, `(actor_user_id, created_at)`, rate_limits `(window_ends_at)`.

### Initial configuration seeded by 0001 (owner decisions)
| Setting | Value |
|---|---|
| Categories | chocolate / شيكولاتة · candy / كاندي · wafers_biscuits / ويفر وبسكويت · snacks_nuts / سناكس ومكسرات |
| `shipping_cents` | 0 |
| `shipping_taxable` | 0 (shipping excluded from the tax base) |
| `tax_bps` | 0 |
| `minimum_order_cents` | 0 |
| `low_stock_threshold_cartons` | 10 — applies to **available** stock: 0 = out of stock, 1–10 = low stock |
| Company details | NULL (operator must configure) |

These are implementation defaults, **not** a statement of legal tax treatment or exemption. Nothing
else is seeded: no users, passwords, sessions, products, orders, balances or audit rows (tested).

## 4. Deletion and retention
| Data | Rule | Enforced by |
|---|---|---|
| Orders, order items, order events, inventory ledger, schema history | Never deleted or updated (orders: only state/version/updated_at change) | Triggers |
| Products, categories, merchants, users referenced by history | Cannot be deleted while referenced; deactivate/suspend instead | FKs `ON DELETE RESTRICT` (no cascades from history); category delete trigger |
| Sessions | Disposable; deleted on logout/expiry; cascade with an (unreferenced) user | FK `ON DELETE CASCADE` |
| Audit logs | Kept ≥ 365 days; purge of older rows only | Trigger (purge command: later stage) |
| Rate-limit rows | Disposable; expired rows purged (stage 04) | — |
| Business settings | Single row, never deleted | CHECK + trigger |
| Unreferenced merchant/user rows (e.g. rejected registrations) | Physically deletable when nothing references them | FKs |

## 5. Migration policy (implemented)
1. Files `migrations/NNNN_name.sql`, contiguous from 0001; any other `.sql` name or a gap stops loading.
2. Each pending migration runs in its own `BEGIN IMMEDIATE` transaction together with its
   `schema_migrations` row and `PRAGMA user_version`; a `PRAGMA foreign_key_check` must be clean before
   commit. Any failure rolls everything back: **no version is recorded**.
3. While a migration file executes, an authorizer denies `BEGIN/COMMIT/ROLLBACK`, `SAVEPOINT`,
   `ATTACH/DETACH`, so a file cannot commit part of itself or touch another database.
4. Checksums are SHA-256 of the exact file bytes; `.gitattributes` pins `*.sql` to LF.
5. Startup/CLI refuse: checksum or name mismatch (`MIGRATION_CHECKSUM_MISMATCH`), schema newer than
   the release (`SCHEMA_TOO_NEW`), non-contiguous history, `user_version` mismatch, foreign
   `application_id`, tables without history (`NO_MIGRATION_HISTORY`).
6. The server **never** creates, migrates or resets a database. Missing → `DATABASE_MISSING`;
   pending → `MIGRATIONS_PENDING`; both print the exact operator command. `quick_check` must pass.
7. `db:init` only creates a new database (refuses if any schema exists); `db:migrate` only upgrades
   an existing one, with the server stopped and `--confirm-backup`.
8. Applied migrations are immutable; changes are new files. Destructive changes additionally require
   a tested backup/restore and before/after counts and totals (MIGRATION.md).

## 6. Error mapping notes for later stages
- Unique → errcode 2067; CHECK → 275; NOT NULL → 1299; datatype (STRICT) → 3091; trigger RAISE → 1811.
- **Foreign-key violations report 787 or 1811** (RESTRICT actions run as internal trigger programs);
  use `isForeignKeyError()` (message-based).
- Busy/locked → `DatabaseBusyError` (map to HTTP 503 `UNAVAILABLE`).
- Named constraints (`products_reserved_le_on_hand`, `orders_request_key_scoped`, …) appear in error
  messages and may be mapped to Arabic API errors; never return raw SQLite messages to clients.

## 7. Legacy (2.0.1) migration
Not applicable — BUILD_NEW (D-001). No existing database was supplied, so no real data was migrated.
If one is supplied later, see MIGRATION.md §4 before touching it.
