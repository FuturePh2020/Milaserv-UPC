-- ALKHAYR B2B — migration 0004: order finalization guards (stage 08).
-- IMMUTABLE once applied. Runs inside the runner's single transaction.
--
-- An order is written in one transaction as: header (orders) -> items (order_items)
-- -> creation event (order_events, NULL -> 'pending'). The creation event is the
-- FINALIZATION MARKER: application reads list and show only orders that have it.
-- These triggers make the marker meaningful at the database level, for every
-- write path (HTTP service, fixtures, future imports):
--   * the marker can only be written once, by the order's creator, while the
--     order is still pending at version 1, and only if the header and the items
--     agree (1..100 items, subtotal = sum of line totals, every item's product
--     has the order's demo classification);
--   * no item can be added after the marker;
--   * no later event and no state change is possible before the marker.
-- Per-line arithmetic (line_total = unit price x cartons), tax base, tax <= base,
-- total = subtotal + tax + shipping and snapshot immutability are already
-- enforced by 0001. What is NOT enforced here: the tax rounding rule, the
-- minimum order, prices/stock at creation time (service rules, see DATABASE.md §13).

CREATE TRIGGER order_events_creation_guard BEFORE INSERT ON order_events
WHEN NEW.old_state IS NULL
BEGIN
  SELECT RAISE(ABORT, 'order creation event already exists')
   WHERE EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = NEW.order_id AND e.old_state IS NULL);
  SELECT RAISE(ABORT, 'order creation event requires a pending order at version 1 created by the event actor')
   WHERE NOT EXISTS (SELECT 1 FROM orders o
                      WHERE o.id = NEW.order_id AND o.state = 'pending' AND o.version = 1
                        AND o.created_by_user_id IS NEW.actor_user_id);
  SELECT RAISE(ABORT, 'order creation event requires 1 to 100 items')
   WHERE (SELECT count(*) FROM order_items i WHERE i.order_id = NEW.order_id) NOT BETWEEN 1 AND 100;
  SELECT RAISE(ABORT, 'order subtotal does not match the sum of its line totals')
   WHERE (SELECT o.subtotal_cents FROM orders o WHERE o.id = NEW.order_id)
         IS NOT (SELECT sum(i.line_total_cents) FROM order_items i WHERE i.order_id = NEW.order_id);
  SELECT RAISE(ABORT, 'order demo classification does not match its products')
   WHERE EXISTS (SELECT 1 FROM order_items i JOIN products p ON p.id = i.product_id JOIN orders o ON o.id = i.order_id
                  WHERE i.order_id = NEW.order_id AND p.is_demo IS NOT o.is_demo);
END;

CREATE TRIGGER order_events_transition_requires_creation BEFORE INSERT ON order_events
WHEN NEW.old_state IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = NEW.order_id AND e.old_state IS NULL)
BEGIN SELECT RAISE(ABORT, 'order has no creation event (unfinished order)'); END;

CREATE TRIGGER order_items_frozen_after_creation BEFORE INSERT ON order_items
WHEN EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = NEW.order_id AND e.old_state IS NULL)
BEGIN SELECT RAISE(ABORT, 'order items cannot be added after the order was created'); END;

CREATE TRIGGER orders_state_change_requires_creation BEFORE UPDATE OF state ON orders
WHEN NEW.state IS NOT OLD.state
 AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = OLD.id AND e.old_state IS NULL)
BEGIN SELECT RAISE(ABORT, 'order has no creation event (unfinished order)'); END;
