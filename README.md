# UniMailbox

UniMailbox is a self-hosted mail operations workspace built as one Cloudflare
Worker deployment. It receives routed mail, stores canonical message data in D1
and KV or optional R2, sends external recipients through Brevo, and serves the React
application from the same origin.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=<PUBLIC_REPOSITORY_URL>)

Replace `<PUBLIC_REPOSITORY_URL>` with this repository's public GitHub or GitLab
URL after publishing it. Private repositories use Cloudflare's **Import a
repository** flow with the same root build and binding declarations.

## What is included

- One root Worker with HTTP, inbound email, Queue, and scheduled entrypoints.
- D1 schema and immutable migrations for identity, RBAC, mail, drafts,
  providers, webhooks, installation state, maintenance, and audit records.
- KV-backed rate limits and, by default, raw messages and attachments.
- Optional R2 overlay (`wrangler.r2.jsonc`) for installations that need
  attachments larger than 25 MiB.
- Durable outbound jobs and a Queue consumer with retry and lock recovery.
- Provider-neutral adapters with Brevo as the first provider.
- A responsive React mail workspace and authenticated administrator control plane
  with typed endpoint contracts, TanStack Router/Query/Form ownership, and
  English/Simplified Chinese localization with RTL test coverage.
- A migration/release CLI, CI dry-run gate, and production recovery runbooks.

## Repository layout

```text
apps/worker/          Worker entrypoints and feature modules
apps/web/             React/Vite application
packages/contracts/   Runtime schemas and cross-boundary types
packages/email-core/  Provider-independent composition rules
packages/config/      Runtime security and retry policy
packages/test-kit/    Shared test fixtures
migrations/           Reviewed D1 SQL
scripts/              Scaffold, migration, release, and verification CLIs
docs/runbooks/         Operator recovery procedures
```

## Local development

Requirements: Node 22.22.1, pnpm 10.32.1, Wrangler 4.114.0, and a Cloudflare
account for live Email Routing or Brevo verification. The end-to-end
contributor walkthrough lives in [`docs/development.md`](docs/development.md);
the short version is:

```bash
pnpm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars: replace BOTH `replace-with-…` placeholders with real keys.
pnpm scaffold init
INITIAL_ADMIN_EMAIL=admin@example.com \
  INITIAL_ADMIN_PASSWORD='replace-with-a-strong-password' \
  pnpm bootstrap:admin -- --target local
pnpm build
pnpm dev
```

Open the URL printed by Wrangler and sign in at `/login` with the initial
administrator credentials. `pnpm dev:web` exists for frontend-focused work;
Vite proxies `/api` and `/health` to the Worker on the same `127.0.0.1:8787`
that `wrangler.jsonc` pins.

The two values in `.dev.vars` are local runtime secrets. Production releases
generate these values automatically when they do not already exist.
`INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` are build-only inputs: the
release hashes the password into D1, then the values can be removed. Brevo and
Cloudflare settings are configured after login; credentials are encrypted with
AES-GCM and stored in D1. Never commit `.dev.vars` or initial credentials.

## Verification

```bash
pnpm scaffold doctor
pnpm format:check
pnpm lint
pnpm typecheck
pnpm schema:check
pnpm test
pnpm test:coverage
pnpm i18n:check
pnpm frontend:contracts
pnpm test:e2e
pnpm build
pnpm deploy:dry-run
pnpm deploy:r2:dry-run
```

`pnpm db:migrate --target production` refuses to run without
`--confirm <deployment-id>`. Released migration checksums are committed and
verified before any migration or release command.

## Deployment and operations

The root [`wrangler.jsonc`](wrangler.jsonc) intentionally has no account IDs or
resource IDs. Cloudflare automatically provisions the declared D1, KV, and
Queue resources during the deployment flow. Configure only
`INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` as Workers Builds variables;
the release creates missing signing/encryption secrets without prompting. R2 is
**not** declared in the default config —
it is opt-in via [`wrangler.r2.jsonc`](wrangler.r2.jsonc) so cold-start
deployments do not require a paid plan. See the
[storage backends section](docs/deployment.md#storage-backends) for the
trade-offs and the [migration runbook](docs/runbooks/attachment-storage-migration.md)
for switching backends later.

See:

- [Local development guide](docs/development.md)
- [Deployment guide](docs/deployment.md)
- [Failed migration recovery](docs/runbooks/migration-recovery.md)
- [Outbound and webhook recovery](docs/runbooks/mail-delivery-recovery.md)
- [Storage backend migration](docs/runbooks/attachment-storage-migration.md)
- [Bootstrap and account recovery](docs/runbooks/setup-recovery.md)
- [Local admin bootstrap runbook](docs/runbooks/local-admin-bootstrap.md)
- [Observability and alerts](docs/runbooks/observability-alerts.md)
- [Source blueprint](docs/rebuild-blueprint.md)

Production release is intentionally operator-gated. Real inbound routing,
Queue, Cron, and Brevo exit criteria cannot be proven by local mocks; run the
documented smoke tests against the deployed installation before promotion is
considered complete.
