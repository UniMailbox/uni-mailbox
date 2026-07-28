# 0001 initial schema

- Purpose: create the first complete UniMailbox schema and all storage boundaries.
- Compatibility window: Worker releases from installation version 1 onward.
- Expected duration: under one minute for an empty D1 database.
- Backfill: none; this migration targets an empty database.
- Verification: run `migrations/meta/0001_initial.verify.sql` and confirm
  `PRAGMA foreign_key_check` returns no rows.
- Recovery: stop deployment before traffic promotion. For a failed new install,
  delete the provisioned empty D1 database and deploy again. Do not restore or
  replace an existing production database automatically.
