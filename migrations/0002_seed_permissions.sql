INSERT INTO permissions (key, description) VALUES
  ('message.read', 'Read messages in an authorized mailbox'),
  ('message.send', 'Send messages from an authorized mailbox'),
  ('message.delete', 'Delete a linked mailbox message'),
  ('mailbox.create', 'Create a mailbox on a managed domain'),
  ('mailbox.manage', 'Rename and configure an authorized mailbox'),
  ('mailbox.share', 'Manage delegated mailbox access'),
  ('user.read', 'View application users'),
  ('user.manage', 'Manage application users'),
  ('role.read', 'View roles and permissions'),
  ('role.manage', 'Manage roles and permissions'),
  ('domain.read', 'View managed domains'),
  ('domain.manage', 'Manage domains and provider connections'),
  ('signature.read', 'View domain signatures'),
  ('signature.manage', 'Manage domain signatures'),
  ('settings.read', 'View system settings'),
  ('settings.manage', 'Manage system settings'),
  ('provider.sync', 'Run provider reconciliation'),
  ('webhook_event.read', 'View webhook audit events'),
  ('webhook_event.delete', 'Delete webhook audit events'),
  ('analytics.read', 'View operational analytics');

INSERT INTO roles (id, name, description, is_system) VALUES
  ('00000000-0000-4000-8000-000000000001', 'administrator', 'Full installation administration', 1),
  ('00000000-0000-4000-8000-000000000002', 'member', 'Standard mailbox user', 1);

INSERT INTO role_permissions (role_id, permission_key)
SELECT '00000000-0000-4000-8000-000000000001', key FROM permissions;

INSERT INTO role_permissions (role_id, permission_key) VALUES
  ('00000000-0000-4000-8000-000000000002', 'message.read'),
  ('00000000-0000-4000-8000-000000000002', 'message.send'),
  ('00000000-0000-4000-8000-000000000002', 'message.delete'),
  ('00000000-0000-4000-8000-000000000002', 'mailbox.create'),
  ('00000000-0000-4000-8000-000000000002', 'mailbox.manage'),
  ('00000000-0000-4000-8000-000000000002', 'mailbox.share');
