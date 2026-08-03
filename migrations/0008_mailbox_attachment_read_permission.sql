PRAGMA foreign_keys = ON;

INSERT INTO permissions (key, description)
VALUES (
  'attachment.read',
  'Search and download attachments in authorized mailboxes'
);

INSERT INTO role_permissions (role_id, permission_key) VALUES
  ('00000000-0000-4000-8000-000000000001', 'attachment.read'),
  ('00000000-0000-4000-8000-000000000002', 'attachment.read');
