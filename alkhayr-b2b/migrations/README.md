# Migrations

Versioned, checksum-verified SQL migrations: `NNNN_name.sql`, contiguous from `0001`.

- `0001_initial.sql` — initial schema (13 STRICT tables, indexes, invariant triggers, approved
  categories and pilot business-setting defaults). Applied by `db:init`.
- `0002_merchant_access_version.sql` — `merchants.access_version`, a monotonic marker advanced on every
  status change (ABA protection for in-flight logins, stage 05).
- `0003_inventory_integrity.sql` — products must be inserted inactive with zero stock; every
  on_hand/reserved change must be paired with a new matching ledger row (`products.last_ledger_id`);
  ledger `product_version_after` and `adjustment_type` (stage 07).
- `0004_order_finalization.sql` — the order creation event is a guarded finalization marker (consistent
  subtotal, 1–100 items, uniform demo flag, once, by the creator); no items after it, no transition or
  state change before it (stage 08).
- `0005_order_fulfillment.sql` — per-order reservations (`order_allocations`) tied to reserve/release/ship
  ledger rows; transition events with operation keys; state changes require their event, matching
  allocations and an approved buyer for forward steps; pack size locked while stocked (stage 09).
- `0006_import_operations.sql` — committed CSV import batches (`import_operations`, per administrator +
  operation key: durable idempotency) and their per-record links to products and ledger rows
  (`import_operation_items`), append-only, with a mode/ledger consistency trigger (stage 13).

Rules (enforced by `src/server/database/migrations.ts`, see `docs/DATABASE.md` §5 and `docs/MIGRATION.md`):
- **Never edit an applied migration.** Its SHA-256 is verified on every startup; changes go into a new file.
- No `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`/`ATTACH` inside a file (the runner wraps each file in one transaction and denies these).
- LF line endings only (`.gitattributes`).
