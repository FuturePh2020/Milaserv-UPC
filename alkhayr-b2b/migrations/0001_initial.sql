-- ALKHAYR B2B — migration 0001: initial schema.
-- IMMUTABLE once applied anywhere: the runner verifies this file's SHA-256 on
-- every startup. Fix mistakes with a NEW migration (0002_...), never by editing.
-- Runs inside one BEGIN IMMEDIATE transaction opened by the migration runner;
-- it must not contain BEGIN/COMMIT/ROLLBACK statements of its own.
--
-- Conventions (docs/DATABASE.md): STRICT tables; ids are lowercase UUID v4 text;
-- money is INTEGER piasters ("*_cents"); quantities are INTEGER cartons;
-- timestamps are INTEGER Unix epoch milliseconds (UTC); booleans are 0/1.

-- Identifies the file as an ALKHAYR database ('AKHR' = 0x414B4852).
PRAGMA application_id = 1095452754;

-- 1. Migration history -------------------------------------------------------
CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY CHECK (version >= 1),
  name        TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  checksum    TEXT    NOT NULL CHECK (length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'),
  applied_at  INTEGER NOT NULL CHECK (applied_at > 0)
) STRICT;

CREATE TRIGGER schema_migrations_no_update BEFORE UPDATE ON schema_migrations
BEGIN SELECT RAISE(ABORT, 'schema_migrations is append-only'); END;
CREATE TRIGGER schema_migrations_no_delete BEFORE DELETE ON schema_migrations
BEGIN SELECT RAISE(ABORT, 'schema_migrations is append-only'); END;

