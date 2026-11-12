-- ALKHAYR B2B — migration 0003: inventory integrity (stage 07).
-- IMMUTABLE once applied. Runs inside the runner's single transaction.

-- 1. New products are created inactive with zero stock and no ledger link.
-- 0001 keeps `active DEFAULT 1` (changing a default needs a table rebuild); this
-- trigger makes that default unusable: any insert must state active = 0
-- explicitly, otherwise it is rejected (fail closed). Activation and stock are
-- separate, audited operations.
ALTER TABLE products ADD COLUMN last_ledger_id INTEGER REFERENCES inventory_ledger (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER products_insert_inactive_without_stock BEFORE INSERT ON products
WHEN NEW.active IS NOT 0 OR NEW.on_hand IS NOT 0 OR NEW.reserved IS NOT 0 OR NEW.last_ledger_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'products must be inserted inactive with zero stock; activation and stock are separate audited operations'); END;

-- 2. Ledger traceability for committed results and idempotent replays.
ALTER TABLE inventory_ledger ADD COLUMN product_version_after INTEGER CHECK (product_version_after IS NULL OR product_version_after >= 1);
ALTER TABLE inventory_ledger ADD COLUMN adjustment_type TEXT
  CHECK (adjustment_type IS NULL OR adjustment_type IN ('receipt', 'correction_delta', 'set_total'));

-- 3. Every change of on_hand or reserved must be accompanied by exactly one NEW
-- ledger row for this product (id greater than the previous link) whose deltas,
-- resulting balances and product_version_after match the update. The ledger row
-- is inserted first, then the product is updated with last_ledger_id = its id.
-- This applies to every write path (manual adjustments now, fulfillment in
-- stage 09, any future import), not only to the HTTP service.
CREATE TRIGGER products_stock_change_requires_ledger BEFORE UPDATE ON products
WHEN (NEW.on_hand IS NOT OLD.on_hand OR NEW.reserved IS NOT OLD.reserved)
 AND NOT (
       NEW.last_ledger_id IS NOT NULL
   AND (OLD.last_ledger_id IS NULL OR NEW.last_ledger_id > OLD.last_ledger_id)
   AND EXISTS (
         SELECT 1 FROM inventory_ledger l
          WHERE l.id = NEW.last_ledger_id
            AND l.product_id = NEW.id
            AND l.on_hand_delta = NEW.on_hand - OLD.on_hand
            AND l.reserved_delta = NEW.reserved - OLD.reserved
            AND l.on_hand_after = NEW.on_hand
            AND l.reserved_after = NEW.reserved
            AND l.product_version_after = NEW.version))
BEGIN SELECT RAISE(ABORT, 'stock changes require a matching new inventory_ledger row (last_ledger_id)'); END;

CREATE TRIGGER products_ledger_link_only_with_stock_change BEFORE UPDATE OF last_ledger_id ON products
WHEN NEW.last_ledger_id IS NOT OLD.last_ledger_id AND NEW.on_hand IS OLD.on_hand AND NEW.reserved IS OLD.reserved
BEGIN SELECT RAISE(ABORT, 'last_ledger_id changes only together with a stock change'); END;
