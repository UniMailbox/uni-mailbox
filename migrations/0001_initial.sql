PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_algorithm TEXT NOT NULL DEFAULT 'pbkdf2-sha256',
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id TEXT,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_user_id, operation, idempotency_key),
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_idempotency_records_expiry ON idempotency_records(expires_at);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_key),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_key) REFERENCES permissions(key) ON DELETE CASCADE
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE encrypted_credentials (
  id TEXT PRIMARY KEY,
  encrypted_payload TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_connections (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  label TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'invalid')),
  config_json TEXT NOT NULL DEFAULT '{}',
  last_health_check_at TEXT,
  last_health_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider_key, label),
  FOREIGN KEY (credential_id) REFERENCES encrypted_credentials(id)
);
CREATE INDEX idx_provider_connections_key
  ON provider_connections(provider_key, status);

CREATE TABLE domains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  outbound_connection_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outbound_connection_id) REFERENCES provider_connections(id)
);

CREATE TABLE mailboxes (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  address TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES domains(id),
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);
CREATE INDEX idx_mailboxes_owner ON mailboxes(owner_user_id);
CREATE INDEX idx_mailboxes_domain ON mailboxes(domain_id);

CREATE TABLE mailbox_members (
  mailbox_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'sender', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mailbox_id, user_id),
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_mailbox_members_user ON mailbox_members(user_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  from_address TEXT NOT NULL COLLATE NOCASE,
  from_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  message_id_header TEXT,
  in_reply_to_header TEXT,
  references_header TEXT NOT NULL DEFAULT '',
  provider_key TEXT,
  provider_connection_id TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'draft', 'queued', 'sending', 'sent', 'delivered',
      'delayed', 'bounced', 'complained', 'failed', 'received'
    )
  ),
  error_code TEXT,
  error_message TEXT,
  raw_object_key TEXT,
  created_by_user_id TEXT,
  sent_at TEXT,
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  FOREIGN KEY (provider_connection_id) REFERENCES provider_connections(id),
  UNIQUE (provider_connection_id, provider_message_id)
);
CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_created_at ON messages(created_at);

