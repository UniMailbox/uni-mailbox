# 0006 admin message read permission

- Purpose: Add a dedicated permission for viewing every message across managed domains without widening mailbox-scoped `message.read` access.
- Compatibility window: Old Workers ignore the new permission; new Workers deny the global message view until this migration grants it to the system administrator role.
- Expected duration: Short inserts into the permissions and administrator role mapping tables.
- Backfill: Grant `message.read_all` only to the immutable system administrator role; custom roles remain unchanged and require an explicit administrator decision.
- Verification: `migrations/meta/0006_admin_message_read_permission.verify.sql`
- Recovery: fix forward with a new migration; never edit this file after release.
