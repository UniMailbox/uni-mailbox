# 0008 mailbox attachment read permission

- Purpose: allow standard mailbox users to search and download attachments from mailboxes they own or that are shared with them.
- Compatibility window: the previous Worker ignores this permission; the updated Worker requires it for the attachment catalog and scopes results by mailbox access unless `message.read_all` is also present.
- Expected duration: short inserts into the permissions and role mapping tables.
- Backfill: grant `attachment.read` to the immutable administrator and member system roles; custom roles remain unchanged and require an explicit administrator decision.
- Verification: `migrations/meta/0008_mailbox_attachment_read_permission.verify.sql`
- Recovery: fix forward with a new migration; do not remove role grants while deployed Workers require the permission.
