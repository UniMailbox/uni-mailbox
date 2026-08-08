# Deployment and release guide

For optional browser and Worker error collection, secret handling, source-map uploads, and the live-delivery checklist, see [Sentry error reporting](runbooks/sentry-error-reporting.md).

UniMailbox deploys from the repository root as one Worker. The Worker serves
the built web assets and owns HTTP, inbound email, Queue, and scheduled
entrypoints. There is no separate Pages project. The canonical source repository
never stores a production credential or installation-specific resource ID;
Cloudflare writes those identifiers only into each generated installation
repository.

## Bootstrap paths

### Recommended: Deploy Button

Use the button in the README, which always points to the stable distribution
repository:

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/UniMailbox/unimailbox-deploy
```

Cloudflare creates a new, independent repository in the installer's GitHub
account, provisions resources from `wrangler.jsonc`, records the generated D1,
KV, and Queue identifiers in that repository, and runs the root build/deploy
commands. This repository is not a GitHub fork. Do not replace it wholesale
with files from the canonical source repository, because doing so can discard
its generated resource configuration.

The `pnpm deploy` command is reserved for this initial installation. Its first
remote operation is a plain `wrangler deploy`, which gives Cloudflare the
opportunity to provision the Worker, D1 database, KV namespace, and Queues and
write their identifiers into the generated repository. The command stops after
that deployment and requires no administrator credentials.

The initial command deliberately does not inspect secrets, apply migrations,
create the administrator, upload a release candidate, capture a D1 Time Travel
bookmark, execute migration verification SQL, or run HTTP smoke tests. A
brand-new installation has no remote resources or healthy application to verify
yet.

### Private repository

Use **Workers & Pages → Create → Import a repository**. Select the repository
root and configure:

- Build command: `pnpm install --frozen-lockfile && pnpm build`
- Deploy command: `pnpm deploy`
- Node version: 22
- Root directory: repository root

After the minimal deployment succeeds and Cloudflare writes the resource IDs,
complete application bootstrap from a trusted, Cloudflare-authenticated shell:

```bash
pnpm install --frozen-lockfile
INITIAL_ADMIN_EMAIL=admin@example.com \
  INITIAL_ADMIN_PASSWORD='<new unique password>' \
  pnpm deployment:bootstrap
```

The command requires exactly two one-time environment values:

- `INITIAL_ADMIN_EMAIL`: the first administrator's login identity. It is not a
  mailbox, sender, or managed-domain address.
- `INITIAL_ADMIN_PASSWORD`: 12 to 1024 characters. Use a generated unique
  password and rotate it after the first login.

These are bootstrap inputs, not Worker runtime variables. The command hashes
the password into D1 and never logs either value. It also creates any missing
runtime secrets and attaches them with one final direct deploy. A later
bootstrap or release detects the existing administrator and does not replace
it, except to repair a legacy PBKDF2 record whose iteration count exceeds the
Cloudflare Workers runtime ceiling. That repair requires the same administrator
email and an explicit `INITIAL_ADMIN_PASSWORD` value.

To intentionally replace the password of an existing administrator, use the
explicit force flag from a trusted shell:

```bash
INITIAL_ADMIN_EMAIL=admin@example.com \
  INITIAL_ADMIN_PASSWORD='<new unique password>' \
  pnpm deployment:bootstrap -- --force-admin-password-reset
