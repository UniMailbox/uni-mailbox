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

Never run an automatic production restore and never delete the active D1
database as part of a retry.
