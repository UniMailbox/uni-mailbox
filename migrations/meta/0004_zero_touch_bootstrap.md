# 0004 zero touch bootstrap

- Purpose: replace the public installation claim workflow with deployment-owned administrator bootstrap and independent authenticated configuration checkpoints.
- Compatibility window: installation version 1 is upgraded to version 2; completed installations remain complete and incomplete installations resume at `admin_bootstrap`.
- Expected duration: under one second.
- Backfill: seed five stable configuration checkpoint rows; no mailbox, provider, or credential data is changed.
- Verification: run `migrations/meta/0004_zero_touch_bootstrap.verify.sql`.
- Recovery: fix forward with a new migration; administrator bootstrap is idempotent and normal releases never rotate established encryption keys.
