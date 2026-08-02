# UniMailbox

UniMailbox is a self-hosted mail operations workspace built as one Cloudflare
Worker deployment. It receives routed mail, stores canonical message data in D1
and KV or optional R2, sends external recipients through Brevo, and serves the React
application from the same origin.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/UniMailbox/unimailbox-deploy)

The button installs the latest stable snapshot from
[`UniMailbox/unimailbox-deploy`](https://github.com/UniMailbox/unimailbox-deploy).
Cloudflare creates an independent repository in your GitHub account and writes
that installation's Worker, D1, KV, and Queue configuration into it. The result
is not a fork of this source repository; keep its generated resource identifiers
when accepting upstream upgrades.

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

## Install, adopt, and operate

The root [`wrangler.jsonc`](wrangler.jsonc) intentionally has no canonical
account IDs or resource IDs. During the first Deploy Button build, Cloudflare
automatically provisions the declared D1, KV, and Queue resources. Configure
only `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` as Workers Builds
variables, then remove both after the administrator is created.

After the first healthy deployment, verify that the Environment disallows
administrator bypass, then run
`pnpm deployment:adopt -- --confirm-admin-bypass-disabled` in the generated
installation repository. Adoption records the non-secret installation manifest,
checks the GitHub `production` Environment, and must succeed before the manual
production workflow can deploy. Then turn off Workers Builds production branch
auto-deployment: after adoption, the only production authority is the manual
GitHub Actions workflow protected by `production` Environment approval.

R2 is **not** declared in the default config. It is opt-in via
[`wrangler.r2.jsonc`](wrangler.r2.jsonc) so cold-start deployments do not require
a paid plan. See the [deployment guide](docs/deployment.md) for the complete
install/adoption checklist, the
[storage backends section](docs/deployment.md#storage-backends) for the
trade-offs, and the
[migration runbook](docs/runbooks/attachment-storage-migration.md) for switching
backends later.

See:

- [Local development guide](docs/development.md)
- [Deployment guide](docs/deployment.md)
- [Release and distribution policy](docs/releases.md)
- [Compatibility and maintenance policy](docs/compatibility.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
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

## License

UniMailbox is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). If you
run a modified version for users over a network, review the license's
corresponding-source obligations.
