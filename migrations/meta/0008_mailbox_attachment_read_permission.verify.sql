SELECT CASE
  WHEN (
    SELECT COUNT(*) FROM permissions WHERE key = 'attachment.read'
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM role_permissions
    WHERE permission_key = 'attachment.read'
      AND role_id IN (
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002'
      )
  ) = 2
  THEN 1
  ELSE 0
END AS mailbox_attachment_read_permission_valid;
PRAGMA foreign_key_check;
