# 0002 permission seeds

- Purpose: add the complete permission catalog and immutable administrator/member roles.
- Compatibility window: Worker releases from installation version 1 onward.
- Expected duration: under one second.
- Backfill: none.
- Verification: run `migrations/meta/0002_seed_permissions.verify.sql`.
- Recovery: fix forward with a new migration. Released seed migrations are immutable.
