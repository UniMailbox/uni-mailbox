SELECT CASE
  WHEN (
    SELECT COUNT(*)
    FROM permissions
    WHERE key = 'message.read_all'
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM role_permissions
    WHERE role_id = '00000000-0000-4000-8000-000000000001'
      AND permission_key = 'message.read_all'
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM role_permissions
    WHERE role_id = '00000000-0000-4000-8000-000000000002'
      AND permission_key = 'message.read_all'
  ) = 0
  THEN 1
  ELSE 0
END AS admin_message_read_permission_valid;
PRAGMA foreign_key_check;
