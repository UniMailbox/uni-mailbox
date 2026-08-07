# UniMailbox

UniMailbox is a self-hosted mail operations workspace built as one Cloudflare
Worker deployment. It receives routed mail, stores canonical message data in D1
and KV or optional R2, sends external recipients through a domain-selected
Brevo or Resend connection, and serves the React application from the same
origin.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/UniMailbox/unimailbox-deploy)

[English](README.md) · [简体中文](README.zh-CN.md)

The Deploy Button installs the latest stable snapshot from
[`UniMailbox/unimailbox-deploy`](https://github.com/UniMailbox/unimailbox-deploy).
Cloudflare creates an independent repository in your GitHub account and writes
that installation's Worker, D1, KV, and Queue configuration into it. The result
is not a fork of this source repository; keep its generated resource identifiers
when accepting upstream upgrades.

## Features

### Mail delivery pipeline

- **Inbound** — Cloudflare Email Routing events feed a `postal-mime` parser;
  canonical messages land in D1 behind rate-limit and block-list gates. Unknown
  recipient policy is configurable per environment (`reject` or `store`).
- **Outbound** — `OUTBOUND_QUEUE` (`unimailbox-outbound` + DLQ) carries durable
  outbound jobs with up to 5 retries, `lock_token`-based recovery, and
  `Idempotency-Key` to prevent duplicate sends.
- **Webhooks** — `POST /api/v1/webhooks/:providerKey/:connectionId` validates
  Svix signatures, deduplicates by `(connection, event_key)` through atomic
  claim, and applies provider status events in deterministic order.
- **Providers** — Adapter-neutral Brevo and Resend plugins selected per domain
  through `domains.outbound_connection_id`; each connection supports test
  delivery and inbound / outbound smoke tests.

### Composing

- **Rich-text composer** — TipTap (`StarterKit` + `Placeholder`) renders into
  the worker through DOMPurify; reply state wraps the parent in
  `<blockquote data-parent-message>` and prepends `Re:`.
- **Drafts** — Server drafts use `If-Match` ETag for optimistic concurrency;
  working drafts persist to IndexedDB via Dexie and hydrate on next load;
  sends attach a UUID `Idempotency-Key`.
- **Attachments** — Three-step upload (`createUpload` → signed PUT → `complete`).
  KV is the default backend; R2 auto-detected through the `ATTACHMENTS` binding.
  Downloads honor `Range`; the `attachment_files` catalog content-addresses
  duplicates by `md5`.

### Mailbox organization

- **Folders** — `inbox`, `sent`, `drafts`, `archive`, `trash` plus a virtual
  `starred` view; cursor pagination with `limit ∈ [1, 100]`; mark read, star,
  move, delete.
- **Mailboxes & RBAC** — Multi-user mailboxes with `viewer` / `sender` /
  `admin` shared roles; bitmask `permissions` and `role_permissions` resolve
  authorization on every `/api/v1/admin/*` route; `registration_keys` enable
  invite-only signup; OAuth account binding supports Cloudflare.
- **Bootstrap** — `installation_state` tracks five installation steps; until
  `InstallationStep.COMPLETE`, every path except `/health`, `/setup`, and
  `/api/v1/setup/*` returns `503 BOOTSTRAP_INCOMPLETE`.

### Administration plane

A single `AdminPage` covers eleven resources, every action in a focus-trapped
dialog:

- **Users / Roles / Domains / Provider Connections** — CRUD with status,
  role bindings, and per-domain provider delivery configuration.
- **Cloudflare** — OAuth start / callback / revoke, dashboard links for
  Email Routing / DNS / Worker, manual domain routing guide, inbound and
  outbound smoke tests.
- **Storage** — D1 / KV / R2 readiness cards; KV ↔ R2 attachment backend
  verification.
- **Settings** — Site title, registration toggle, invite requirement, in/out
  switches, `unknown_recipient_policy`, attachment and mailbox quotas, sender
  / subject / content blocklists.
- **Signatures** — Per-domain HTML / text signatures with an `enabled` flag.
- **Webhooks / Audit / Analytics / Messages / Attachments** — Read-mostly
  tables with keyword search, image and PDF inline previews for attachments,
  full message audit including attachments across every mailbox.

### Observability

- **Sentry** — Worker (`@sentry/cloudflare`) and browser (`@sentry/react`)
  share one release; queue, scheduler, and route errors are captured with
  `requestId`.
- **Heartbeat** — Scheduled triggers at every minute, every hour, and
  `03:17 UTC` daily write health into D1; a KV fixed-window rate limiter is
  the unified primitive across endpoints.
- **Logging** — Structured `logger` with `requestId` correlation; alert and
  recovery procedures live under `.skills/runbooks/observability-alerts.md`.

### Internationalization and accessibility

- **Three locales** — `en` and `zh-CN` ship to production; `ar-XB` is a
  pseudo locale used only by tests to exercise RTL coverage.
- **Direction safety** — `<BidiText kind="identifier" dir="ltr">` isolates
  user-supplied text; technical fields (id, API keys, webhook secrets)
  bypass localization and force `dir="ltr"`.
- **Theme** — A custom HSL palette derives `forest / forestDeep / mint /
focus / focusSoft` from one input color, persisted in `localStorage`
  and mirrored to `<meta name="theme-color">`.
- **A11y** — Every icon button carries `aria-label`; route boundaries
  funnel errors and 403s to dedicated, Sentry-tagged components.

### Type-safe contracts

- **`@unimailbox/contracts`** — Zod 3 schemas for every API endpoint, shared
  by worker and web; the API client re-validates responses and raises
  `CLIENT_RESPONSE_INVALID` with the raw payload and `requestId`.
- **Auto refresh** — `lib/api/transport` issues a single `POST /auth/refresh`
  on `401`, replays the original request, and otherwise clears the session.
- **Normalized errors** — `ApiClientError` carries `code`, `status`,
  `requestId`, `params`, and `details`; i18n renders field-level issues via
  `zodIssueToken`.

### Operations tooling

- **40+ scripts** — `scaffold`, `bootstrap:admin`, `deployment:bootstrap`,
  `deployment:adopt`, `release:production`, `production-preflight`,
  `verify-deployment`, `migrate-attachments-to-r2`, `r2-dry-run`,
  `i18n-check`, `frontend-contract-check`, `schema:check`,
  `workflow-security`, `config-parity`, `release-notes`.
- **CI gates** — Release blocks on `format:check`, `lint`, `typecheck`,
  `schema:check`, `test`, `i18n:check`, `frontend-contract-check`,
  `build`, `deploy:dry-run`, and end-to-end suites.

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
.skills/runbooks/     Operator recovery procedures
```

## Tech stack

| Layer         | Choice                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime       | Cloudflare Worker (single deployment), `wrangler.jsonc` + `wrangler.r2.jsonc` overlay                                                     |
| Framework     | Hono 4 on the worker; React 18 + Vite 5 on the web                                                                                        |
| Data          | D1 + Drizzle ORM; KV for rate limits, heartbeat, and attachment fallback; optional R2 for large attachments; Queues for outbound delivery |
| Auth          | Bearer access tokens in `sessionStorage` plus an HttpOnly refresh cookie; bitmask RBAC                                                    |
| Type safety   | Zod 3 schemas in `@unimailbox/contracts` shared by worker and web                                                                         |
| Frontend data | TanStack Router + Query + Form                                                                                                            |
| Editor        | TipTap + DOMPurify; IndexedDB drafts via Dexie                                                                                            |
| i18n          | i18next; `en` / `zh-CN` production; `ar-XB` pseudo locale for RTL tests                                                                   |
| Telemetry     | `@sentry/cloudflare` + `@sentry/react`                                                                                                    |
| Testing       | Vitest (unit, integration, worker pool) and Playwright e2e                                                                                |
| Lint / format | ESLint 9, Prettier 3, TypeScript 5                                                                                                        |

## Local development

Requirements: Node 22.22.1, pnpm 10.32.1, Wrangler 4.114.0. The full contributor
walkthrough lives in [`docs/development.md`](docs/development.md).

```bash
pnpm install
cp .dev.vars.example .dev.vars       # then fill both `replace-with-…` keys
pnpm scaffold init
INITIAL_ADMIN_EMAIL=admin@example.com \
  INITIAL_ADMIN_PASSWORD='replace-with-a-strong-password' \
  pnpm bootstrap:admin -- --target local
pnpm dev                              # Wrangler at 127.0.0.1:8787
```

Sign in at `/login` with the initial administrator credentials.
`pnpm dev:web` runs the Vite SPA only; it proxies `/api` and `/health` to the
local Wrangler. `.dev.vars` holds two local runtime secrets; production
releases generate these values automatically. `INITIAL_ADMIN_EMAIL` and
`INITIAL_ADMIN_PASSWORD` are one-time inputs: the bootstrap hashes the
password into D1, then the values can be removed. Provider and Cloudflare
settings are configured after login; credentials are encrypted with AES-GCM
and stored in D1. Never commit `.dev.vars` or initial credentials.

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

## Deploy

The root [`wrangler.jsonc`](wrangler.jsonc) intentionally has no canonical
account IDs or resource IDs; Cloudflare provisions the declared D1, KV, and
Queue resources on the first Deploy Button build. `pnpm deploy` is intentionally
the first-install path; after Cloudflare writes the generated resource IDs,
run `pnpm deployment:bootstrap` from a trusted shell to apply migrations,
create the administrator, and attach generated secrets. After a healthy
deployment, run `pnpm deployment:adopt -- --confirm-admin-bypass-disabled`
to record the non-secret installation manifest and gate production through
the GitHub `production` Environment. R2 is opt-in via
[`wrangler.r2.jsonc`](wrangler.r2.jsonc) so cold-start deployments do not
require a paid plan.

See [`docs/deployment.md`](docs/deployment.md) for the install / adoption /
release checklist,
[`.skills/runbooks/attachment-storage-migration.md`](.skills/runbooks/attachment-storage-migration.md)
for switching backends later, and
[`.skills/runbooks/mail-delivery-recovery.md`](.skills/runbooks/mail-delivery-recovery.md)
for delivery incidents.

> Production release is intentionally operator-gated. Real inbound routing,
> Queue, Cron, and provider exit criteria cannot be proven by local mocks;
> run the documented smoke tests against the deployed installation before
> promotion is considered complete.

## Documentation and runbooks

- [Local development guide](docs/development.md)
- [Deployment guide](docs/deployment.md)
- [Release and distribution policy](docs/releases.md)
- [Compatibility and maintenance policy](docs/compatibility.md)
- [Source blueprint](docs/rebuild-blueprint.md)
- [External mail import research (POP3 / IMAP, draft)](.skills/plans/external-mail-import-research.md)

Runbooks:

- [Failed migration recovery](.skills/runbooks/migration-recovery.md)
- [Outbound and webhook recovery](.skills/runbooks/mail-delivery-recovery.md)
- [Storage backend migration](.skills/runbooks/attachment-storage-migration.md)
- [Bootstrap and account recovery](.skills/runbooks/setup-recovery.md)
- [Local admin bootstrap](.skills/runbooks/local-admin-bootstrap.md)
- [Observability and alerts](.skills/runbooks/observability-alerts.md)

Project:

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)

## License

UniMailbox is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). If you
run a modified version for users over a network, review the license's
corresponding-source obligations.