```

The email must match the existing administrator. The command writes only the
derived password record to D1, verifies that the new hash was stored, and
revokes every existing session for that administrator. Without the force flag,
a supported existing password record is never changed.

Cloudflare owns the generated D1, KV, and Queue deployment metadata. R2 is
optional and added only through `wrangler.r2.jsonc`. Do not copy account IDs
into application settings.

## Adopt the installation

Workers Builds is authorized only for the first installation. Before using the
long-term production workflow:

1. Confirm that `pnpm deployment:bootstrap` completed, the deployment is
   healthy, and the initial
   administrator can sign in.
2. Remove `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` from the trusted
   shell or CI configuration used for bootstrap.
3. Create a GitHub Environment named `production`. Restrict deployment branches
   to `main`, add at least one required reviewer, enable prevent self-review,
   and disallow administrator bypass.
4. Add these Environment secrets (not repository variables or plaintext files):
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
5. Add the Environment variable `DEPLOYMENT_URL` with the installation's public
   HTTPS origin.
6. In the generated repository, install the pinned toolchain and dependencies,
   authenticate the GitHub CLI, confirm in the GitHub UI that administrator
   bypass is disabled, then run:

   ```bash
   pnpm install --frozen-lockfile
   pnpm deployment:adopt -- --confirm-admin-bypass-disabled
   ```

   GitHub's Environment REST response does not expose the administrator-bypass
   checkbox. The flag is an explicit operator attestation after checking the UI;
   it cannot override an API response that reports bypass as enabled.
   If this installation already deployed the optional R2 overlay, add `--r2`
   to the same command so the adopted manifest and future release pipeline use
   `wrangler.r2.jsonc`.

7. Review and commit `.unimailbox/installation.json`. It contains identifiers
   and repository metadata, not secrets. Never add Cloudflare tokens or initial
   administrator credentials to it.
8. In Cloudflare, disable Workers Builds automatic production deployments for
   the production branch. Preview builds may remain enabled if they use
   isolated resources.
9. In GitHub **Settings → Actions → General → Workflow permissions**, enable
   **Allow GitHub Actions to create and approve pull requests** so the stable
   updater can open upgrade PRs.

Adoption fails closed when generated binding identifiers are missing, the
manifest disagrees with `wrangler.jsonc`, the deployment URL is invalid, or the
required GitHub Environment configuration is unavailable. The production
workflow also validates the committed manifest; creating the file manually does
not bypass these checks.

Use a new Cloudflare API token scoped to the single installation account. Start
from Cloudflare's **Edit Cloudflare Workers** template and add only the D1, KV,
and Queue permissions required by this repository. Add R2 permissions only
after opting into `wrangler.r2.jsonc`. Do not reuse a global API key or a token
from the canonical UniMailbox repository.

### Initial D1 schema

After the minimal provisioning deploy, `pnpm deployment:bootstrap` inspects
`sqlite_schema` and Wrangler's `d1_migrations` ledger before applying
migrations. When D1 is empty and
`0001_initial.sql` is not recorded, the release imports the initial schema and
its ledger entry together through Wrangler's atomic SQL-file import path. It
then returns to `wrangler d1 migrations apply` for the remaining migrations.
This avoids the remote multi-statement query parser used by the standard
migration command for the trigger-bearing initial schema.

The release never adopts an untracked non-empty application schema. If `users`
or `installation_state` exists without a `0001_initial.sql` ledger entry, it
stops with `migration.initial_schema_untracked` for operator review.

## Storage backends

UniMailbox stores raw inbound messages (`raw/<uuid>.eml`) and attachment bytes
(`attachments/<uuid>`) in Cloudflare KV by default and optionally in Cloudflare
R2. R2 requires a paid Cloudflare plan; KV ships with the free tier. The
runtime selects the backend automatically based on whether the `ATTACHMENTS`
binding is present — no configuration flag or environment variable is needed.

D1 stores the searchable attachment catalog (`attachment_files`) and per-message
references, while KV/R2 stores only the bytes. New uploads and inbound messages
receive a Worker-computed MD5; matching MD5 and size values are verified by a
byte comparison before one canonical object is reused. After migration 0007,
the scheduled `attachment-md5-backfill` job hashes legacy objects in bounded
batches, so the schema migration itself never reads large objects.

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
    "storage": { "backend": "kv", "reason": "ATTACHMENTS binding is absent; ..." },
    "release": {
      "applicationVersion": "0.2.0",
      "upstreamVersion": "0.2.0",
      "workerVersionId": "...",
      "workerVersionTag": "release-...",
      "deployedAt": "2026-08-02T00:00:00.000Z"
    },
    "operationalAlerts": []
  }
}
```

