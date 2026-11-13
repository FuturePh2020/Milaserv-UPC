-- Stage 16: post-restore recovery gate and ledger linkage guard.
--
-- system_state: exactly one row.
--   write_mode     'open' | 'recovery'. In 'recovery' the server accepts reads, sign-in and identical
--                  replays of operations that exist in the data, but no new business writes, until an
--                  operator runs `recovery:reopen` (audited, with a reason).
--   recovery_epoch 0 until the first restore; then a new value per restore. Browsers send the epoch
--                  their operation was prepared under; a NEW write is accepted only for the exact
--                  current epoch (see docs/DATABASE.md §18).
-- The seed row enters recovery mode when this migration runs directly after a restore (the newest
-- audit row is `backup.restored`): restoring a pre-0008 backup and then migrating must not reopen
-- writes silently.
CREATE TABLE system_state (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  write_mode          TEXT    NOT NULL CHECK (write_mode IN ('open', 'recovery')),
  recovery_epoch      INTEGER NOT NULL CHECK (recovery_epoch >= 0),
  restored_backup_id  TEXT    CHECK (restored_backup_id IS NULL OR length(restored_backup_id) = 36),
  restored_backup_at  INTEGER CHECK (restored_backup_at IS NULL OR restored_backup_at > 0),
  recovery_started_at INTEGER CHECK (recovery_started_at IS NULL OR recovery_started_at > 0),
  reopened_at         INTEGER CHECK (reopened_at IS NULL OR reopened_at > 0),
  version             INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT system_state_recovery_fields CHECK (write_mode = 'open' OR recovery_started_at IS NOT NULL)
) STRICT;

INSERT INTO system_state (id, write_mode, recovery_epoch, recovery_started_at, version)
SELECT 1,
       CASE WHEN last_action = 'backup.restored' THEN 'recovery' ELSE 'open' END,
       CASE WHEN last_action = 'backup.restored' THEN 1 ELSE 0 END,
       CASE WHEN last_action = 'backup.restored' THEN last_at ELSE NULL END,
       1
  FROM (SELECT (SELECT action FROM audit_logs ORDER BY id DESC LIMIT 1) AS last_action,
               (SELECT created_at FROM audit_logs ORDER BY id DESC LIMIT 1) AS last_at);

CREATE TRIGGER system_state_no_delete BEFORE DELETE ON system_state
BEGIN SELECT RAISE(ABORT, 'system_state cannot be deleted'); END;

CREATE TRIGGER system_state_version BEFORE UPDATE ON system_state
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'system_state.version must advance by exactly 1'); END;

-- A recovery epoch never returns to an earlier "no restore" value and only changes when entering recovery.
CREATE TRIGGER system_state_epoch_change BEFORE UPDATE OF recovery_epoch ON system_state
WHEN NEW.recovery_epoch <> OLD.recovery_epoch AND (NEW.write_mode <> 'recovery' OR NEW.recovery_epoch = 0)
BEGIN SELECT RAISE(ABORT, 'recovery_epoch changes only when entering recovery mode'); END;

-- Ledger linkage: a new stock movement for a product is refused while an earlier ledger row of that
-- product is not yet linked to the product (products.last_ledger_id). In the supported write sequence
-- every ledger row is linked by the product update in the same transaction, so this only blocks
-- further movements of a product that has an orphan ledger row (fail closed; detected by db:check).
-- It also requires the row's resulting balances to continue from the product's current balances.
CREATE TRIGGER inventory_ledger_continues_product BEFORE INSERT ON inventory_ledger
BEGIN
  SELECT RAISE(ABORT, 'an earlier ledger row of this product is not linked to the product')
   WHERE EXISTS (SELECT 1 FROM inventory_ledger l
                  WHERE l.product_id = NEW.product_id
                    AND l.id > coalesce((SELECT last_ledger_id FROM products WHERE id = NEW.product_id), 0));
  SELECT RAISE(ABORT, 'ledger balances must continue from the product''s current balances')
   WHERE NOT EXISTS (SELECT 1 FROM products p
                      WHERE p.id = NEW.product_id
                        AND NEW.on_hand_after = p.on_hand + NEW.on_hand_delta
                        AND NEW.reserved_after = p.reserved + NEW.reserved_delta);
END;
