# UniMailbox

UniMailbox is a self-hosted mail operations workspace built as one Cloudflare
Worker deployment. It receives routed mail, stores canonical message data in D1
and R2, sends external recipients through Brevo, and serves the React
application from the same origin.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=<PUBLIC_REPOSITORY_URL>)

Replace `<PUBLIC_REPOSITORY_URL>` with this repository's public GitHub or GitLab
URL after publishing it. Private repositories use Cloudflare's **Import a
repository** flow with the same root build and binding declarations.

## What is included

- One root Worker with HTTP, inbound email, Queue, and scheduled entrypoints.
- D1 schema and immutable migrations for identity, RBAC, mail, drafts,
  providers, webhooks, installation state, maintenance, and audit records.
- KV-backed installation sessions, rate limits, and (by default) raw messages
  and attachments.
- Optional R2 overlay (`wrangler.r2.jsonc`) for installations that need
  attachments larger than 25 MiB.
- Durable outbound jobs and a Queue consumer with retry and lock recovery.
- Provider-neutral adapters with Brevo as the first provider.
- A responsive React mail workspace, resumable setup wizard, and control plane.
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

Requirements: Node 22, pnpm 10.32.1, Wrangler 4.68.0, and a Cloudflare account
for live Email Routing or Brevo verification.

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm scaffold init
pnpm build
pnpm dev
```

Open the URL printed by Wrangler. The first request redirects to `/setup`.
Use `pnpm dev:web` only for frontend-focused work; Vite proxies `/api` and
`/health` to the Worker at `127.0.0.1:8787`.

The three values in `.dev.vars` are deployment bootstrap secrets only. Brevo
credentials are collected by the setup wizard, encrypted with AES-GCM, and
stored in D1. Never commit `.dev.vars`.

## Verification

```bash
pnpm scaffold doctor
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm deploy:dry-run
```

`pnpm db:migrate --target production` refuses to run without
`--confirm <deployment-id>`. Released migration checksums are committed and
verified before any migration or release command.

## Deployment and operations

The root [`wrangler.jsonc`](wrangler.jsonc) intentionally has no account IDs or
resource IDs. Cloudflare automatically provisions the declared D1, KV, and
Queue resources during the deployment flow; the deployment page collects the
three required secret bindings. R2 is **not** declared in the default config —
it is opt-in via [`wrangler.r2.jsonc`](wrangler.r2.jsonc) so cold-start
deployments do not require a paid plan. See the
[storage backends section](docs/deployment.md#storage-backends) for the
trade-offs and the [migration runbook](docs/runbooks/attachment-storage-migration.md)
for switching backends later.

See:

- [Deployment guide](docs/deployment.md)
- [Failed migration recovery](docs/runbooks/migration-recovery.md)
- [Outbound and webhook recovery](docs/runbooks/mail-delivery-recovery.md)
- [Storage backend migration](docs/runbooks/attachment-storage-migration.md)
- [Setup repair](docs/runbooks/setup-recovery.md)
- [Observability and alerts](docs/runbooks/observability-alerts.md)
- [Source blueprint](docs/rebuild-blueprint.md)

Production release is intentionally operator-gated. Real inbound routing,
Queue, Cron, and Brevo exit criteria cannot be proven by local mocks; run the
documented smoke tests against the deployed installation before promotion is
considered complete.
