SELECT CASE
  WHEN (
    SELECT COUNT(*) FROM sqlite_schema
    WHERE type = 'table' AND name = 'attachment_files'
  ) = 1
  AND (
    SELECT COUNT(*) FROM pragma_table_info('attachment_uploads')
    WHERE name IN ('file_id', 'md5')
  ) = 2
  AND (
    SELECT COUNT(*) FROM pragma_table_info('message_attachments')
    WHERE name IN ('file_id', 'md5')
  ) = 2
  AND (
    SELECT COUNT(*) FROM maintenance_jobs
    WHERE job_key = 'attachment-md5-backfill'
  ) = 1
  THEN 1
  ELSE 0
END AS attachment_file_catalog_valid;
PRAGMA foreign_key_check;
