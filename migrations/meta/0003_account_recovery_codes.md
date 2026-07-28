# 0003 account recovery codes

- Purpose: store one-way hashes for the first administrator's single-use recovery codes.
- Compatibility window: installation version 1 and later.
- Expected duration: under one second.
- Backfill: none; existing installations can issue codes through a later administrative rotation flow.
- Verification: run `migrations/meta/0003_account_recovery_codes.verify.sql`.
- Recovery: fix forward with a new migration; the additive table does not change existing reads.
