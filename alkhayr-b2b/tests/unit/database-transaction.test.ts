import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { openDatabase } from '../../src/server/database/connection.ts';
import { DatabaseBusyError } from '../../src/server/database/errors.ts';
import { AsyncTransactionError, NestedTransactionError, readTransaction, writeTransaction } from '../../src/server/database/transaction.ts';
import { createTestDatabase, fixtureReserve, insertMerchant, insertOrder, insertProduct, insertUser } from '../helpers/database.ts';

const count = (db: { prepare(s: string): { get(): unknown } }, table: string) => Number(Object.values(db.prepare(`SELECT count(*) FROM ${table}`).get() as object)[0]);

function snapshot(db: Parameters<typeof count>[0]) {
  return Object.fromEntries(['auth_users', 'merchants', 'products', 'orders', 'order_items', 'order_events', 'inventory_ledger', 'audit_logs'].map((t) => [t, count(db, t)]));
}

describe('writeTransaction', () => {
  test('commits all writes and returns the callback result', () => {
    const t = createTestDatabase();
    try {
      const result = writeTransaction(t.db, () => {
        const u = insertUser(t.db);
        insertMerchant(t.db, u);
        return u;
      });
      assert.equal(typeof result, 'string');
      assert.equal(count(t.db, 'merchants'), 1);
      assert.equal(t.db.isTransaction, false);
    } finally {
      t.cleanup();
    }
  });

  test('a thrown error rolls back every related write across tables', () => {
    const t = createTestDatabase();
    try {
      const before = snapshot(t.db);
      assert.throws(
        () =>
          writeTransaction(t.db, () => {
            const u = insertUser(t.db);
            const m = insertMerchant(t.db, u);
            const p = insertProduct(t.db, { onHand: 50 });
            const o = insertOrder(t.db, { userId: u, merchantId: m, items: [{ productId: p, cartons: 2, unitPrice: 12550 }] });
            t.db.prepare("INSERT INTO order_events (order_id, actor_user_id, old_state, new_state, created_at) VALUES (?, ?, NULL, 'pending', ?)").run(o, u, Date.now());
            t.db
              .prepare("INSERT INTO inventory_ledger (product_id, kind, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, created_at) VALUES (?, 'receipt', 5, 0, 55, 0, 'استلام', ?)")
              .run(p, Date.now());
            t.db.prepare("INSERT INTO audit_logs (action, request_id, created_at) VALUES ('test.action', ?, ?)").run(randomUUID(), Date.now());
            throw new Error('business rule failed after many writes');
          }),
        /business rule failed/,
      );
      assert.deepEqual(snapshot(t.db), before);
      assert.equal(t.db.isTransaction, false);
    } finally {
      t.cleanup();
    }
  });

  test('a constraint violation in a later statement rolls back the earlier ones', () => {
    const t = createTestDatabase();
    try {
      const p = insertProduct(t.db, { onHand: 10, reserved: 0 });
      const before = { ...(t.db.prepare('SELECT reserved, version FROM products WHERE id = ?').get(p) as object) };
      const counts = snapshot(t.db);
      assert.throws(() =>
        writeTransaction(t.db, () => {
          insertUser(t.db);
          fixtureReserve(t.db, p, 5); // valid: ledger row + product update + fixture order
          fixtureReserve(t.db, p, 6); // 11 > 10: rejected
        }),
      );
      assert.deepEqual(snapshot(t.db), counts, 'users, orders and ledger rows of the earlier statements are rolled back');
      assert.deepEqual({ ...(t.db.prepare('SELECT reserved, version FROM products WHERE id = ?').get(p) as object) }, before);
    } finally {
      t.cleanup();
    }
  });

  test('nested transactions are refused without disturbing the outer transaction', () => {
    const t = createTestDatabase();
    try {
      writeTransaction(t.db, () => {
        insertUser(t.db);
        assert.throws(() => writeTransaction(t.db, () => insertUser(t.db)), NestedTransactionError);
        assert.throws(() => readTransaction(t.db, () => 1), NestedTransactionError);
        assert.equal(t.db.isTransaction, true);
      });
      assert.equal(count(t.db, 'auth_users'), 1);
    } finally {
      t.cleanup();
    }
  });

  test('an async callback is rejected and its writes are rolled back', () => {
    const t = createTestDatabase();
    try {
      const asyncFn = (async () => {
        insertUser(t.db);
      }) as unknown as () => number;
      assert.throws(() => writeTransaction(t.db, asyncFn), AsyncTransactionError);
      assert.equal(count(t.db, 'auth_users'), 0);
      assert.equal(t.db.isTransaction, false);
    } finally {
      t.cleanup();
    }
  });

  test('a write lock held elsewhere yields DatabaseBusyError after the busy timeout, leaving no open transaction', () => {
    const t = createTestDatabase();
    const holder = openDatabase(t.file, { mustExist: true });
    const waiter = openDatabase(t.file, { mustExist: true, busyTimeoutMs: 100 });
    try {
      holder.exec('BEGIN IMMEDIATE');
      const started = Date.now();
      assert.throws(() => writeTransaction(waiter, () => insertUser(waiter)), DatabaseBusyError);
      assert.ok(Date.now() - started >= 90, 'waited for the busy timeout');
      assert.equal(waiter.isTransaction, false);
      holder.exec('ROLLBACK');
      writeTransaction(waiter, () => insertUser(waiter));
      assert.equal(count(waiter, 'auth_users'), 1);
    } finally {
      holder.close();
      waiter.close();
      t.cleanup();
    }
  });
});

describe('readTransaction', () => {
  test('sees a consistent snapshot while another connection commits', () => {
    const t = createTestDatabase();
    const writer = openDatabase(t.file, { mustExist: true });
    try {
      insertProduct(t.db);
      const seen = readTransaction(t.db, () => {
        const first = count(t.db, 'products');
        writeTransaction(writer, () => insertProduct(writer));
        return [first, count(t.db, 'products')];
      });
      assert.deepEqual(seen, [1, 1]);
      assert.equal(count(t.db, 'products'), 2);
    } finally {
      writer.close();
      t.cleanup();
    }
  });
});
