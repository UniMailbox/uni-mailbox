SELECT CASE
  WHEN (
    SELECT COUNT(*)
    FROM sqlite_schema
    WHERE type = 'table' AND name = 'account_recovery_codes'
  ) = 1
  THEN 1
  ELSE 0
END AS recovery_codes_table_present;

PRAGMA foreign_key_check;
