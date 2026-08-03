PRAGMA foreign_keys = ON;

CREATE TABLE attachment_files (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  dedupe_key TEXT NOT NULL UNIQUE,
  md5 TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CHECK (md5 IS NULL OR (length(md5) = 32 AND md5 = lower(md5)))
);

CREATE INDEX idx_attachment_files_md5_size
  ON attachment_files(md5, size_bytes);

ALTER TABLE attachment_uploads
  ADD COLUMN file_id TEXT REFERENCES attachment_files(id) ON DELETE SET NULL;
ALTER TABLE attachment_uploads ADD COLUMN md5 TEXT;

ALTER TABLE message_attachments
  ADD COLUMN file_id TEXT REFERENCES attachment_files(id) ON DELETE RESTRICT;
ALTER TABLE message_attachments ADD COLUMN md5 TEXT;

CREATE INDEX idx_message_attachments_md5
  ON message_attachments(md5, created_at DESC);
CREATE INDEX idx_message_attachments_filename
  ON message_attachments(filename COLLATE NOCASE);

DROP TRIGGER validate_attachment_upload;

CREATE TRIGGER validate_attachment_upload
BEFORE INSERT ON message_attachments
WHEN NEW.upload_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid attachment upload')
  WHERE NOT EXISTS (
    SELECT 1
    FROM attachment_uploads AS upload
    JOIN attachment_files AS file ON file.id = upload.file_id
    JOIN messages AS message ON message.id = NEW.message_id
    WHERE upload.id = NEW.upload_id
      AND upload.user_id = message.created_by_user_id
      AND upload.status = 'uploaded'
      AND upload.expires_at > CURRENT_TIMESTAMP
      AND upload.file_id = NEW.file_id
      AND file.object_key = NEW.object_key
      AND upload.size_bytes = NEW.size_bytes
  );
END;

INSERT INTO attachment_files (
  id, object_key, dedupe_key, md5, size_bytes
)
SELECT
  'legacy:' || object_key,
  object_key,
  'legacy:' || object_key,
  NULL,
  MAX(size_bytes)
FROM (
  SELECT object_key, size_bytes FROM message_attachments
  UNION ALL
  SELECT object_key, size_bytes FROM attachment_uploads
)
GROUP BY object_key;

UPDATE attachment_uploads
SET file_id = (
  SELECT af.id FROM attachment_files af
  WHERE af.object_key = attachment_uploads.object_key
);

UPDATE message_attachments
SET file_id = (
  SELECT af.id FROM attachment_files af
  WHERE af.object_key = message_attachments.object_key
);

INSERT INTO maintenance_jobs (
  id, job_key, migration_name, status, cursor_json, attempts
)
VALUES (
  '00000000-0000-4000-8000-000000000007',
  'attachment-md5-backfill',
  '0007_attachment_file_catalog.sql',
  'pending',
  '{}',
  0
)
ON CONFLICT(job_key) DO NOTHING;
