# Deployment and release guide

UniMailbox deploys from the repository root as one Worker. The Worker serves
the built web assets and owns HTTP, inbound email, Queue, and scheduled
entrypoints. There is no separate Pages project and no account-specific
resource ID in source control.

## Bootstrap paths

### Public repository

Put the repository's public URL into the Deploy to Cloudflare button in the
README. Cloudflare imports the repository, provisions resources from
`wrangler.jsonc`, and runs the root build/deploy commands.

### Private repository

Use **Workers & Pages → Create → Import a repository**. Select the repository
root and configure:

- Build command: `pnpm install --frozen-lockfile && pnpm build`
- Deploy command: `pnpm deploy`
- Node version: 22
- Root directory: repository root

For both paths, configure exactly two Workers Builds variables:

- `INITIAL_ADMIN_EMAIL`: the first administrator's login identity. It is not a
  mailbox, sender, or managed-domain address.
- `INITIAL_ADMIN_PASSWORD`: 12 to 1024 characters. Use a generated unique
  password and rotate it after the first login.

These are one-time build inputs, not Worker runtime variables. The release
hashes the password into D1 and never logs either value. Remove them from the
build configuration after the first successful deployment. A later release
detects the existing administrator and does not replace it.

Cloudflare owns the generated D1, KV, and Queue deployment metadata. R2 is
optional and added only through `wrangler.r2.jsonc`. Do not copy account IDs
into application settings.

## Storage backends

UniMailbox stores raw inbound messages (`raw/<uuid>.eml`) and attachment bytes
(`attachments/<uuid>`) in Cloudflare KV by default and optionally in Cloudflare
R2. R2 requires a paid Cloudflare plan; KV ships with the free tier. The
runtime selects the backend automatically based on whether the `ATTACHMENTS`
binding is present — no configuration flag or environment variable is needed.

| Backend | Binding       | Default? | Best for                                    |
| ------- | ------------- | -------- | ------------------------------------------- |
| KV      | `KV`          | Yes      | Cold-start installs, low-to-medium traffic  |
| R2      | `ATTACHMENTS` | No       | High volume, attachments larger than 25 MiB |

### KV vs R2 differences

| Property                | KV (default)                         | R2 (overlay)                |
| ----------------------- | ------------------------------------ | --------------------------- |
| Single-object size cap  | 25 MiB hard limit                    | 5 TiB                       |
| Object metadata         | JSON sidecar `attachment-meta:<key>` | inline http/custom metadata |
| List operation          | Eventually consistent (≤60 s)        | Strongly consistent         |
| Upload transport header | `worker-kv-binding`                  | `worker-r2-binding`         |
| Billing                 | Free-tier KV operations              | Paid Workers plan           |

### Attachment size cap on KV

Uploads above 24 MiB are hard-rejected with `DomainError ATTACHMENT_TOO_LARGE`
(HTTP 413) when the KV backend is active. The check runs at presign time in
`AttachmentApplicationService.create`, before any upload token is issued. To
raise the limit, deploy with R2 (next section).

### Enabling R2 later

1. Provision an R2 bucket (e.g. `unimailbox-attachments`) in your Cloudflare
   account. Note the bucket name and the `id` of the existing KV namespace
   (run `wrangler kv namespace list` once with `wrangler.r2.jsonc` deployed so
   Wrangler records the binding ID).
2. Deploy with the overlay config:

   ```bash
   pnpm deploy:r2
   ```

   This explicitly deploys the top-level production environment followed by
   `--env preview`. Both Workers receive their environment-specific
   `ATTACHMENTS` binding. New writes use R2; reads try R2 and fall back to KV
   until historical objects are migrated.

3. Migrate existing KV-stored objects into R2 and verify each by `HEAD`:

   ```bash
   pnpm migrate:kv-to-r2 --bucket unimailbox-attachments
   ```

   The script lists every `attachment:` key in KV, uploads the bytes and
   metadata to R2, verifies the size by `HEAD`, then deletes the KV copies.
   It is idempotent — running it twice is safe. The D1 `object_key` values
   do not change, so message references remain valid throughout.

### Health endpoint

`GET /health` now reports the active backend:

```json
{
  "data": {
    "status": "ok",
    "checks": { "kv": "ok", "r2": "missing", ... },
    "storage": { "backend": "kv", "reason": "ATTACHMENTS binding is absent; ..." }
  }
}
```

The `r2` field still reports the binding presence for backwards compatibility.
The `storage` object is the canonical indicator.

## Automatic runtime secrets

The release inspects the Worker secret names and securely generates any missing
values for:

- `AUTH_SIGNING_KEY`: HMAC signing key, at least 32 random bytes.
- `CREDENTIAL_ENCRYPTION_KEY`: AES-GCM key material, at least 32 random bytes.

Generated values are attached with Wrangler's temporary `--secrets-file`
input; the file is mode `0600` and is deleted after upload/deploy. Values never
appear in release logs. Existing secret names are preserved. If an existing
installation has encrypted credentials but the encryption secret is missing,
the release stops with `release.legacy_secret_migration_required` rather than
silently generating an incompatible key.

After deployment, the first page is `/login`. Cloudflare account/zone IDs,
Email Routing, domains, Brevo, inbound/outbound smoke tests, and optional R2
verification live under authenticated Settings. Brevo credentials are
encrypted and managed inside the application.

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
pnpm deploy:r2:dry-run
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

The R2 overlay (`wrangler.r2.jsonc`) has its own preview block
(`env.preview.r2_buckets`). `pnpm deploy:r2` invokes both explicit commands:
`deploy:r2:production` for the top-level environment and
`deploy:r2:preview` with `--env preview`, so preview traffic uses isolated R2
objects. Either command can be retried independently.

## Production

Production releases run only from the protected `main` or `master` branch.
Workers Builds is the primary release path; the manual GitHub Actions fallback
also requires the GitHub `production` environment:

1. Verify the exact source and immutable dependency lock.
2. Build once and retain `.wrangler/release/manifest.json`.
3. Record the D1 Time Travel bookmark printed by the release command.
4. Apply reviewed migrations with an explicit deployment confirmation.
5. Create the first administrator from the one-time build inputs when none
   exists and verify installation state is `complete`.
6. Run verification queries.
7. Verify the uploaded candidate only after the database and administrator are
   ready, then promote it. If candidate metadata is absent, deploy directly.
8. Verify `/health`, `/login`, authenticated mail access, Queue and Cron
   activity, inbound routing, and Brevo health.

```bash
pnpm release:production
pnpm release:verify https://mail.example.com
```

`release:verify` covers public HTTP checks. The authenticated Settings control
plane owns Cloudflare Email Routing, Brevo, and inbound/outbound smoke tests.

For Cloudflare Workers Builds, set **Settings > Build > Branch control >
Production branch** to `main`. Use `pnpm run build` as the build command and
`pnpm run deploy` as the deploy command. Workers Builds injects
`WORKERS_CI_BRANCH`; the release log emits `release.context` so an operator can
confirm that the production trigger ran from `main`.

Wrangler candidate metadata is diagnostic rather than a startup dependency. If
`versions upload` succeeds but does not expose both a version ID and preview
URL, the release emits `release.version_output.inspected`, applies the required
production migrations, skips only candidate HTTP verification, and falls back
to a direct production deploy. D1 Time Travel capture and migration schema
verification remain mandatory. The manifest records
`releaseMode: "direct-deploy"` and `verificationSkipped: true` for follow-up.
This path is expected to start the system normally even when Wrangler omits
candidate metadata. The log also emits candidate stdout/stderr byte counts and
parsed metadata diagnostics without exposing secrets.

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
