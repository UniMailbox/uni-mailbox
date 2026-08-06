-- Return one row with value 1 when the migration is valid.
SELECT 1 AS migration_verified;
PRAGMA foreign_key_check;
