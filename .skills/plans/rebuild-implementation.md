# UniMailbox rebuild implementation matrix

This matrix is the working checklist for [`docs/rebuild-blueprint.md`](../rebuild-blueprint.md).
An item is complete only when its implementation and the matching automated or operational
verification both exist.

## Phase 0 — Deployable foundation

- [x] Root Worker deployment unit with HTTP, email, scheduled, and queue entrypoints
- [x] Shared contracts, feature-owned Worker modules, React shell, and structured errors
- [x] Deploy to Cloudflare bootstrap with automatically provisioned bindings
- [x] Resumable claim, preflight, first-administrator setup, and installation route guard
- [x] Initial schema, permission seeds, migration tooling, health checks, and CI preview gate

## Phase 1 — Basic inbound mailbox

- [x] Password login, refresh rotation, session revocation, and administrator/member roles
- [x] Dashboard-assisted Email Routing verification and managed-domain setup
- [x] Domain and mailbox creation with global and object-level authorization
- [x] PostalMime inbound pipeline with R2 raw/attachment storage and canonical D1 graph
- [x] Inbox, message detail, read state, deletion, logs, and inbound smoke test

## Phase 2 — Basic Brevo outbound

- [x] Provider-neutral plugin contracts, registry, and connection validation
- [x] AES-GCM encrypted Brevo credentials and health check
- [x] TO/CC/BCC composition with internal/external recipient partitioning
- [x] Durable outbox, Queue dispatch/consumer, retries, and idempotency records
- [x] Verified Brevo webhooks, ordered status updates, and outbound smoke test

## Phase 3 — Complete mailbox workflow

- [x] Capability-signed browser upload through the Worker R2 binding and authorized attachment download
- [x] Server drafts with optimistic concurrency and browser recovery copies
- [x] Reply threading, signatures, quoted content, and inline attachment preservation
- [x] Shared mailbox member roles and target-mailbox authorization
- [x] Sent, drafts, starred, archive, and trash views

## Phase 4 — Administration and operations

- [x] Provider synchronization and reconciliation
- [x] User, role, domain, provider connection, settings, and webhook administration
- [x] Domain-level Brevo/Resend selector, provider test send, and domain-bound webhook audit data
- [x] Audit search, metrics, cleanup, retention, and tuned rate limits
- [x] Production release verification, alert specification, runbooks, and recovery exercises
- [x] Optional Cloudflare OAuth setup mode with PKCE, encrypted refresh, and revocation

## Phase 5 — Additional providers

- [x] Prove adapter-only provider extension with contract tests and no message-module branches

## Mandatory verification

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test:unit`
- [x] `pnpm test:worker`
- [x] `pnpm test:integration`
- [x] `pnpm test:e2e`
- [x] `pnpm scaffold doctor`
- [x] `pnpm db:verify --target local`
- [x] `pnpm build`
- [x] `pnpm deploy:dry-run`

## External acceptance still required

The repository implementation and local/preview gates are complete. These
blueprint exit criteria require account-owned infrastructure and cannot be
truthfully checked from a source checkout:

- [ ] Publish the repository and replace the Deploy button placeholder with its
      public URL.
- [ ] Deploy isolated preview resources in a real Cloudflare account.
- [ ] Complete real Email Routing inbound and configured-provider outbound/webhook smoke tests.
- [ ] Configure the account-owned notification destination and run the
      documented Worker rollback drill.
