SELECT CASE
  WHEN (
    SELECT COUNT(*)
    FROM sqlite_schema
    WHERE type = 'table' AND name = 'configuration_checkpoints'
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM configuration_checkpoints
    WHERE checkpoint_key IN (
      'brevo',
      'cloudflare_mail',
      'inbound_smoke_test',
      'outbound_smoke_test',
      'r2_storage'
    )
  ) = 5
  AND (
    SELECT COUNT(*)
    FROM installation_state
    WHERE id = 1
      AND current_step IN ('admin_bootstrap', 'complete')
      AND installation_version = 2
  ) = 1
  THEN 1
  ELSE 0
END AS zero_touch_bootstrap_valid;

PRAGMA foreign_key_check;
