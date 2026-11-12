# ALKHAYR — Database Contract

Status: **Implemented in stage 02 (0001); stage 05 appended 0002 (`merchants.access_version`, §10); stage 07 appended 0003 (inventory integrity, §12). Stages 03, 04 and 06 needed no schema change.** (`migrations/0001_initial.sql`, `src/server/database/*`, CLI
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
The schema has **13 tables**: the 12 tables of the original blueprint plus **one additional table, `product_categories`**.

| # | Table | Origin |
|---:|---|---|
| 1 | `auth_users` | blueprint |
| 2 | `merchants` | blueprint |
| 3 | `sessions` | blueprint |
| 4 | `products` | blueprint |
| 5 | `orders` | blueprint |
| 6 | `order_items` | blueprint |
| 7 | `order_events` | blueprint |
| 8 | `inventory_ledger` | blueprint |
| 9 | `audit_logs` | blueprint |
| 10 | `rate_limits` | blueprint |
| 11 | `business_settings` | blueprint |
| 12 | `schema_migrations` | blueprint |
| 13 | `product_categories` | **added in stage 02 (D-029)** |

Why the 13th table: the owner asked to *persist* the four initial categories and not hardcode
their labels. Storing them as rows (id, Arabic label, sort order, active flag) lets
`products.category` reference them with a foreign key and lets later stages add or deactivate a
category through a migration or administration, without rewriting a CHECK constraint. Nothing from the
original 12-table design was removed or merged.

**Absent barcode:** a product without a barcode has `barcode = NULL`. The empty string `''` is not a
valid value (rejected by `products_barcode_format`); services must convert blank input to `NULL`
before writing. Uniqueness applies only to non-NULL barcodes (partial unique index
`WHERE barcode IS NOT NULL`), so any number of products may have no barcode, while each non-NULL
barcode — compared as exact text, leading zeros included — appears at most once.

| Table | Purpose / key rules |
|---|---|
| `schema_migrations` | `version` PK, `name`, `checksum` (SHA-256 hex), `applied_at`. Append-only (triggers). |
| `auth_users` | UUID PK; `username` lowercase `^[a-z0-9][a-z0-9._-]{2,31}$` (CHECK) with `UNIQUE … COLLATE NOCASE` index → case-insensitively unique; `password_hash`; `password_changed_at`; `role ∈ {admin, trader}`; admin ⇒ `totp_ciphertext NOT NULL`; `last_otp_step`. |
| `merchants` | UUID PK; `user_id` UNIQUE FK→auth_users; business/contact name, optional email, phone (digits/+), governorate, address with length CHECKs; `status ∈ {pending, approved, suspended}`; `version` must increase by exactly 1 on every UPDATE (trigger); **`access_version`** (0002) increases by exactly 1 on every status change and never otherwise (triggers). |
| `sessions` | `token_hash` PK = SHA-256 hex of the raw token (CHECK 64 lowercase hex; a raw token cannot fit); FK user **ON DELETE CASCADE** (credentials, not history); created/last_seen/expires/auth_at/password_changed_at with time-order CHECK. `csrf_secret` removed (D-030). WITHOUT ROWID. |
| `product_categories` | `id` PK (`chocolate`, `candy`, `wafers_biscuits`, `snacks_nuts`), unique Arabic `label_ar`, unique `sort_order`, `active`. Seeded by 0001; must equal `src/shared/categories.ts` (test). Deletion blocked (deactivate instead). |
| `products` | (0003: inserted inactive with zero stock; `last_ledger_id` links every stock change to its ledger row.) UUID PK; name/brand; `category` FK→product_categories; `barcode` TEXT or NULL (NULL = the product has no barcode; otherwise 1–32 of `[0-9A-Za-z-]`, leading zeros kept; `''` invalid), unique among non-NULL values via a partial UNIQUE index; `image_url` https only; `price_cents` 1…100,000,000; `on_hand` 0…1e9; `reserved ≥ 0`; **`reserved ≤ on_hand`**; `pack_size` 1…10,000; `minimum_cartons` 1…100,000; `active`, `is_demo`; `version` +1 on every UPDATE including stock/reservation changes. |
| `orders` | UUID PK; `display_number` `AK-YYMMDD-XXXXXX` UNIQUE; FKs merchant/creator; `state` (6 values); snapshot of `subtotal_cents` (≥1), `shipping_cents`, `shipping_taxable`, `tax_bps`, `tax_base_cents` (= subtotal + taxable shipping, CHECK), `tax_cents` (≤ base), `total_cents` (= subtotal + tax + shipping, ≤ 1e13), `minimum_order_cents`; buyer name/contact/phone/governorate/address snapshot; `note`; `is_demo`; `request_key` UUID + `request_digest` SHA-256 hex; **`UNIQUE(merchant_id, request_key)`**; `version`. Triggers: insert only as `pending`/version 1; every UPDATE bumps version by 1; **only `state`, `version`, `updated_at` may change**; legal transitions only; no DELETE. |
| `order_items` | PK `(order_id, product_id)` → one line per product; `UNIQUE(order_id, line_no)`; product name/brand/barcode/pack-size/unit-price snapshot; `cartons` 1…100,000; `line_total_cents = unit_price_cents × cartons` (CHECK). Immutable (no UPDATE/DELETE). WITHOUT ROWID. |
| `order_events` | Autoincrement id; FK order/actor; `(old_state, new_state)` CHECK allows only `NULL→pending` and the legal transitions; append-only. |
| `inventory_ledger` | (0003: `product_version_after`, `adjustment_type`.) Autoincrement id; FK product/actor/order; `kind ∈ {opening, receipt, correction, reserve, release, ship, import}`; deltas + balances after (`0 ≤ reserved_after ≤ on_hand_after`); per-kind rules (manual kinds need a reason and no reservation change; opening/receipt positive; reserve/release/ship need an order and the correct delta signs; ship deducts both equally); non-zero movement; `operation_key`/`operation_digest` paired, `UNIQUE(actor_user_id, operation_key)`; append-only. |
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
| Audit logs | **Retention policy: kept for at least 365 days.** Rows younger than 365 days cannot be deleted; rows older than 365 days may be removed only by an explicit operator purge (command planned for a later stage). Nothing is deleted automatically. | Trigger `audit_logs_retention_guard` (D-014) |
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

## 8. Authentication columns (stage 03; no migration required)
Stage 03 inspected the schema: every field the security primitives need already exists in 0001, so
no migration was added and 0001 was not modified.

| Column | Stored value |
|---|---|
| `auth_users.password_hash` | `$scrypt$v=1$ln=17,r=8,p=1$<16-byte salt b64url>$<32-byte key b64url>` (91 chars; CHECK 20–512) |
| `auth_users.totp_ciphertext` | `v1.<b64url(nonce‖ciphertext‖tag)>` AES-256-GCM, key HKDF(APP_SECRET,"totp"), AAD `alkhayr:totp:v1:<user id>` (67 chars for a 20-byte secret; CHECK 20–1024); required for admins |
| `auth_users.last_otp_step` | Last accepted TOTP time step. `setup-admin` stores the step proven during enrollment, so that code cannot be replayed at first login. Stage 04 advances it with `UPDATE … WHERE last_otp_step IS NULL OR last_otp_step < ?` |
| `auth_users.password_changed_at` | Set at creation; used by stage 04 to invalidate sessions after password changes |
| `audit_logs` (`admin.bootstrap`) | actor = new admin, target `user`/id, metadata `{"method":"cli","mfa":"totp"}` only |

## 9. Use by authentication (stage 04; no migration required)
| Table / column | Use |
|---|---|
| `sessions` | One row per signed-in browser: `token_hash` = SHA-256 of the cookie token; `auth_at` = last full credential check (recent-auth guard); `last_seen_at` touched at most once a minute by a conditional UPDATE; `password_changed_at` copied at login and compared on every request. Rows are deleted on logout, password change, expiry (on sight and by the 60-s sweeper) and when the 5-per-account cap evicts the oldest. |
| `rate_limits` | `key` = HMAC-SHA256(rate-limit key, bucket + identifier) hex — never a raw IP/username; fixed windows; ≤ 100 000 live rows (then expired purge, then a shared overflow counter per bucket); expired rows swept every 60 s. |
| `audit_logs` | Actions `auth.register`, `auth.register_duplicate`, `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_changed`, `auth.password_change_failed`; allow-listed metadata only; `ip_hmac` = HMAC(ip key, client IP). Same 365-day minimum retention (D-014). |
| `auth_users.last_otp_step` | Advanced inside the login / password-change transaction with `WHERE last_otp_step IS NULL OR last_otp_step < ?`; zero affected rows = replay → rejected. |
| `auth_users.password_changed_at` | Strictly increased on password change; sessions with an older copy are invalid. |

## 10. Migration 0002 — `merchants.access_version` (stage 05)
`ALTER TABLE merchants ADD COLUMN access_version INTEGER NOT NULL DEFAULT 1 CHECK (access_version >= 1)`
(the table stays STRICT) plus two triggers:
- `merchants_access_version_on_status_change`: a status change must set `access_version = old + 1`.
- `merchants_access_version_only_with_status`: `access_version` cannot change without a status change.

Purpose: a monotonic authorization marker. Login reads it before the slow password verification and
requires the same value at commit, so approved → suspended → approved during an in-flight login (ABA)
is detected although the final status string is unchanged. `version` is not used for this because
ordinary profile edits also advance it. Existing rows start at 1. Applying it to an existing database
follows MIGRATION.md §2 (`db:migrate --confirm-backup`, server stopped). 0001 is unchanged.

Order snapshots: self-service profile edits update only `merchants`; orders keep their buyer snapshot
(enforced by the `orders_snapshot_immutable` trigger since 0001). The end-to-end test with real orders
is part of stages 08–09, when orders are created through the API.

## 11. Use by product administration and the catalog (stage 06; no migration required)
The 0001 `products` table already holds every field stage 06 needs; no migration was added and
0001/0002 are unchanged.
- **New products are inactive:** the column default is `active = 1` (0001, immutable), but the only
  creation path (`POST /api/v1/admin/products`) always inserts `active = 0`, `on_hand = 0`,
  `reserved = 0`, `version = 1`. Activation is an explicit, versioned, audited PATCH.
- **Categories** are validated against `product_categories` (exists and `active = 1`) inside the write
  transaction; the FK is the second line. There is no second category list in code for validation.
- **Barcode:** absent = `NULL`; `''` rejected by the API (and by `products_barcode_format`); uniqueness
  among non-NULL values via `products_barcode_uq` (exact text, BINARY collation → case-sensitive).
- **Catalog cap (5000):** counted inside the `BEGIN IMMEDIATE` create transaction, so concurrent creates
  cannot exceed it.
- **Versions:** every UPDATE must advance `products.version` by exactly 1 (0001 trigger). This applies
  to metadata, price and activation now, and to the stage 07–09 stock/reservation movements, so an
  administrator form loaded before a stock movement is stale (tested with a test-only stock update).
- **Available stock** is computed as `on_hand − reserved` in queries; it is never stored.
- **Audit:** `product.created` (version, category, price_to, active_to, is_demo) and `product.updated`
  (changed field names, version, price_from/price_to, active_from/active_to).
- **Order snapshots:** product edits never touch `order_items` (0001 immutability triggers); the
  end-to-end check with API-created orders is part of stages 08–09.

## 12. Migration 0003 — inventory integrity (stage 07)
| Change | Rule |
|---|---|
| Trigger `products_insert_inactive_without_stock` | Any INSERT into `products` must have `active = 0`, `on_hand = 0`, `reserved = 0`, `last_ledger_id IS NULL`. The 0001 default `active DEFAULT 1` therefore cannot take effect: an insert that omits `active` is **rejected** (fail closed). The stored default is unchanged because changing it would require a table rebuild; inserts must state `active = 0` explicitly. Activation is a separate, versioned, audited PATCH. |
| Column `products.last_ledger_id` (FK → inventory_ledger) | Link to the ledger row of the most recent stock change. |
| Trigger `products_stock_change_requires_ledger` | Any UPDATE changing `on_hand` or `reserved` must set `last_ledger_id` to a NEWER ledger row (id > previous) for the same product whose `on_hand_delta`, `reserved_delta`, `on_hand_after`, `reserved_after` and `product_version_after` exactly match the update. |
| Trigger `products_ledger_link_only_with_stock_change` | `last_ledger_id` cannot change without a stock change. |
| Columns `inventory_ledger.product_version_after`, `adjustment_type` | Committed result for traceability and idempotent replays; `adjustment_type ∈ {receipt, correction_delta, set_total}` for manual adjustments (ledger `kind` is `receipt` or `correction`). |

**Enforcement boundary (exact):**
- *Database-enforced for every write path* (HTTP service, operator SQL, future import/fulfillment):
  `on_hand ≥ reserved ≥ 0` and limits (CHECKs on products and ledger); every change of `on_hand`/`reserved`
  is paired 1:1 with a new ledger row whose deltas and balances match; ledger rows are append-only;
  product inserts start inactive with zero stock; the product version advances on every update.
- *Service-enforced (supported transaction only)*: who may adjust and with which reason/operation key,
  idempotent replay, `expectedVersion` comparison, the rule that manual adjustments never change
  `reserved` (the ledger CHECK `inventory_ledger_manual_rules` additionally forbids reserved deltas on
  receipt/correction rows), and the Arabic error codes. The database does **not** verify that the
  first ledger row of a product starts from zero for products stocked before 0003 (none exist in a
  fresh pilot), nor that `actor_user_id` is an administrator.
- Not modelled: purchasing, costs/valuation, multiple warehouses, expiry batches, accounting.

**Idempotency storage:** the 0001 columns `inventory_ledger.operation_key` / `operation_digest` and the
partial unique index `(actor_user_id, operation_key) WHERE operation_key IS NOT NULL`: one manual
adjustment = one ledger row = one key per administrator. Fulfillment movements (stage 09) are keyed by
the order transition, leave `operation_key` NULL and are therefore unaffected by this index, even when
one transition writes several ledger rows (one per order line).

**Stage-09 boundary:** confirm / cancel / ship will call the same inventory module inside the order
transition transaction: for each order line insert a `reserve` / `release` / `ship` ledger row
(`order_id` set, `reserved_delta`/`on_hand_delta` as in SPEC §5.3) and update the product with
`last_ledger_id`, `version + 1`, guarded so the availability check and the update happen in one
transaction. There is no separate stock implementation and no reservation endpoint.

Test fixtures (`tests/helpers/database.ts`: `insertProduct`, `fixtureAdjustStock`, `fixtureReserve`)
follow these same database rules through a test-only connection; they are never part of the application.
