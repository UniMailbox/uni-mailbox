INSERT INTO permissions (key, description)
VALUES ('message.read_all', 'View every message across managed domains');

INSERT INTO role_permissions (role_id, permission_key)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'message.read_all'
);
