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