The `r2` field still reports the binding presence for backwards compatibility.
The `storage` object is the canonical indicator. D1, KV, Queue, and Assets are
required health gates; missing R2 is healthy for the default KV mode. A missing
Cron heartbeat is `pending` for ten minutes after the Worker version timestamp,
then becomes a `scheduled_trigger_stale` operational alert. That alert does not
make an otherwise healthy HTTP Worker eligible for automatic rollback.

## Automatic runtime secrets

The explicit application bootstrap inspects Worker secret names only after
Cloudflare has provisioned the Worker. It and later adopted releases securely
generate any missing values for:

- `AUTH_SIGNING_KEY`: HMAC signing key, at least 32 random bytes.
- `CREDENTIAL_ENCRYPTION_KEY`: AES-GCM key material, at least 32 random bytes.

Generated values are attached with Wrangler's temporary `--secrets-file`
input; the file is mode `0600` and is deleted after upload/deploy. Values never
appear in deployment logs. Existing secret names are preserved. If an existing
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

After adoption, production releases run only through the installation
repository's manually dispatched GitHub Actions workflow, only from the current
remote `main` HEAD, and only after the `production` Environment reviewer
approves the job. Environment secrets are unavailable before that approval.
Workers Builds must not remain a second production deployment source.

The workflow fails closed if adoption is incomplete, `main` moved after the
workflow started, an installation resource differs from `wrangler.jsonc`, the
token belongs to another account, or the Worker/D1 preflight cannot resolve the
declared resources. Once those gates pass, it performs this sequence:

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
   activity, inbound routing, and configured outbound provider health.

```bash
pnpm release:production
pnpm release:verify https://mail.example.com
```

`release:verify` covers public HTTP checks. The authenticated Settings control
plane owns Cloudflare Email Routing and initial Brevo setup. Administrators can
add Brevo or Resend connections under **Providers**, then select an active
connection from each domain's **Outbound provider** selector.

After saving a domain provider, use **Test this domain provider** to send a
transactional test to an address you control. Configure the provider webhook
to the `webhook_path` shown for its connection, prefixed by the deployed Worker
origin. Webhook events record the resolved managed `domain_id`; events whose
message does not belong to a domain bound to that connection are rejected.

Merging an upstream upgrade PR does not deploy it. Verify the merged commit on
`main`, manually start **Production release**, and approve the Environment only
after reviewing its checks and migration list.

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

## Stable upgrades

Installation repositories check the latest stable GitHub Release from
`UniMailbox/unimailbox-deploy` once per day and on manual request. They do not
track either repository's moving `main` branch. The updater uses the previously
installed distribution tag as the common ancestor, performs a three-way merge,
and preserves installation-owned Worker, D1, KV, Queue, optional R2, and
deployment URL values.

When the merge and validation succeed, the updater opens an
`automation/upstream-vX.Y.Z` pull request. Its description lists migrations,
configuration changes, breaking changes, and validation results. Review it like
any other production change. When source changes conflict, the updater leaves
`main` untouched and creates or updates an issue with the conflicting files and
manual recovery commands. It never resolves a real conflict or deploys a new
version automatically.

See the [release policy](releases.md) for the canonical-to-distribution flow and
the [compatibility policy](compatibility.md) before skipping versions or
changing bindings.

## Failure boundaries

- Migration failure: stop before promotion; do not auto-restore D1.
- Pre-promotion smoke failure: leave the existing Worker version active.
- Post-promotion Worker failure: roll back the Worker version. Database restore
  is a separate approved incident action using the recorded bookmark.
- Provider failure: disable the provider connection; queued jobs remain
  inspectable and recoverable.

Migration, mail delivery, and setup-specific commands are in `.skills/runbooks/`.