CREATE TABLE outbound_jobs (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'enqueued', 'processing', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lock_token TEXT,
  lock_expires_at INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
CREATE INDEX idx_outbound_jobs_dispatch
  ON outbound_jobs(status, available_at);

CREATE TABLE message_recipients (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('to', 'cc', 'bcc')),
  address TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
CREATE INDEX idx_message_recipients_message ON message_recipients(message_id);
CREATE INDEX idx_message_recipients_address ON message_recipients(address);

CREATE TABLE mailbox_messages (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  folder TEXT NOT NULL
    CHECK (folder IN ('inbox', 'sent', 'drafts', 'archive', 'trash')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (mailbox_id, message_id, folder),
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
CREATE INDEX idx_mailbox_messages_page
  ON mailbox_messages(mailbox_id, folder, created_at DESC, id DESC);

CREATE TABLE message_user_state (
  mailbox_message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mailbox_message_id, user_id),
  FOREIGN KEY (mailbox_message_id)
    REFERENCES mailbox_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE attachment_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  disposition TEXT NOT NULL CHECK (disposition IN ('attachment', 'inline')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploaded', 'consumed', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_attachment_uploads_cleanup
  ON attachment_uploads(status, expires_at);

CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  upload_id TEXT UNIQUE,
  object_key TEXT NOT NULL,
  filename TEXT,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  disposition TEXT NOT NULL CHECK (disposition IN ('attachment', 'inline')),
  content_id TEXT,
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (upload_id) REFERENCES attachment_uploads(id) ON DELETE SET NULL
);
CREATE INDEX idx_message_attachments_message
  ON message_attachments(message_id);
CREATE INDEX idx_message_attachments_object
  ON message_attachments(object_key);

CREATE TRIGGER validate_attachment_upload
BEFORE INSERT ON message_attachments
WHEN NEW.upload_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM attachment_uploads AS upload
    JOIN messages AS message ON message.id = NEW.message_id
    WHERE upload.id = NEW.upload_id
      AND upload.user_id = message.created_by_user_id
      AND upload.status = 'uploaded'
      AND upload.expires_at > CURRENT_TIMESTAMP
      AND upload.object_key = NEW.object_key
      AND upload.size_bytes = NEW.size_bytes
  )
  THEN RAISE(ABORT, 'invalid attachment upload')
  END;
END;

CREATE TRIGGER consume_attachment_upload
AFTER INSERT ON message_attachments
WHEN NEW.upload_id IS NOT NULL
BEGIN
  UPDATE attachment_uploads
  SET status = 'consumed', consumed_at = CURRENT_TIMESTAMP
  WHERE id = NEW.upload_id;
END;

CREATE TABLE domain_signatures (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL UNIQUE,
  html_content TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE registration_keys (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  role_id TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  revoked_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE oauth_accounts (
  id TEXT PRIMARY KEY,
  identity_provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  profile_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (identity_provider, provider_user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE provider_message_state (
  provider_connection_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  message_id TEXT,
  status_event_time INTEGER,
  status_rank INTEGER NOT NULL DEFAULT 0,
  import_lock_token TEXT,
  import_lock_expires_at INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_connection_id, provider_message_id),
  FOREIGN KEY (provider_connection_id)
    REFERENCES provider_connections(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);
CREATE INDEX idx_provider_message_state_message
  ON provider_message_state(message_id);

CREATE TABLE webhook_deliveries (
  provider_connection_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  event_key TEXT NOT NULL,
  event_time INTEGER NOT NULL,
  processing_status TEXT NOT NULL
    CHECK (processing_status IN ('processing', 'succeeded', 'ignored', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  lock_token TEXT,
  lock_expires_at INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_connection_id, event_key),
  FOREIGN KEY (provider_connection_id)
    REFERENCES provider_connections(id) ON DELETE CASCADE
);
CREATE INDEX idx_webhook_deliveries_status
  ON webhook_deliveries(processing_status, updated_at);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  provider_connection_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  provider_message_id TEXT,
  message_id TEXT,
  recipient TEXT,
  mapped_status TEXT,
  reason TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_connection_id)
    REFERENCES provider_connections(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);
CREATE INDEX idx_webhook_events_provider_time
  ON webhook_events(provider_connection_id, created_at DESC);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT NOT NULL,
  ip_address TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_audit_events_resource
  ON audit_events(resource_type, resource_id, created_at DESC);
CREATE INDEX idx_audit_events_actor
  ON audit_events(actor_user_id, created_at DESC);

CREATE TABLE installation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  installation_version INTEGER NOT NULL DEFAULT 1,
  state_version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'complete')),
  current_step TEXT NOT NULL DEFAULT 'claim',
  completed_steps_json TEXT NOT NULL DEFAULT '[]',
  cloudflare_account_id TEXT,
  cloudflare_zone_id TEXT,
  cloudflare_credential_id TEXT,
  claimed_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cloudflare_credential_id) REFERENCES encrypted_credentials(id)
);

CREATE TABLE maintenance_jobs (
  id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  migration_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  cursor_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  lock_token TEXT,
  lock_expires_at INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX idx_maintenance_jobs_runnable
  ON maintenance_jobs(status, updated_at);

CREATE TABLE system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  site_title TEXT NOT NULL DEFAULT 'Cloud Mail',
  registration_enabled INTEGER NOT NULL DEFAULT 0,
  invite_required INTEGER NOT NULL DEFAULT 1,
  inbound_enabled INTEGER NOT NULL DEFAULT 1,
  outbound_enabled INTEGER NOT NULL DEFAULT 1,
  unknown_recipient_policy TEXT NOT NULL DEFAULT 'reject'
    CHECK (unknown_recipient_policy IN ('reject', 'store')),
  max_mailboxes_per_user INTEGER NOT NULL DEFAULT 10,
  max_attachments_per_message INTEGER NOT NULL DEFAULT 10,
  max_attachment_bytes INTEGER NOT NULL DEFAULT 67108864,
  sender_blocklist_json TEXT NOT NULL DEFAULT '[]',
  subject_blocklist_json TEXT NOT NULL DEFAULT '[]',
  content_blocklist_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (id) VALUES (1);
INSERT INTO installation_state (id) VALUES (1);
