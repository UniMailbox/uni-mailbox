# 0005 provider domain webhook binding

- Purpose: Persist the managed-domain identity on messages, provider state, and webhook audit/delivery records.
- Compatibility window: The new columns are nullable so old and new Worker versions can overlap during deployment; new writes populate them immediately.
- Expected duration: Short metadata changes plus indexed backfills over existing messages and webhook records.
- Backfill: Resolve message domains through mailbox links, then cascade that identity into provider state and webhook records when possible.
- Verification: `migrations/meta/0005_provider_domain_webhook_binding.verify.sql`
- Recovery: fix forward with a new migration; never edit this file after release.