-- 2. Accounts ----------------------------------------------------------------
CREATE TABLE auth_users (
  id                   TEXT    PRIMARY KEY
                       CONSTRAINT auth_users_id_uuid CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  -- Stored normalized (lowercase ASCII); NOCASE uniqueness is a second guard.
  username             TEXT    NOT NULL COLLATE NOCASE
                       CONSTRAINT auth_users_username_format CHECK (
                         length(username) BETWEEN 3 AND 32
                         AND username GLOB '[a-z0-9]*'
                         AND username NOT GLOB '*[^a-z0-9._-]*'),
  password_hash        TEXT    NOT NULL CHECK (length(password_hash) BETWEEN 20 AND 512),
  password_changed_at  INTEGER NOT NULL CHECK (password_changed_at > 0),
  role                 TEXT    NOT NULL CONSTRAINT auth_users_role CHECK (role IN ('admin', 'trader')),
  totp_ciphertext      TEXT    CHECK (totp_ciphertext IS NULL OR length(totp_ciphertext) BETWEEN 20 AND 1024),
  last_otp_step        INTEGER CHECK (last_otp_step IS NULL OR last_otp_step >= 0),
  created_at           INTEGER NOT NULL CHECK (created_at > 0),
  updated_at           INTEGER NOT NULL CHECK (updated_at >= created_at),
  CONSTRAINT auth_users_admin_requires_totp CHECK (role <> 'admin' OR totp_ciphertext IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX auth_users_username_uq ON auth_users (username COLLATE NOCASE);

CREATE TABLE merchants (
  id                 TEXT    PRIMARY KEY
                     CONSTRAINT merchants_id_uuid CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  user_id            TEXT    NOT NULL UNIQUE REFERENCES auth_users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  business_name      TEXT    NOT NULL CHECK (length(trim(business_name)) BETWEEN 2 AND 120),
  contact_name       TEXT    NOT NULL CHECK (length(trim(contact_name)) BETWEEN 2 AND 80),
  email              TEXT    CHECK (email IS NULL OR (length(email) BETWEEN 3 AND 254 AND email LIKE '%_@_%')),
  phone              TEXT    NOT NULL CHECK (length(phone) BETWEEN 8 AND 20 AND phone NOT GLOB '*[^0-9+]*'),
  governorate        TEXT    NOT NULL CHECK (length(trim(governorate)) BETWEEN 2 AND 60),
  address            TEXT    NOT NULL CHECK (length(trim(address)) BETWEEN 5 AND 300),
  status             TEXT    NOT NULL DEFAULT 'pending'
                     CONSTRAINT merchants_status CHECK (status IN ('pending', 'approved', 'suspended')),
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status_changed_at  INTEGER CHECK (status_changed_at IS NULL OR status_changed_at > 0),
  created_at         INTEGER NOT NULL CHECK (created_at > 0),
  updated_at         INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;
CREATE INDEX merchants_status_created_idx ON merchants (status, created_at, id);

CREATE TRIGGER merchants_version_increment BEFORE UPDATE ON merchants
WHEN NEW.version IS NOT OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'merchants.version must increase by exactly 1 on update'); END;

-- Raw tokens are never stored: token_hash is SHA-256 (hex) of the cookie token.
-- Sessions are disposable credentials (not history): removed with the user.
CREATE TABLE sessions (
  token_hash           TEXT    PRIMARY KEY
                       CONSTRAINT sessions_token_hash_sha256 CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  user_id              TEXT    NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  created_at           INTEGER NOT NULL CHECK (created_at > 0),
  last_seen_at         INTEGER NOT NULL,
  expires_at           INTEGER NOT NULL,
  auth_at              INTEGER NOT NULL,
  password_changed_at  INTEGER NOT NULL CHECK (password_changed_at > 0),
  CONSTRAINT sessions_time_order CHECK (last_seen_at >= created_at AND auth_at >= created_at AND expires_at > created_at)
) STRICT, WITHOUT ROWID;
CREATE INDEX sessions_user_created_idx ON sessions (user_id, created_at);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- 3. Catalog -----------------------------------------------------------------
-- Controlled category list (owner decision, stage 01). Must match
-- src/shared/categories.ts (guarded by tests). Deactivate instead of deleting.
CREATE TABLE product_categories (
  id          TEXT    PRIMARY KEY
              CHECK (length(id) BETWEEN 2 AND 40 AND id GLOB '[a-z]*' AND id NOT GLOB '*[^a-z0-9_]*'),
  label_ar    TEXT    NOT NULL UNIQUE CHECK (length(trim(label_ar)) BETWEEN 2 AND 60),
  sort_order  INTEGER NOT NULL UNIQUE CHECK (sort_order >= 1),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT, WITHOUT ROWID;

CREATE TRIGGER product_categories_no_delete BEFORE DELETE ON product_categories
BEGIN SELECT RAISE(ABORT, 'categories cannot be deleted; deactivate instead'); END;

INSERT INTO product_categories (id, label_ar, sort_order, active) VALUES
  ('chocolate',       'شيكولاتة',       1, 1),
  ('candy',           'كاندي',          2, 1),
  ('wafers_biscuits', 'ويفر وبسكويت',   3, 1),
  ('snacks_nuts',     'سناكس ومكسرات',  4, 1);

CREATE TABLE products (
  id               TEXT    PRIMARY KEY
                   CONSTRAINT products_id_uuid CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  name             TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  brand            TEXT    NOT NULL CHECK (length(trim(brand)) BETWEEN 1 AND 80),
  category         TEXT    NOT NULL REFERENCES product_categories (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Text (leading zeros preserved). Empty barcodes are stored as NULL.
  barcode          TEXT    CONSTRAINT products_barcode_format CHECK (
                     barcode IS NULL OR (length(barcode) BETWEEN 1 AND 32 AND barcode NOT GLOB '*[^0-9A-Za-z-]*')),
  image_url        TEXT    CONSTRAINT products_image_https CHECK (
                     image_url IS NULL OR (length(image_url) BETWEEN 9 AND 2048 AND substr(image_url, 1, 8) = 'https://')),
  -- Carton price in piasters.
  price_cents      INTEGER NOT NULL CONSTRAINT products_price_range CHECK (price_cents BETWEEN 1 AND 100000000),
  -- Cartons. available = on_hand - reserved is computed, never stored.
  on_hand          INTEGER NOT NULL DEFAULT 0 CHECK (on_hand BETWEEN 0 AND 1000000000),
  reserved         INTEGER NOT NULL DEFAULT 0 CONSTRAINT products_reserved_nonnegative CHECK (reserved >= 0),
  pack_size        INTEGER NOT NULL CONSTRAINT products_pack_size_range CHECK (pack_size BETWEEN 1 AND 10000),
  minimum_cartons  INTEGER NOT NULL DEFAULT 1 CONSTRAINT products_minimum_range CHECK (minimum_cartons BETWEEN 1 AND 100000),
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  is_demo          INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at       INTEGER NOT NULL CHECK (created_at > 0),
  updated_at       INTEGER NOT NULL CHECK (updated_at >= created_at),
  CONSTRAINT products_reserved_le_on_hand CHECK (reserved <= on_hand)
) STRICT;
CREATE UNIQUE INDEX products_barcode_uq ON products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX products_catalog_idx ON products (active, category, name);
CREATE INDEX products_brand_idx ON products (brand);
CREATE INDEX products_created_idx ON products (created_at, id);

-- Every update (metadata, price, stock or reservation) must advance the version.
CREATE TRIGGER products_version_increment BEFORE UPDATE ON products
WHEN NEW.version IS NOT OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'products.version must increase by exactly 1 on update'); END;

-- 4. Orders ------------------------------------------------------------------
CREATE TABLE orders (
  id                   TEXT    PRIMARY KEY
                       CONSTRAINT orders_id_uuid CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  display_number       TEXT    NOT NULL UNIQUE
                       CONSTRAINT orders_display_number_format CHECK (
                         display_number GLOB 'AK-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z]'),
  merchant_id          TEXT    NOT NULL REFERENCES merchants (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_by_user_id   TEXT    NOT NULL REFERENCES auth_users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  state                TEXT    NOT NULL DEFAULT 'pending'
                       CONSTRAINT orders_state CHECK (state IN ('pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled')),
  -- Financial snapshot (piasters), fixed at creation.
  subtotal_cents       INTEGER NOT NULL CHECK (subtotal_cents BETWEEN 1 AND 10000000000000),
  shipping_cents       INTEGER NOT NULL CHECK (shipping_cents BETWEEN 0 AND 10000000),
  shipping_taxable     INTEGER NOT NULL CHECK (shipping_taxable IN (0, 1)),
  tax_bps              INTEGER NOT NULL CHECK (tax_bps BETWEEN 0 AND 10000),
  tax_base_cents       INTEGER NOT NULL,
  tax_cents            INTEGER NOT NULL CHECK (tax_cents >= 0),
  total_cents          INTEGER NOT NULL CHECK (total_cents <= 10000000000000),
  minimum_order_cents  INTEGER NOT NULL CHECK (minimum_order_cents >= 0),
  -- Buyer snapshot, fixed at creation.
  buyer_business_name  TEXT    NOT NULL CHECK (length(trim(buyer_business_name)) BETWEEN 2 AND 120),
  buyer_contact_name   TEXT    NOT NULL CHECK (length(trim(buyer_contact_name)) BETWEEN 2 AND 80),
  buyer_phone          TEXT    NOT NULL CHECK (length(buyer_phone) BETWEEN 8 AND 20),
  buyer_governorate    TEXT    NOT NULL CHECK (length(trim(buyer_governorate)) BETWEEN 2 AND 60),
  buyer_address        TEXT    NOT NULL CHECK (length(trim(buyer_address)) BETWEEN 5 AND 300),
  note                 TEXT    CHECK (note IS NULL OR length(note) <= 500),
  is_demo              INTEGER NOT NULL CHECK (is_demo IN (0, 1)),
  -- Idempotency (enforced by the order service in stage 08).
  request_key          TEXT    NOT NULL CHECK (length(request_key) = 36 AND request_key NOT GLOB '*[^0-9a-f-]*'),
  request_digest       TEXT    NOT NULL CHECK (length(request_digest) = 64 AND request_digest NOT GLOB '*[^0-9a-f]*'),
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           INTEGER NOT NULL CHECK (created_at > 0),
  updated_at           INTEGER NOT NULL CHECK (updated_at >= created_at),
  CONSTRAINT orders_tax_base CHECK (tax_base_cents = subtotal_cents + CASE WHEN shipping_taxable = 1 THEN shipping_cents ELSE 0 END),
  CONSTRAINT orders_tax_le_base CHECK (tax_cents <= tax_base_cents),
  CONSTRAINT orders_total CHECK (total_cents = subtotal_cents + tax_cents + shipping_cents),
  CONSTRAINT orders_request_key_scoped UNIQUE (merchant_id, request_key)
) STRICT;
CREATE INDEX orders_merchant_created_idx ON orders (merchant_id, created_at DESC, id DESC);
CREATE INDEX orders_state_created_idx ON orders (state, created_at DESC, id DESC);
CREATE INDEX orders_created_idx ON orders (created_at DESC, id DESC);

CREATE TRIGGER orders_insert_guard BEFORE INSERT ON orders
WHEN NEW.state IS NOT 'pending' OR NEW.version IS NOT 1
BEGIN SELECT RAISE(ABORT, 'orders must be created as pending with version 1'); END;

CREATE TRIGGER orders_version_increment BEFORE UPDATE ON orders
WHEN NEW.version IS NOT OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'orders.version must increase by exactly 1 on update'); END;

-- Only state, version and updated_at may ever change on an order.
CREATE TRIGGER orders_snapshot_immutable BEFORE UPDATE ON orders
WHEN NEW.id IS NOT OLD.id
  OR NEW.display_number IS NOT OLD.display_number
  OR NEW.merchant_id IS NOT OLD.merchant_id
  OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
  OR NEW.subtotal_cents IS NOT OLD.subtotal_cents
  OR NEW.shipping_cents IS NOT OLD.shipping_cents
  OR NEW.shipping_taxable IS NOT OLD.shipping_taxable
  OR NEW.tax_bps IS NOT OLD.tax_bps
  OR NEW.tax_base_cents IS NOT OLD.tax_base_cents
  OR NEW.tax_cents IS NOT OLD.tax_cents
  OR NEW.total_cents IS NOT OLD.total_cents
  OR NEW.minimum_order_cents IS NOT OLD.minimum_order_cents
  OR NEW.buyer_business_name IS NOT OLD.buyer_business_name
  OR NEW.buyer_contact_name IS NOT OLD.buyer_contact_name
  OR NEW.buyer_phone IS NOT OLD.buyer_phone
  OR NEW.buyer_governorate IS NOT OLD.buyer_governorate
  OR NEW.buyer_address IS NOT OLD.buyer_address
  OR NEW.note IS NOT OLD.note
  OR NEW.is_demo IS NOT OLD.is_demo
  OR NEW.request_key IS NOT OLD.request_key
  OR NEW.request_digest IS NOT OLD.request_digest
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'order snapshot is immutable'); END;

-- State machine (docs/SPEC.md §5.4), enforced again in the database.
CREATE TRIGGER orders_state_transition_guard BEFORE UPDATE OF state ON orders
WHEN NEW.state IS NOT OLD.state AND NOT (
     (OLD.state = 'pending'   AND NEW.state IN ('confirmed', 'cancelled'))
  OR (OLD.state = 'confirmed' AND NEW.state IN ('preparing', 'cancelled'))
  OR (OLD.state = 'preparing' AND NEW.state IN ('shipped', 'cancelled'))
  OR (OLD.state = 'shipped'   AND NEW.state = 'delivered'))
BEGIN SELECT RAISE(ABORT, 'illegal order state transition'); END;

CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders
BEGIN SELECT RAISE(ABORT, 'orders cannot be deleted'); END;

CREATE TABLE order_items (
  order_id          TEXT    NOT NULL REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  product_id        TEXT    NOT NULL REFERENCES products (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  line_no           INTEGER NOT NULL CHECK (line_no BETWEEN 1 AND 100),
  -- Snapshot of the product at order time.
  product_name      TEXT    NOT NULL CHECK (length(trim(product_name)) BETWEEN 2 AND 160),
  product_brand     TEXT    NOT NULL CHECK (length(trim(product_brand)) BETWEEN 1 AND 80),
  product_barcode   TEXT    CHECK (product_barcode IS NULL OR length(product_barcode) BETWEEN 1 AND 32),
  pack_size         INTEGER NOT NULL CHECK (pack_size BETWEEN 1 AND 10000),
  unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents BETWEEN 1 AND 100000000),
  cartons           INTEGER NOT NULL CONSTRAINT order_items_cartons_range CHECK (cartons BETWEEN 1 AND 100000),
  line_total_cents  INTEGER NOT NULL,
  CONSTRAINT order_items_line_total CHECK (line_total_cents = unit_price_cents * cartons),
  PRIMARY KEY (order_id, product_id),
  CONSTRAINT order_items_line_no_uq UNIQUE (order_id, line_no)
) STRICT, WITHOUT ROWID;
CREATE INDEX order_items_product_idx ON order_items (product_id);

CREATE TRIGGER order_items_no_update BEFORE UPDATE ON order_items
BEGIN SELECT RAISE(ABORT, 'order items are immutable'); END;
CREATE TRIGGER order_items_no_delete BEFORE DELETE ON order_items
BEGIN SELECT RAISE(ABORT, 'order items are immutable'); END;

CREATE TABLE order_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       TEXT    NOT NULL REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_user_id  TEXT    REFERENCES auth_users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  old_state      TEXT,
  new_state      TEXT    NOT NULL,
  note           TEXT    CHECK (note IS NULL OR length(note) <= 500),
  created_at     INTEGER NOT NULL CHECK (created_at > 0),
  CONSTRAINT order_events_transition CHECK (
       (old_state IS NULL        AND new_state = 'pending')
    OR (old_state = 'pending'    AND new_state IN ('confirmed', 'cancelled'))
    OR (old_state = 'confirmed'  AND new_state IN ('preparing', 'cancelled'))
    OR (old_state = 'preparing'  AND new_state IN ('shipped', 'cancelled'))
    OR (old_state = 'shipped'    AND new_state = 'delivered'))
) STRICT;
CREATE INDEX order_events_order_idx ON order_events (order_id, id);

CREATE TRIGGER order_events_no_update BEFORE UPDATE ON order_events
BEGIN SELECT RAISE(ABORT, 'order_events is append-only'); END;
CREATE TRIGGER order_events_no_delete BEFORE DELETE ON order_events
BEGIN SELECT RAISE(ABORT, 'order_events is append-only'); END;

-- 5. Inventory ledger (append-only; corrections are compensating entries) ---
CREATE TABLE inventory_ledger (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id        TEXT    NOT NULL REFERENCES products (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_user_id     TEXT    REFERENCES auth_users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  kind              TEXT    NOT NULL
                    CONSTRAINT inventory_ledger_kind CHECK (kind IN ('opening', 'receipt', 'correction', 'reserve', 'release', 'ship', 'import')),
  on_hand_delta     INTEGER NOT NULL,
  reserved_delta    INTEGER NOT NULL,
  on_hand_after     INTEGER NOT NULL CHECK (on_hand_after >= 0),
  reserved_after    INTEGER NOT NULL,
  reason            TEXT    CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 3 AND 300),
  external_ref      TEXT    CHECK (external_ref IS NULL OR length(external_ref) BETWEEN 1 AND 100),
  order_id          TEXT    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  operation_key     TEXT    CHECK (operation_key IS NULL OR (length(operation_key) = 36 AND operation_key NOT GLOB '*[^0-9a-f-]*')),
  operation_digest  TEXT    CHECK (operation_digest IS NULL OR (length(operation_digest) = 64 AND operation_digest NOT GLOB '*[^0-9a-f]*')),
  created_at        INTEGER NOT NULL CHECK (created_at > 0),
  CONSTRAINT inventory_ledger_balance_after CHECK (reserved_after >= 0 AND reserved_after <= on_hand_after),
  CONSTRAINT inventory_ledger_nonzero CHECK (on_hand_delta <> 0 OR reserved_delta <> 0),
  CONSTRAINT inventory_ledger_manual_rules CHECK (
    kind NOT IN ('opening', 'receipt', 'correction', 'import') OR (reason IS NOT NULL AND reserved_delta = 0)),
  CONSTRAINT inventory_ledger_receipt_positive CHECK (kind NOT IN ('opening', 'receipt') OR on_hand_delta > 0),
  CONSTRAINT inventory_ledger_order_rules CHECK (kind NOT IN ('reserve', 'release', 'ship') OR order_id IS NOT NULL),
  CONSTRAINT inventory_ledger_reserve CHECK (kind <> 'reserve' OR (on_hand_delta = 0 AND reserved_delta > 0)),
  CONSTRAINT inventory_ledger_release CHECK (kind <> 'release' OR (on_hand_delta = 0 AND reserved_delta < 0)),
  CONSTRAINT inventory_ledger_ship CHECK (kind <> 'ship' OR (on_hand_delta < 0 AND on_hand_delta = reserved_delta)),
  CONSTRAINT inventory_ledger_operation_pair CHECK ((operation_key IS NULL) = (operation_digest IS NULL))
) STRICT;
CREATE INDEX inventory_ledger_product_idx ON inventory_ledger (product_id, id);
CREATE INDEX inventory_ledger_order_idx ON inventory_ledger (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX inventory_ledger_operation_uq ON inventory_ledger (actor_user_id, operation_key) WHERE operation_key IS NOT NULL;

CREATE TRIGGER inventory_ledger_no_update BEFORE UPDATE ON inventory_ledger
BEGIN SELECT RAISE(ABORT, 'inventory_ledger is append-only'); END;
CREATE TRIGGER inventory_ledger_no_delete BEFORE DELETE ON inventory_ledger
BEGIN SELECT RAISE(ABORT, 'inventory_ledger is append-only'); END;

-- 6. Audit and abuse limits --------------------------------------------------
CREATE TABLE audit_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id  TEXT    REFERENCES auth_users (id) ON DELETE RESTRICT ON UPDATE RESTRICT, -- NULL = anonymous
  action         TEXT    NOT NULL CHECK (length(action) BETWEEN 3 AND 64 AND action NOT GLOB '*[^a-z0-9_.]*'),
  target_type    TEXT    CHECK (target_type IS NULL OR (length(target_type) BETWEEN 1 AND 32 AND target_type NOT GLOB '*[^a-z_]*')),
  target_id      TEXT    CHECK (target_id IS NULL OR length(target_id) BETWEEN 1 AND 64),
  metadata       TEXT    CONSTRAINT audit_logs_metadata_json CHECK (
                   metadata IS NULL OR (length(metadata) <= 2048 AND json_valid(metadata) AND json_type(metadata) = 'object')),
  ip_hmac        TEXT    CHECK (ip_hmac IS NULL OR (length(ip_hmac) = 64 AND ip_hmac NOT GLOB '*[^0-9a-f]*')),
  request_id     TEXT    NOT NULL CHECK (length(request_id) = 36 AND request_id NOT GLOB '*[^0-9a-f-]*'),
  created_at     INTEGER NOT NULL CHECK (created_at > 0)
) STRICT;
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at, id);
CREATE INDEX audit_logs_actor_created_idx ON audit_logs (actor_user_id, created_at);

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
-- Retention purge only: rows younger than 365 days cannot be deleted.
CREATE TRIGGER audit_logs_retention_guard BEFORE DELETE ON audit_logs
WHEN OLD.created_at > CAST(unixepoch('subsec') * 1000 AS INTEGER) - 31536000000
BEGIN SELECT RAISE(ABORT, 'audit rows younger than the 365-day retention period cannot be deleted'); END;

