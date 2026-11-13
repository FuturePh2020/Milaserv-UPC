import type { DatabaseSync } from 'node:sqlite';

/**
 * Read-only consistency verifier for the order / allocation / event / ledger / import model
 * (stage 16; invariants derived from docs/DATABASE.md §12–§15 and the migrations).
 *
 * Every check is one aggregate SQL query (bounded memory: counts + at most `maxSamples` sample ids).
 * The verifier never writes, repairs, deletes or hides anything; callers decide how to fail closed.
 *
 * Severity:
 *   error   — the data contradicts the documented write sequence; affected writes must stop.
 *   warning — harmless but unexpected (e.g. an unfinalized order header, invisible to the API).
 *
 * Scope: rows written through the supported write sequence (0003+ ledger pairing, 0005 allocations).
 * Historical shapes that the schema allows (creation events without `order_version_after`, products
 * without any ledger row, cancelled-from-pending orders without allocations) are NOT reported.
 */

export type Severity = 'error' | 'warning';

export interface ConsistencyIssue {
  code: string;
  severity: Severity;
  message: string;
  count: number;
  /** Up to maxSamples identifiers (order ids, product ids, ledger ids, import ids) for operators only. */
  samples: string[];
}

export interface ConsistencyReport {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ConsistencyIssue[];
  checks: string[];
  durationMs: number;
}

interface Check {
  code: string;
  severity: Severity;
  message: string;
  /** SQL returning one column `id` per violating subject. Scope parameters are named :order / :product. */
  sql: string;
  scope: Array<'order' | 'product'>;
  minVersion?: number;
}

// Finalized order = has its creation event.
const FINALIZED = `EXISTS (SELECT 1 FROM order_events c WHERE c.order_id = o.id AND c.old_state IS NULL)`;
const ORDER_FILTER = `(:order IS NULL OR o.id = :order)`;
const PRODUCT_FILTER = `(:product IS NULL OR p.id = :product)`;

