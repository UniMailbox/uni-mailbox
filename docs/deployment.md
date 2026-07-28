# Deployment and release guide

UniMailbox deploys from the repository root as one Worker. The Worker serves
the built web assets and owns HTTP, inbound email, Queue, and scheduled
entrypoints. There is no separate Pages project and no account-specific
resource ID in source control.

## Bootstrap paths

### Public repository

Put the repository's public URL into the Deploy to Cloudflare button in the
README. Cloudflare imports the repository, provisions resources from
`wrangler.jsonc`, collects the declared secret bindings, and runs the root
build/deploy commands.

### Private repository

Use **Workers & Pages → Create → Import a repository**. Select the repository
root and configure:

- Build command: `pnpm install --frozen-lockfile && pnpm build`
- Deploy command: `pnpm deploy`
- Node version: 22
- Root directory: repository root

Cloudflare owns the generated D1, KV, R2, Queue, and Secrets Store deployment
metadata. Do not copy account IDs into application settings.

## Required bootstrap secrets

The deployment page must collect or generate:

- `INSTALLATION_TOKEN`: one-time setup claim token, at least 32 random bytes.
- `AUTH_SIGNING_KEY`: HMAC signing key, at least 32 random bytes.
- `CREDENTIAL_ENCRYPTION_KEY`: AES-GCM key material, at least 32 random bytes.

Brevo keys and application settings are not deployment environment variables.
They are encrypted and managed inside the installed application.

## Pre-release checks

```bash
pnpm install --frozen-lockfile
pnpm scaffold doctor
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm db:migrate --target local
pnpm db:verify --target local
pnpm build
pnpm deploy:dry-run
```

The CI workflow runs the same implementation. It has no production deployment
authority.

## Preview

With preview-scoped Cloudflare credentials:

```bash
pnpm release:preview
pnpm release:verify https://preview-url.example
```

A preview must use isolated D1, R2, KV, Queue, Brevo, and Email Routing
resources. It must never point at production data.

## Production

Production releases run only from the protected `main` or `master` branch and
under the GitHub `production` environment:

1. Verify the exact source and immutable dependency lock.
2. Build once and retain `.wrangler/release/manifest.json`.
3. Record the D1 Time Travel bookmark printed by the release command.
4. Apply reviewed migrations with an explicit deployment confirmation.
5. Run verification queries.
6. Upload and promote the Worker.
7. Verify `/health`, setup state, authenticated mail access, Queue and Cron
   activity, inbound routing, and Brevo health.

```bash
pnpm release:production
pnpm release:verify https://mail.example.com
```

`release:verify` covers public HTTP checks. The setup page and administration
control plane own the credentialed inbound/outbound smoke tests.

Configure account-owned notification destinations and run the release drill in
the [observability and alerts runbook](runbooks/observability-alerts.md).

## Failure boundaries

- Migration failure: stop before promotion; do not auto-restore D1.
- Pre-promotion smoke failure: leave the existing Worker version active.
- Post-promotion Worker failure: roll back the Worker version. Database restore
  is a separate approved incident action using the recorded bookmark.
- Provider failure: disable the provider connection; queued jobs remain
  inspectable and recoverable.

Migration, mail delivery, and setup-specific commands are in `docs/runbooks`.
