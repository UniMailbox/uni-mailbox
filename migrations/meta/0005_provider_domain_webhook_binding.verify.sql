SELECT CASE
  WHEN (
    SELECT COUNT(*)
    FROM pragma_table_info('messages')
    WHERE name = 'domain_id'
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM pragma_table_info('provider_message_state')
    WHERE name = 'domain_id'
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM pragma_table_info('webhook_deliveries')
    WHERE name = 'domain_id'
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM pragma_table_info('webhook_events')
    WHERE name = 'domain_id'
  ) = 1
  THEN 1
  ELSE 0
END AS provider_domain_webhook_binding_valid;
PRAGMA foreign_key_check;
