# Migrations

Versioned, checksum-verified SQL migrations: `NNNN_name.sql`, contiguous from `0001`.

- `0001_initial.sql` — initial schema (13 STRICT tables, indexes, invariant triggers, approved
  categories and pilot business-setting defaults). Applied by `db:init`.

Rules (enforced by `src/server/database/migrations.ts`, see `docs/DATABASE.md` §5 and `docs/MIGRATION.md`):
- **Never edit an applied migration.** Its SHA-256 is verified on every startup; changes go into a new file.
- No `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`/`ATTACH` inside a file (the runner wraps each file in one transaction and denies these).
- LF line endings only (`.gitattributes`).
