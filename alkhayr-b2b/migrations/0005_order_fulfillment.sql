-- ALKHAYR B2B — migration 0005: order fulfillment, per-order reservations (stage 09).
-- IMMUTABLE once applied. Runs inside the runner's single transaction.
--
-- Write sequence of one order transition (one transaction), per order line:
--   1. inventory_ledger row (kind reserve | release | ship, order_id set)
--   2. order_allocations INSERT (reserve) or UPDATE reserved -> released | consumed (referencing that row)
--   3. products UPDATE linked to that row (0003 pairing: deltas, balances, version)
-- then:
--   4. order_events row (old_state -> new_state, actor, operation key/digest, version after)
--   5. orders UPDATE state, version + 1
-- The triggers below make each step check the previous ones, so stock moved for an order is
-- always attributable to exactly one allocation of exactly that order. Exact boundary: DATABASE.md §14.

-- 1. Per-order, per-product reservation record ("allocation").
--    outstanding(allocation) = quantity when status = 'reserved', else 0.
CREATE TABLE order_allocations (
  order_id           TEXT    NOT NULL,
  product_id         TEXT    NOT NULL REFERENCES products (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  quantity           INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  status             TEXT    NOT NULL CHECK (status IN ('reserved', 'released', 'consumed')),
  reserve_ledger_id  INTEGER NOT NULL UNIQUE REFERENCES inventory_ledger (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  settle_ledger_id   INTEGER UNIQUE REFERENCES inventory_ledger (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at         INTEGER NOT NULL CHECK (created_at > 0),
  settled_at         INTEGER CHECK (settled_at IS NULL OR settled_at > 0),
  PRIMARY KEY (order_id, product_id),
  FOREIGN KEY (order_id, product_id) REFERENCES order_items (order_id, product_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT order_allocations_settlement CHECK (
    (status = 'reserved') = (settle_ledger_id IS NULL) AND (settle_ledger_id IS NULL) = (settled_at IS NULL))
) STRICT;
CREATE INDEX order_allocations_product_idx ON order_allocations (product_id, status);

CREATE TRIGGER order_allocations_insert_guard BEFORE INSERT ON order_allocations
WHEN NOT (
      NEW.status = 'reserved' AND NEW.settle_ledger_id IS NULL AND NEW.settled_at IS NULL
  AND EXISTS (SELECT 1 FROM inventory_ledger l
               WHERE l.id = NEW.reserve_ledger_id AND l.kind = 'reserve' AND l.order_id = NEW.order_id
                 AND l.product_id = NEW.product_id AND l.reserved_delta = NEW.quantity)
  AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = NEW.order_id AND i.product_id = NEW.product_id AND i.cartons = NEW.quantity))
BEGIN SELECT RAISE(ABORT, 'order allocation must be created reserved, for the full line quantity, from its own reserve ledger row'); END;

CREATE TRIGGER order_allocations_update_guard BEFORE UPDATE ON order_allocations
WHEN NOT (
      OLD.status = 'reserved' AND NEW.status IN ('released', 'consumed')
  AND NEW.order_id IS OLD.order_id AND NEW.product_id IS OLD.product_id AND NEW.quantity IS OLD.quantity
  AND NEW.reserve_ledger_id IS OLD.reserve_ledger_id AND NEW.created_at IS OLD.created_at
  AND NEW.settle_ledger_id IS NOT NULL AND NEW.settled_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM inventory_ledger l
               WHERE l.id = NEW.settle_ledger_id AND l.order_id = OLD.order_id AND l.product_id = OLD.product_id
                 AND l.kind = CASE NEW.status WHEN 'released' THEN 'release' ELSE 'ship' END
                 AND l.reserved_delta = -OLD.quantity))
BEGIN SELECT RAISE(ABORT, 'order allocation can only be settled once (released or consumed) by its own matching ledger row'); END;

CREATE TRIGGER order_allocations_no_delete BEFORE DELETE ON order_allocations
BEGIN SELECT RAISE(ABORT, 'order_allocations rows cannot be deleted'); END;

-- 2. Order movements in the ledger: at most one reserve, one release and one ship row per order line,
--    each only while the order is in the state that permits it.
CREATE UNIQUE INDEX inventory_ledger_order_movement_uq ON inventory_ledger (order_id, product_id, kind) WHERE order_id IS NOT NULL;

-- Applies to rows that pass the ledger CHECKs (malformed rows are rejected by those CHECKs).
CREATE TRIGGER inventory_ledger_reserve_guard BEFORE INSERT ON inventory_ledger
WHEN NEW.kind = 'reserve' AND NEW.order_id IS NOT NULL AND NEW.on_hand_delta = 0 AND NEW.reserved_delta > 0
 AND NOT (
       EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = NEW.order_id AND e.old_state IS NULL)
   AND EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.state = 'pending')
   AND EXISTS (SELECT 1 FROM order_items i JOIN products p ON p.id = i.product_id
                WHERE i.order_id = NEW.order_id AND i.product_id = NEW.product_id
                  AND i.cartons = NEW.reserved_delta AND i.pack_size = p.pack_size)
   AND NOT EXISTS (SELECT 1 FROM order_allocations a WHERE a.order_id = NEW.order_id AND a.product_id = NEW.product_id))
