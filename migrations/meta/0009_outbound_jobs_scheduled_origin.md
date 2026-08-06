# 0009 outbound jobs scheduled origin

- Purpose: add a `created_via_schedule` flag to `outbound_jobs` so the dispatcher can log whether a successful send came from the user-facing scheduled-send path, without relying on `messages.status` (which is overwritten in the same batch).
- Compatibility window: SQLite `ALTER TABLE ADD COLUMN` is metadata-only in D1; the new column is added with a non-null default so existing rows report `0` (immediate). No backfill needed.
- Expected duration: instant.
- Backfill: none.
- Verification: `migrations/meta/0009_outbound_jobs_scheduled_origin.verify.sql` returns one row.
- Recovery: drop the column or default its CHECK if a future shape changes; never edit this file after release.
