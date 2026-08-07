-- 0009 outbound_jobs_scheduled_origin: ensure the column was added with
-- NOT NULL, default 0, and the {0,1} CHECK constraint. Reject silently
-- (returning 0) if it is missing so the verify step surfaces a clean
-- migration_verified row in JSON.
SELECT CASE
  WHEN (
    SELECT COUNT(*)
    FROM pragma_table_info('outbound_jobs')
    WHERE name = 'created_via_schedule'
      AND "notnull" = 1
      AND "dflt_value" = '0'
      AND type = 'integer'
  ) = 1
  AND EXISTS(
    SELECT 1 FROM pragma_table_info('outbound_jobs')
    WHERE name = 'created_via_schedule'
  )
  THEN 1
  ELSE 0
END AS migration_verified;
PRAGMA foreign_key_check;