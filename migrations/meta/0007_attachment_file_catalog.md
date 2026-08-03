# 0007 attachment file catalog

- Purpose: add a content-level attachment catalog with an MD5 search index so identical files can share one stored object while retaining per-message attachment metadata.
- Compatibility window: the new columns are nullable so the previous Worker can continue writing during deployment; the new Worker populates them for every upload and inbound attachment.
- Expected duration: schema changes and metadata linkage are bounded D1 operations; object hashing is deliberately deferred.
- Backfill: `attachment-md5-backfill` processes legacy objects in bounded scheduled batches, records the MD5, and merges byte-identical objects without trusting MD5 alone.
- Verification: `migrations/meta/0007_attachment_file_catalog.verify.sql`
- Recovery: fix forward with a new migration; never edit this file after release. File bytes remain in R2/KV until reference-safe cleanup succeeds.