BEGIN SELECT RAISE(ABORT, 'reserve movement requires a finalized pending order line with the same quantity and packaging, not yet allocated'); END;

CREATE TRIGGER inventory_ledger_settle_guard BEFORE INSERT ON inventory_ledger
WHEN NEW.kind IN ('release', 'ship') AND NEW.order_id IS NOT NULL AND NEW.reserved_delta < 0
 AND NOT (
       EXISTS (SELECT 1 FROM order_allocations a
                WHERE a.order_id = NEW.order_id AND a.product_id = NEW.product_id
                  AND a.status = 'reserved' AND a.quantity = -NEW.reserved_delta)
   AND EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id
                 AND ((NEW.kind = 'release' AND o.state IN ('confirmed', 'preparing'))
                   OR (NEW.kind = 'ship' AND o.state = 'preparing'))))
BEGIN SELECT RAISE(ABORT, 'release/ship movement requires this order''s own outstanding allocation of the same quantity in a state that permits it'); END;

-- 3. A product stock change caused by an order movement must be backed by the allocation that
--    references that ledger row (attribution; 0003 already checks the balances).
CREATE TRIGGER products_order_movement_requires_allocation BEFORE UPDATE OF last_ledger_id ON products
WHEN NEW.last_ledger_id IS NOT OLD.last_ledger_id
 AND EXISTS (SELECT 1 FROM inventory_ledger l WHERE l.id = NEW.last_ledger_id AND l.kind IN ('reserve', 'release', 'ship'))
 AND NOT EXISTS (SELECT 1 FROM order_allocations a
                  WHERE a.reserve_ledger_id = NEW.last_ledger_id OR a.settle_ledger_id = NEW.last_ledger_id)
BEGIN SELECT RAISE(ABORT, 'order stock movement is not backed by an order allocation'); END;

-- 4. Packaging integrity: pieces-per-carton cannot change while the product has stock or reservations.
CREATE TRIGGER products_pack_size_locked_while_stocked BEFORE UPDATE OF pack_size ON products
WHEN NEW.pack_size IS NOT OLD.pack_size
 AND (OLD.on_hand <> 0 OR OLD.reserved <> 0 OR NEW.on_hand <> 0 OR NEW.reserved <> 0)
BEGIN SELECT RAISE(ABORT, 'pack_size cannot change while the product has stock or reservations'); END;

-- 5. Transition events: idempotency and result columns; chain and actor rules.
ALTER TABLE order_events ADD COLUMN operation_key TEXT
  CHECK (operation_key IS NULL OR (length(operation_key) = 36 AND operation_key NOT GLOB '*[^0-9a-f-]*'));
