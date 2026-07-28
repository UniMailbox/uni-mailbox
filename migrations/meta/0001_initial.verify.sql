SELECT CASE
  WHEN (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN (
    'users', 'sessions', 'roles', 'permissions', 'domains', 'mailboxes',
    'messages', 'message_recipients', 'mailbox_messages', 'message_user_state',
    'attachment_uploads', 'message_attachments', 'outbound_jobs',
    'provider_connections', 'webhook_deliveries', 'installation_state'
  )) = 16 THEN 1
  ELSE 0
END AS required_tables_present;

PRAGMA foreign_key_check;
