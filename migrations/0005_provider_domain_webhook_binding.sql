PRAGMA foreign_keys = ON;

ALTER TABLE messages
  ADD COLUMN domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL;
ALTER TABLE provider_message_state
  ADD COLUMN domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL;
ALTER TABLE webhook_deliveries
  ADD COLUMN domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL;
ALTER TABLE webhook_events
  ADD COLUMN domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL;

UPDATE messages
SET domain_id = (
  SELECT mb.domain_id
  FROM mailbox_messages mm
  JOIN mailboxes mb ON mb.id = mm.mailbox_id
  WHERE mm.message_id = messages.id
  ORDER BY CASE mm.folder WHEN 'sent' THEN 0 ELSE 1 END, mm.created_at
  LIMIT 1
)
WHERE domain_id IS NULL;

UPDATE provider_message_state
SET domain_id = (
  SELECT m.domain_id
  FROM messages m
  WHERE m.id = provider_message_state.message_id
)
WHERE domain_id IS NULL AND message_id IS NOT NULL;

UPDATE webhook_events
SET domain_id = (
  SELECT m.domain_id
  FROM messages m
  WHERE m.id = webhook_events.message_id
)
WHERE domain_id IS NULL AND message_id IS NOT NULL;

UPDATE webhook_deliveries
SET domain_id = (
  SELECT state.domain_id
  FROM provider_message_state state
  WHERE state.provider_connection_id = webhook_deliveries.provider_connection_id
    AND state.provider_message_id = (
      SELECT event.provider_message_id
      FROM webhook_events event
      WHERE event.provider_connection_id = webhook_deliveries.provider_connection_id
        AND json_extract(event.payload_json, '$.eventKey') = webhook_deliveries.event_key
      LIMIT 1
    )
)
WHERE domain_id IS NULL;

CREATE INDEX idx_messages_domain ON messages(domain_id, created_at DESC);
CREATE INDEX idx_provider_message_state_domain
  ON provider_message_state(domain_id, updated_at DESC);
CREATE INDEX idx_webhook_deliveries_domain
  ON webhook_deliveries(domain_id, updated_at DESC);
CREATE INDEX idx_webhook_events_domain_time
  ON webhook_events(domain_id, created_at DESC);