CREATE TABLE rate_limits (
  key             TEXT    PRIMARY KEY CHECK (length(key) BETWEEN 16 AND 128),
  count           INTEGER NOT NULL CHECK (count >= 0),
  window_ends_at  INTEGER NOT NULL CHECK (window_ends_at > 0)
) STRICT, WITHOUT ROWID;
CREATE INDEX rate_limits_window_idx ON rate_limits (window_ends_at);

-- 7. Business settings (single row) -------------------------------------------
CREATE TABLE business_settings (
  id                           INTEGER PRIMARY KEY CHECK (id = 1),
  -- Company details are configured by the operator (stage 14); never invented.
  company_name                 TEXT    CHECK (company_name IS NULL OR length(trim(company_name)) BETWEEN 2 AND 120),
  company_phone                TEXT    CHECK (company_phone IS NULL OR (length(company_phone) BETWEEN 8 AND 20 AND company_phone NOT GLOB '*[^0-9+]*')),
  company_email                TEXT    CHECK (company_email IS NULL OR (length(company_email) BETWEEN 3 AND 254 AND company_email LIKE '%_@_%')),
  company_address              TEXT    CHECK (company_address IS NULL OR length(trim(company_address)) BETWEEN 5 AND 300),
  shipping_cents               INTEGER NOT NULL CHECK (shipping_cents BETWEEN 0 AND 10000000),
  shipping_taxable             INTEGER NOT NULL CHECK (shipping_taxable IN (0, 1)),
  tax_bps                      INTEGER NOT NULL CHECK (tax_bps BETWEEN 0 AND 10000),
  minimum_order_cents          INTEGER NOT NULL CHECK (minimum_order_cents BETWEEN 0 AND 1000000000),
  -- Applies to AVAILABLE stock: 0 = out of stock, 1..threshold = low stock.
  low_stock_threshold_cartons  INTEGER NOT NULL CHECK (low_stock_threshold_cartons BETWEEN 0 AND 100000),
  version                      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at                   INTEGER NOT NULL CHECK (updated_at > 0),
  updated_by_user_id           TEXT    REFERENCES auth_users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) STRICT;

CREATE TRIGGER business_settings_version_increment BEFORE UPDATE ON business_settings
WHEN NEW.version IS NOT OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'business_settings.version must increase by exactly 1 on update'); END;
CREATE TRIGGER business_settings_no_delete BEFORE DELETE ON business_settings
BEGIN SELECT RAISE(ABORT, 'business_settings row cannot be deleted'); END;

-- Pilot defaults (owner decision, stage 01; mirrors BUSINESS_SETTING_DEFAULTS).
-- Implementation defaults only, NOT a statement of legal tax treatment.
INSERT INTO business_settings (
  id, company_name, company_phone, company_email, company_address,
  shipping_cents, shipping_taxable, tax_bps, minimum_order_cents, low_stock_threshold_cartons,
  version, updated_at, updated_by_user_id
) VALUES (1, NULL, NULL, NULL, NULL, 0, 0, 0, 0, 10, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), NULL);
