# 0001 initial schema

- Purpose: create the first complete UniMailbox schema and all storage boundaries.
- Compatibility window: Worker releases from installation version 1 onward.
- Expected duration: under one minute for an empty D1 database.
- Backfill: none; this migration targets an empty database.
- Verification: run `migrations/meta/0001_initial.verify.sql` and confirm
  `PRAGMA foreign_key_check` returns no rows.
- Recovery: stop deployment before traffic promotion. A failed remote
  multi-statement migration can be retried through the release-managed atomic
  SQL-file bootstrap when the database has no application schema. Do not
  restore, replace, or automatically adopt an untracked non-empty production
  database.
