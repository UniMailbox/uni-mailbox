# Failed migration recovery

1. Stop the release before Worker promotion.
2. Preserve the release manifest, migration output, commit SHA, actor, and the
   D1 Time Travel bookmark captured before migration.
3. Run `pnpm db:migration:status --target production` and compare the applied
   list with `migrations/meta/released-checksums.json`.
4. Run `pnpm db:verify --target production`. Do not edit an applied SQL file.
5. For an additive failure, prepare a new fix-forward migration and validate it
   against an empty database and a copy of the previous schema.
6. For data corruption, obtain incident approval before using D1 Time Travel.
   Restore to a new database first, verify it, and explicitly repoint bindings.
7. Record the outcome in the audit/incident system.

## Initial migration reports `incomplete input`

An older deployment may fail `0001_initial.sql` with SQLite error code `7500`
while using Wrangler's remote multi-statement query path. D1 rolls the failed
migration back, so retry with a release that includes the initial-schema file
import bootstrap:

1. Confirm the failed release did not promote Worker traffic.
2. Confirm the log reports `0001_initial.sql` as failed and later migrations as
   pending.
3. Deploy the current repository revision. The release should emit
   `migration.initial_schema_imported`, then apply the remaining migrations.
4. Confirm the release artifact lists every migration currently in source and
   run `pnpm db:verify --target production`.

If the retry emits `migration.initial_schema_untracked`, stop. The database
contains application tables without matching migration history and must be
inspected rather than overwritten.

Never run an automatic production restore and never delete the active D1
database as part of a retry.