const CHECKS: Check[] = [
  // ---------------------------------------------------------------- orders and events
  {
    code: 'ORDER_UNFINALIZED',
    severity: 'warning',
    message: 'order header without its creation event (invisible to the API; never written by the service)',
    sql: `SELECT o.id FROM orders o WHERE ${ORDER_FILTER} AND NOT ${FINALIZED}`,
    scope: ['order'],
  },
  {
    code: 'ORDER_UNFINALIZED_CHANGED',
    severity: 'error',
    message: 'unfinalized order header that is not pending at version 1',
    sql: `SELECT o.id FROM orders o WHERE ${ORDER_FILTER} AND NOT ${FINALIZED} AND (o.state <> 'pending' OR o.version <> 1)`,
    scope: ['order'],
  },
  {
    code: 'ORDER_CREATION_EVENT_COUNT',
    severity: 'error',
    message: 'order with more than one creation event, or a creation event not first',
    sql: `SELECT o.id FROM orders o WHERE ${ORDER_FILTER} AND (
            (SELECT count(*) FROM order_events e WHERE e.order_id = o.id AND e.old_state IS NULL) > 1
         OR EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.old_state IS NOT NULL
                     AND e.id < (SELECT min(c.id) FROM order_events c WHERE c.order_id = o.id AND c.old_state IS NULL)))`,
    scope: ['order'],
  },
  {
    code: 'ORDER_ITEMS_TOTALS',
    severity: 'error',
    message: 'finalized order whose items (1–100) do not add up to its subtotal',
    sql: `SELECT o.id FROM orders o WHERE ${ORDER_FILTER} AND ${FINALIZED} AND (
            (SELECT count(*) FROM order_items i WHERE i.order_id = o.id) NOT BETWEEN 1 AND 100
         OR o.subtotal_cents <> (SELECT coalesce(sum(i.line_total_cents), 0) FROM order_items i WHERE i.order_id = o.id))`,
    scope: ['order'],
  },
  {
    code: 'ORDER_EVENT_CHAIN',
    severity: 'error',
    message: 'transition events are not a contiguous chain (each starts from the previous state; versions 2, 3, …)',
    sql: `WITH t AS (
            SELECT e.order_id, e.old_state, e.new_state, e.order_version_after,
                   lag(e.new_state) OVER (PARTITION BY e.order_id ORDER BY e.id) AS prev_state,
                   row_number() OVER (PARTITION BY e.order_id ORDER BY e.id) AS n
              FROM order_events e JOIN orders o ON o.id = e.order_id WHERE ${ORDER_FILTER})
          SELECT DISTINCT order_id AS id FROM t
           WHERE n > 1 AND (old_state IS NULL OR old_state IS NOT prev_state OR order_version_after IS NOT n)`,
    scope: ['order'],
  },
  {
    code: 'ORDER_STATE_MISMATCH',
    severity: 'error',
    message: 'order state/version does not match its latest committed event (an event without its state change, or the reverse)',
    sql: `SELECT o.id FROM orders o WHERE ${ORDER_FILTER} AND ${FINALIZED} AND (
            o.state IS NOT (SELECT e.new_state FROM order_events e WHERE e.order_id = o.id ORDER BY e.id DESC LIMIT 1)
         OR o.version IS NOT (SELECT count(*) FROM order_events e WHERE e.order_id = o.id))`,
    scope: ['order'],
  },
  // ---------------------------------------------------------------- allocations vs. order lifecycle
  {
    code: 'ALLOCATION_LIFECYCLE',
    severity: 'error',
    message: 'allocations do not match the order lifecycle (one per line once confirmed; reserved/consumed/released per state; none if never confirmed)',
    sql: `SELECT o.id FROM orders o WHERE ${ORDER_FILTER} AND ${FINALIZED} AND (
            CASE
              WHEN EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.new_state = 'confirmed') THEN
                (SELECT count(*) FROM order_items i WHERE i.order_id = o.id) <> (SELECT count(*) FROM order_allocations a WHERE a.order_id = o.id)
                OR EXISTS (SELECT 1 FROM order_allocations a WHERE a.order_id = o.id AND a.status <> CASE
                     WHEN o.state IN ('confirmed', 'preparing') THEN 'reserved'
                     WHEN o.state IN ('shipped', 'delivered') THEN 'consumed'
                     WHEN o.state = 'cancelled' THEN 'released' ELSE '?' END)
              ELSE EXISTS (SELECT 1 FROM order_allocations a WHERE a.order_id = o.id)
            END)`,
    scope: ['order'],
  },
  {
    code: 'ALLOCATION_QUANTITY',
    severity: 'error',
    message: 'allocation quantity differs from the immutable carton quantity of its line',
    sql: `SELECT DISTINCT a.order_id AS id FROM order_allocations a JOIN orders o ON o.id = a.order_id
            JOIN order_items i ON i.order_id = a.order_id AND i.product_id = a.product_id
           WHERE ${ORDER_FILTER} AND a.quantity <> i.cartons`,
    scope: ['order'],
  },
  {
    code: 'ALLOCATION_LEDGER_PAIRING',
    severity: 'error',
    message: 'allocation not paired with its own reserve / release / ship ledger rows (same order, product and quantity)',
    sql: `SELECT DISTINCT a.order_id AS id FROM order_allocations a JOIN orders o ON o.id = a.order_id
            LEFT JOIN inventory_ledger r ON r.id = a.reserve_ledger_id
            LEFT JOIN inventory_ledger s ON s.id = a.settle_ledger_id
           WHERE ${ORDER_FILTER} AND (
                 r.id IS NULL OR r.kind <> 'reserve' OR r.order_id IS NOT a.order_id OR r.product_id <> a.product_id OR r.reserved_delta <> a.quantity
              OR (a.status = 'reserved' AND a.settle_ledger_id IS NOT NULL)
              OR (a.status = 'released' AND (s.id IS NULL OR s.kind <> 'release' OR s.order_id IS NOT a.order_id OR s.product_id <> a.product_id OR s.reserved_delta <> -a.quantity OR s.on_hand_delta <> 0))
              OR (a.status = 'consumed' AND (s.id IS NULL OR s.kind <> 'ship' OR s.order_id IS NOT a.order_id OR s.product_id <> a.product_id OR s.on_hand_delta <> -a.quantity OR s.reserved_delta <> -a.quantity)))`,
    scope: ['order'],
  },
  {
    code: 'LEDGER_ORDER_MOVEMENT_ORPHAN',
    severity: 'error',
    message: 'reserve/release/ship ledger row not referenced by exactly one allocation of the same order and product (orphan reservation intent or cross-order consumption)',
    sql: `SELECT DISTINCT l.order_id AS id FROM inventory_ledger l JOIN orders o ON o.id = l.order_id
           WHERE ${ORDER_FILTER} AND l.kind IN ('reserve', 'release', 'ship') AND 1 <> (
                 SELECT count(*) FROM order_allocations a
                  WHERE a.order_id = l.order_id AND a.product_id = l.product_id
                    AND ((l.kind = 'reserve' AND a.reserve_ledger_id = l.id) OR (l.kind <> 'reserve' AND a.settle_ledger_id = l.id)))`,
    scope: ['order'],
  },
  // ---------------------------------------------------------------- products and ledger
  {
    code: 'LEDGER_UNLINKED',
    severity: 'error',
    message: 'product has ledger rows newer than its linked last_ledger_id (a movement that never changed the product)',
    sql: `SELECT p.id FROM products p WHERE ${PRODUCT_FILTER}
             AND EXISTS (SELECT 1 FROM inventory_ledger l WHERE l.product_id = p.id AND l.id > coalesce(p.last_ledger_id, 0))`,
    scope: ['product'],
  },
  {
    code: 'LEDGER_BALANCE_CHAIN',
    severity: 'error',
    message: 'ledger running balances do not follow from the deltas, or the product balance differs from its ledger',
    sql: `WITH r AS (
            SELECT l.product_id, l.on_hand_after, l.reserved_after,
                   sum(l.on_hand_delta) OVER w AS on_hand_sum, sum(l.reserved_delta) OVER w AS reserved_sum
              FROM inventory_ledger l JOIN products p ON p.id = l.product_id
             WHERE ${PRODUCT_FILTER}
            WINDOW w AS (PARTITION BY l.product_id ORDER BY l.id ROWS UNBOUNDED PRECEDING))
          SELECT DISTINCT product_id AS id FROM r WHERE on_hand_after <> on_hand_sum OR reserved_after <> reserved_sum
          UNION
          SELECT p.id FROM products p LEFT JOIN inventory_ledger l ON l.id = p.last_ledger_id
           WHERE ${PRODUCT_FILTER} AND (
                 (p.last_ledger_id IS NULL AND (p.on_hand <> 0 OR p.reserved <> 0))
              OR (p.last_ledger_id IS NOT NULL AND (l.id IS NULL OR l.product_id <> p.id OR l.on_hand_after <> p.on_hand OR l.reserved_after <> p.reserved)))`,
    scope: ['product'],
  },
  {
    code: 'RESERVED_ALLOCATIONS',
    severity: 'error',
    message: 'product reserved quantity differs from its outstanding (reserved) allocations',
    sql: `SELECT p.id FROM products p WHERE ${PRODUCT_FILTER}
             AND p.reserved <> coalesce((SELECT sum(a.quantity) FROM order_allocations a WHERE a.product_id = p.id AND a.status = 'reserved'), 0)`,
    scope: ['product'],
  },
  {
    code: 'LEDGER_VERSION_AHEAD',
    severity: 'error',
    message: 'ledger row records a product version newer than the product',
    sql: `SELECT DISTINCT p.id FROM products p JOIN inventory_ledger l ON l.product_id = p.id
           WHERE ${PRODUCT_FILTER} AND l.product_version_after IS NOT NULL AND l.product_version_after > p.version`,
    scope: ['product'],
  },
  // ---------------------------------------------------------------- imports (migration 0006)
  {
    code: 'IMPORT_ITEMS',
    severity: 'error',
    message: 'import batch whose items do not match its record count or mode (stock modes link one own ledger row per item; product modes none)',
    sql: `SELECT x.id FROM import_operations x WHERE (:order IS NULL AND :product IS NULL) AND (
            x.record_count <> (SELECT count(*) FROM import_operation_items i WHERE i.import_id = x.id)
         OR EXISTS (SELECT 1 FROM import_operation_items i LEFT JOIN inventory_ledger l ON l.id = i.ledger_id
                     WHERE i.import_id = x.id AND (
                           (x.mode IN ('receive_stock', 'set_stock_total') AND (l.id IS NULL OR l.product_id <> i.product_id OR l.actor_user_id IS NOT x.actor_user_id
                              OR l.adjustment_type IS NOT CASE x.mode WHEN 'receive_stock' THEN 'receipt' ELSE 'set_total' END))
                        OR (x.mode IN ('create_products', 'update_products') AND i.ledger_id IS NOT NULL))))`,
    scope: [],
    minVersion: 6,
  },
  // ---------------------------------------------------------------- accounts
  {
    code: 'ADMIN_WITHOUT_MFA',
    severity: 'error',
    message: 'administrator without an MFA enrollment',
    sql: `SELECT u.id FROM auth_users u WHERE (:order IS NULL AND :product IS NULL) AND u.role = 'admin' AND u.totp_ciphertext IS NULL`,
    scope: [],
  },
];

