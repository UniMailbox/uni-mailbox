PRAGMA foreign_keys = ON;

CREATE TABLE configuration_checkpoints (
  checkpoint_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'configured', 'verified', 'failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO configuration_checkpoints (checkpoint_key) VALUES
  ('brevo'),
  ('cloudflare_mail'),
  ('inbound_smoke_test'),
  ('outbound_smoke_test'),
  ('r2_storage');

UPDATE installation_state
SET installation_version = 2,
    current_step = CASE
      WHEN status = 'complete' THEN 'complete'
      ELSE 'admin_bootstrap'
    END,
    completed_steps_json = CASE
      WHEN status = 'complete' THEN '["admin_bootstrap"]'
      ELSE '[]'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
