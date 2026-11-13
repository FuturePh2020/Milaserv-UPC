-- ALKHAYR B2B — migration 0006: committed CSV import operations (stage 13).
-- IMMUTABLE once applied. Runs inside the runner's single transaction.
--
-- One row per COMMITTED import batch (never for previews), scoped to the administrator and the
-- client-generated operation key: the durable idempotency record. The uploaded file itself is NOT
-- stored; only its SHA-256, size, mode and record count. Per-record results link the products and
-- ledger rows written by the batch. Everything is written in the same transaction as the products,
-- ledger rows and audit events it describes, so a failed batch leaves no import record.

CREATE TABLE import_operations (
  id              TEXT    PRIMARY KEY CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  actor_user_id   TEXT    NOT NULL REFERENCES auth_users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  operation_key   TEXT    NOT NULL CHECK (length(operation_key) = 36 AND operation_key NOT GLOB '*[^0-9a-f-]*'),
  request_digest  TEXT    NOT NULL CHECK (length(request_digest) = 64 AND request_digest NOT GLOB '*[^0-9a-f]*'),
  mode            TEXT    NOT NULL CHECK (mode IN ('create_products', 'update_products', 'receive_stock', 'set_stock_total')),
  content_sha256  TEXT    NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  file_bytes      INTEGER NOT NULL CHECK (file_bytes BETWEEN 1 AND 1048576),
  record_count    INTEGER NOT NULL CHECK (record_count BETWEEN 1 AND 1000),
  created_at      INTEGER NOT NULL CHECK (created_at > 0)
) STRICT;
CREATE UNIQUE INDEX import_operations_key_uq ON import_operations (actor_user_id, operation_key);
CREATE INDEX import_operations_created_idx ON import_operations (created_at, id);

CREATE TABLE import_operation_items (
  import_id              TEXT    NOT NULL REFERENCES import_operations (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  record_no              INTEGER NOT NULL CHECK (record_no BETWEEN 1 AND 1000),
  line_no                INTEGER NOT NULL CHECK (line_no >= 2),
  product_id             TEXT    NOT NULL REFERENCES products (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ledger_id              INTEGER UNIQUE REFERENCES inventory_ledger (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  product_version_after  INTEGER NOT NULL CHECK (product_version_after >= 1),
  PRIMARY KEY (import_id, record_no),
  UNIQUE (import_id, product_id)
) STRICT, WITHOUT ROWID;

-- Stock modes link exactly one ledger row of the same product, written by the same administrator,
-- of the matching adjustment type and resulting product version; product modes link none.
CREATE TRIGGER import_operation_items_consistent BEFORE INSERT ON import_operation_items
WHEN NOT EXISTS (
  SELECT 1 FROM import_operations o
   WHERE o.id = NEW.import_id
     AND (
          (o.mode IN ('create_products', 'update_products') AND NEW.ledger_id IS NULL)
       OR (o.mode IN ('receive_stock', 'set_stock_total') AND NEW.ledger_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM inventory_ledger l
              WHERE l.id = NEW.ledger_id
                AND l.product_id = NEW.product_id
                AND l.actor_user_id = o.actor_user_id
                AND l.product_version_after = NEW.product_version_after
                AND l.adjustment_type = CASE o.mode WHEN 'receive_stock' THEN 'receipt' ELSE 'set_total' END)))
)
BEGIN SELECT RAISE(ABORT, 'import item must match its operation mode and its own ledger row'); END;

CREATE TRIGGER import_operations_no_update BEFORE UPDATE ON import_operations
BEGIN SELECT RAISE(ABORT, 'import_operations is append-only'); END;
CREATE TRIGGER import_operations_no_delete BEFORE DELETE ON import_operations
BEGIN SELECT RAISE(ABORT, 'import_operations is append-only'); END;
CREATE TRIGGER import_operation_items_no_update BEFORE UPDATE ON import_operation_items
BEGIN SELECT RAISE(ABORT, 'import_operation_items is append-only'); END;
CREATE TRIGGER import_operation_items_no_delete BEFORE DELETE ON import_operation_items
BEGIN SELECT RAISE(ABORT, 'import_operation_items is append-only'); END;