function schemaVersion(db: DatabaseSync): number {
  try {
    return Number((db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0);
  } catch {
    return 0;
  }
}

function run(db: DatabaseSync, checks: Check[], params: { order: string | null; product: string | null }, maxSamples: number): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  for (const c of checks) {
    const stmt = db.prepare(`WITH v AS (${c.sql}) SELECT count(*) AS n, (SELECT json_group_array(id) FROM (SELECT id FROM v ORDER BY id LIMIT :max)) AS sample FROM v`);
    stmt.setAllowUnknownNamedParameters(true); // not every check uses both scope parameters
    const row = stmt.get({ ...params, max: maxSamples }) as {
      n: number;
      sample: string;
    };
    const n = Number(row.n);
    if (n > 0) issues.push({ code: c.code, severity: c.severity, message: c.message, count: n, samples: (JSON.parse(row.sample) as unknown[]).map(String) });
  }
  return issues;
}

/** Whole-database verification. */
export function verifyConsistency(db: DatabaseSync, o: { maxSamples?: number } = {}): ConsistencyReport {
  const started = performance.now();
  const version = schemaVersion(db);
  const applicable = CHECKS.filter((c) => (c.minVersion ?? 0) <= version);
  const issues = run(db, applicable, { order: null, product: null }, Math.max(0, Math.min(o.maxSamples ?? 10, 100)));
  const errors = issues.filter((i) => i.severity === 'error').length;
  return {
    ok: errors === 0,
    errors,
    warnings: issues.length - errors,
    issues,
    checks: applicable.map((c) => c.code),
    durationMs: Math.round(performance.now() - started),
  };
}

/** Error codes affecting ONE order (write guard before a transition). */
export function orderConsistencyErrors(db: DatabaseSync, orderId: string): string[] {
  return run(db, CHECKS.filter((c) => c.severity === 'error' && c.scope.includes('order')), { order: orderId, product: null }, 0).map((i) => i.code);
}

/** Error codes affecting ONE product (write guard before a stock movement). */
export function productConsistencyErrors(db: DatabaseSync, productId: string): string[] {
  return run(db, CHECKS.filter((c) => c.severity === 'error' && c.scope.includes('product')), { order: null, product: productId }, 0).map((i) => i.code);
}

export const CONSISTENCY_CHECK_CODES: readonly string[] = CHECKS.map((c) => c.code);
