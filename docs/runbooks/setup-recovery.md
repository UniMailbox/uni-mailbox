# Bootstrap and administrator recovery

UniMailbox has no public installation session or claim token. Deployment owns
schema migration, runtime-secret reconciliation, and first-administrator
creation. A successful fresh deployment opens at `/login`; Cloudflare Mail and
storage configuration happens afterward in authenticated Settings.

## Deployment did not create the administrator

Inspect structured release events first:

- `release.runtime_secret_state_invalid`: Wrangler could not list remote secret
  names or returned invalid JSON. Confirm the build has Worker edit/secrets
  permissions and rerun the release.
- `release.legacy_secret_migration_required`: an existing deployment has
  encrypted credentials but no compatible `CREDENTIAL_ENCRYPTION_KEY`. Restore
  the original key or perform an explicit credential-key migration; do not let
  the release generate a replacement.
- `bootstrap.initial_credentials_invalid`: add valid `INITIAL_ADMIN_EMAIL` and
  `INITIAL_ADMIN_PASSWORD` Workers Builds variables. The password must contain
  12 to 1024 characters.
- `bootstrap.d1_command_failed` or `bootstrap.d1_output_invalid`: inspect D1
  permissions, apply migrations, and verify the schema before retrying.
- `bootstrap.postcondition_failed`: stop. Confirm exactly one administrator
  role assignment and `installation_state.current_step = 'complete'`.

Run read-only checks:

```bash
pnpm db:verify --target production
pnpm exec wrangler secret list --env "" --format json
pnpm exec wrangler d1 execute DB --remote --json \
  --command "SELECT COUNT(*) AS administrators FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE ur.role_id = '00000000-0000-4000-8000-000000000001'"
pnpm exec wrangler d1 execute DB --remote --json \
  --command "SELECT current_step FROM installation_state WHERE id = 1"
```

If the administrator count is zero, supply the one-time values in a trusted
shell and rerun only the idempotent bootstrap:

```bash
INITIAL_ADMIN_EMAIL=admin@example.com \
  INITIAL_ADMIN_PASSWORD='<new unique password>' \
  pnpm bootstrap:admin -- --target production
```

The command writes a mode-`0600` temporary SQL file containing only the derived
password record, deletes it after execution, and verifies the administrator
count and complete installation state. It never prints the email, password,
hash, salt, or generated runtime-secret values.

## Candidate metadata is absent

Wrangler can successfully upload a version without returning a candidate
version ID and preview URL. This is not a startup dependency. The release emits
`release.version_output.inspected`, skips only candidate HTTP verification,
applies and verifies migrations, bootstraps the administrator, and uses direct
deployment. Confirm the manifest contains:

```json
{
  "releaseMode": "direct-deploy",
  "verificationSkipped": true
}
```

Then run `pnpm release:verify https://<worker-url>`. Do not treat missing
candidate metadata as permission to skip D1 verification or administrator
bootstrap.

## Login credentials were removed from Workers Builds

This is the expected steady state. `INITIAL_ADMIN_EMAIL` and
`INITIAL_ADMIN_PASSWORD` are not runtime secrets, and later deployments do not
need them after an administrator exists.

- A signed-in administrator can change the login email or password under
  **Settings → Account security**. Either change revokes every refresh session.
- The login email is identity-only and never changes domains, mailboxes, sender
  addresses, Cloudflare Email Routing, or Brevo configuration.
- Re-adding initial build inputs does not overwrite an existing administrator.
- If every administrator is locked out, preserve the current D1 database and
  use the recorded D1 Time Travel bookmark or another existing administrator.
  Do not delete users, reset `installation_state`, or generate a new encryption
  key as an account-recovery shortcut.

## Post-login Cloudflare or provider checks fail

Open **Settings → Cloudflare Mail** and retry only the failed card. Each of
Cloudflare/Email Routing, inbound smoke test, Brevo, and outbound smoke test has
an independent `configuration_checkpoints` row. A failed retry does not return
the installation to an incomplete state and does not take the inbox offline.

For R2, use **Settings → Storage & runtime**. Missing R2 is healthy when KV is
the active backend. Only run the R2 probe after an `ATTACHMENTS` binding is
present.