ALTER TABLE order_events ADD COLUMN operation_digest TEXT
  CHECK (operation_digest IS NULL OR (length(operation_digest) = 64 AND operation_digest NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE order_events ADD COLUMN order_version_after INTEGER CHECK (order_version_after IS NULL OR order_version_after >= 1);
-- Transition operation keys are scoped to the administrator who sent them.
CREATE UNIQUE INDEX order_events_operation_uq ON order_events (actor_user_id, operation_key) WHERE operation_key IS NOT NULL;

-- Applies to legal transitions (illegal ones are rejected by the 0001 CHECK).
CREATE TRIGGER order_events_transition_guard BEFORE INSERT ON order_events
WHEN NEW.old_state IS NOT NULL
 AND ((NEW.old_state = 'pending' AND NEW.new_state IN ('confirmed', 'cancelled'))
   OR (NEW.old_state = 'confirmed' AND NEW.new_state IN ('preparing', 'cancelled'))
   OR (NEW.old_state = 'preparing' AND NEW.new_state IN ('shipped', 'cancelled'))
   OR (NEW.old_state = 'shipped' AND NEW.new_state = 'delivered'))
BEGIN
  SELECT RAISE(ABORT, 'transition event must start from the order''s current state and latest event')
   WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.state = NEW.old_state)
      OR (SELECT e.new_state FROM order_events e WHERE e.order_id = NEW.order_id ORDER BY e.id DESC LIMIT 1) IS NOT NEW.old_state;
  SELECT RAISE(ABORT, 'transition event requires an administrator actor')
   WHERE NOT EXISTS (SELECT 1 FROM auth_users u WHERE u.id = NEW.actor_user_id AND u.role = 'admin');
  SELECT RAISE(ABORT, 'cancellation requires a reason')
   WHERE NEW.new_state = 'cancelled' AND (NEW.note IS NULL OR length(trim(NEW.note)) < 3);
  SELECT RAISE(ABORT, 'transition event operation key, digest and resulting version must be recorded together')
   WHERE (NEW.operation_key IS NULL) <> (NEW.operation_digest IS NULL)
      OR NEW.order_version_after IS NOT (SELECT o.version + 1 FROM orders o WHERE o.id = NEW.order_id);
END;

-- 6. Order state changes (legal, well-formed ones) require the matching latest event, the
--    allocation state of the target, and every order movement row to belong to an allocation.
CREATE TRIGGER orders_transition_consistency BEFORE UPDATE OF state ON orders
WHEN NEW.state IS NOT OLD.state AND NEW.version = OLD.version + 1
 AND ((OLD.state = 'pending' AND NEW.state IN ('confirmed', 'cancelled'))
   OR (OLD.state = 'confirmed' AND NEW.state IN ('preparing', 'cancelled'))
   OR (OLD.state = 'preparing' AND NEW.state IN ('shipped', 'cancelled'))
   OR (OLD.state = 'shipped' AND NEW.state = 'delivered'))
BEGIN
  SELECT RAISE(ABORT, 'order state change requires its transition event')
   WHERE NOT EXISTS (SELECT 1 FROM order_events e
                      WHERE e.id = (SELECT max(e2.id) FROM order_events e2 WHERE e2.order_id = OLD.id)
                        AND e.old_state = OLD.state AND e.new_state = NEW.state AND e.order_version_after = NEW.version);
  SELECT RAISE(ABORT, 'order has stock movements not backed by its allocations')
   WHERE EXISTS (SELECT 1 FROM inventory_ledger l
                  WHERE l.order_id = OLD.id AND l.kind IN ('reserve', 'release', 'ship')
                    AND NOT EXISTS (SELECT 1 FROM order_allocations a WHERE a.reserve_ledger_id = l.id OR a.settle_ledger_id = l.id));
  SELECT RAISE(ABORT, 'order allocations do not match the target state')
   WHERE (SELECT count(*) FROM order_items i WHERE i.order_id = OLD.id)
         IS NOT (SELECT count(*) FROM order_allocations a
                  WHERE a.order_id = OLD.id
                    AND a.status = CASE NEW.state WHEN 'confirmed' THEN 'reserved' WHEN 'preparing' THEN 'reserved'
                                                  WHEN 'shipped' THEN 'consumed' WHEN 'delivered' THEN 'consumed'
                                                  ELSE 'released' END)
     AND NOT (NEW.state = 'cancelled' AND OLD.state = 'pending'
              AND NOT EXISTS (SELECT 1 FROM order_allocations a WHERE a.order_id = OLD.id));
  SELECT RAISE(ABORT, 'buyer must be approved to confirm, prepare or ship an order')
   WHERE NEW.state IN ('confirmed', 'preparing', 'shipped')
     AND NOT EXISTS (SELECT 1 FROM merchants m WHERE m.id = OLD.merchant_id AND m.status = 'approved');
END;
